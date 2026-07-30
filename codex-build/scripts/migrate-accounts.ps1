[CmdletBinding()]
param(
    [switch]$Force,
    [string]$SourceDir = (Join-Path $env:USERPROFILE '.codex-switcher'),
    [string]$TargetDir = (Join-Path $env:USERPROFILE '.codex-switcher-hardened'),
    [string]$CodexDir = (Join-Path $env:USERPROFILE '.codex'),
    [string]$BackupRoot,
    [switch]$SkipProcessCheck
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$legacyAccounts = Join-Path $SourceDir 'accounts.json'
$targetAccounts = Join-Path $TargetDir 'accounts.json'
$codexAuth = Join-Path $CodexDir 'auth.json'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
if ([string]::IsNullOrWhiteSpace($BackupRoot)) {
    $desktop = [Environment]::GetFolderPath('Desktop')
    if ([string]::IsNullOrWhiteSpace($desktop)) { $desktop = $env:USERPROFILE }
    $BackupRoot = Join-Path $desktop "CodexSwitcher-migration-backup-$stamp"
}

function Read-JsonFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "File not found: $Path"
    }
    try {
        return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
        throw "Invalid JSON in $Path`n$($_.Exception.Message)"
    }
}

function Normalize-AuthType([object]$Value) {
    if ($null -eq $Value) { return $Value }
    $text = [string]$Value
    if ($text -in @('chatgpt', 'chat_gpt', 'chat_g_pt', 'chat_g_p_t', 'ChatGPT')) { return 'chat_gpt' }
    if ($text -in @('ApiKey', 'api_key')) { return 'api_key' }
    return $text
}

function Decode-JwtPayload([string]$Token) {
    if ([string]::IsNullOrWhiteSpace($Token)) { return $null }
    $parts = $Token.Split('.')
    if ($parts.Count -ne 3) { return $null }
    try {
        $payload = $parts[1].Replace('-', '+').Replace('_', '/')
        switch ($payload.Length % 4) {
            2 { $payload += '==' }
            3 { $payload += '=' }
        }
        $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload))
        return $json | ConvertFrom-Json
    }
    catch { return $null }
}

function Ensure-Property([object]$Object, [string]$Name, [object]$Value) {
    if ($Object.PSObject.Properties.Name -contains $Name) {
        $Object.$Name = $Value
    }
    else {
        $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
    }
}

function Assert-Store([object]$Store, [string]$Label) {
    if ($null -eq $Store.accounts) { throw "$Label has no accounts array." }
    $accounts = @($Store.accounts)
    if ($accounts.Count -lt 1) { throw "$Label contains no accounts." }

    $ids = @($accounts | ForEach-Object { [string]$_.id })
    if (@($ids | Where-Object { [string]::IsNullOrWhiteSpace($_) }).Count -gt 0) {
        throw "$Label contains an account with an empty id."
    }
    $duplicates = @($ids | Group-Object | Where-Object Count -gt 1)
    if ($duplicates.Count -gt 0) {
        throw "$Label contains duplicate account ids: $((@($duplicates.Name) -join ', '))"
    }

    $activeId = [string]$Store.active_account_id
    if (-not [string]::IsNullOrWhiteSpace($activeId) -and $activeId -notin $ids) {
        throw "$Label references missing active_account_id: $activeId"
    }
    return $accounts
}

if (-not $SkipProcessCheck) {
    $blocking = Get-Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ProcessName -match '^(codex-switcher|codex-switcher-hardened|Codex|ChatGPT)$'
    }
    if ($blocking) {
        $names = ($blocking | Select-Object -ExpandProperty ProcessName -Unique) -join ', '
        throw "Close Codex, ChatGPT and both Switcher applications before migration. Running: $names"
    }
}

$store = Read-JsonFile $legacyAccounts
$legacyAccountsList = Assert-Store $store 'Legacy accounts.json'
$legacyCount = $legacyAccountsList.Count
$sourceHashBefore = (Get-FileHash -LiteralPath $legacyAccounts -Algorithm SHA256).Hash
$authHashBefore = if (Test-Path -LiteralPath $codexAuth -PathType Leaf) {
    (Get-FileHash -LiteralPath $codexAuth -Algorithm SHA256).Hash
} else { $null }

New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
Copy-Item -LiteralPath $SourceDir -Destination (Join-Path $BackupRoot '.codex-switcher') -Recurse -Force
if (Test-Path -LiteralPath $codexAuth -PathType Leaf) {
    New-Item -ItemType Directory -Path (Join-Path $BackupRoot '.codex') -Force | Out-Null
    Copy-Item -LiteralPath $codexAuth -Destination (Join-Path $BackupRoot '.codex\auth.json') -Force
}

if (Test-Path -LiteralPath $TargetDir) {
    Copy-Item -LiteralPath $TargetDir -Destination (Join-Path $BackupRoot '.codex-switcher-hardened-before') -Recurse -Force
    if ((Test-Path -LiteralPath $targetAccounts -PathType Leaf) -and -not $Force) {
        throw "Hardened account store already exists. Backup created at $BackupRoot. Re-run with -Force only after reviewing it."
    }
}

foreach ($account in $legacyAccountsList) {
    Ensure-Property $account 'auth_mode' (Normalize-AuthType $account.auth_mode)
    if ($null -ne $account.auth_data -and $account.auth_data.PSObject.Properties.Name -contains 'type') {
        $account.auth_data.type = Normalize-AuthType $account.auth_data.type
    }

    $userId = if ($account.PSObject.Properties.Name -contains 'user_id') { $account.user_id } else { $null }
    if ([string]::IsNullOrWhiteSpace([string]$userId) -and $null -ne $account.auth_data) {
        $idToken = if ($account.auth_data.PSObject.Properties.Name -contains 'id_token') {
            [string]$account.auth_data.id_token
        } else { '' }
        $claims = Decode-JwtPayload $idToken
        if ($null -ne $claims) {
            if ($claims.PSObject.Properties.Name -contains 'chatgpt_user_id') {
                $userId = [string]$claims.chatgpt_user_id
            }
            elseif ($claims.PSObject.Properties.Name -contains 'sub') {
                $userId = [string]$claims.sub
            }
        }
    }
    Ensure-Property $account 'user_id' $userId
}
Ensure-Property $store 'version' 2

New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
$tempPath = "$targetAccounts.tmp-$stamp"
$json = $store | ConvertTo-Json -Depth 40
[System.IO.File]::WriteAllText($tempPath, $json, [System.Text.UTF8Encoding]::new($false))

$validated = Read-JsonFile $tempPath
$newAccountsList = Assert-Store $validated 'Migrated accounts.json'
$newCount = $newAccountsList.Count
if ($newCount -ne $legacyCount) {
    Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue
    throw "Account count mismatch: source=$legacyCount, migrated=$newCount"
}

if (Test-Path -LiteralPath $targetAccounts -PathType Leaf) {
    Move-Item -LiteralPath $targetAccounts -Destination "$targetAccounts.pre-migration-$stamp.bak" -Force
}
Move-Item -LiteralPath $tempPath -Destination $targetAccounts -Force
$null = Assert-Store (Read-JsonFile $targetAccounts) 'Committed hardened accounts.json'

$legacySettings = Join-Path $SourceDir 'settings.json'
if (Test-Path -LiteralPath $legacySettings -PathType Leaf) {
    $null = Read-JsonFile $legacySettings
    Copy-Item -LiteralPath $legacySettings -Destination (Join-Path $TargetDir 'settings.json') -Force
}

$sourceHashAfter = (Get-FileHash -LiteralPath $legacyAccounts -Algorithm SHA256).Hash
if ($sourceHashAfter -ne $sourceHashBefore) {
    throw 'Safety check failed: legacy accounts.json changed during migration.'
}
$authHashAfter = if (Test-Path -LiteralPath $codexAuth -PathType Leaf) {
    (Get-FileHash -LiteralPath $codexAuth -Algorithm SHA256).Hash
} else { $null }
if ($authHashAfter -ne $authHashBefore) {
    throw 'Safety check failed: Codex auth.json changed during migration.'
}

$report = [ordered]@{
    status = 'OK'
    migrated_at = (Get-Date).ToString('o')
    source = $legacyAccounts
    destination = $targetAccounts
    source_account_count = $legacyCount
    destination_account_count = $newCount
    active_account_id = $validated.active_account_id
    source_sha256_before = $sourceHashBefore
    source_sha256_after = $sourceHashAfter
    destination_sha256 = (Get-FileHash -LiteralPath $targetAccounts -Algorithm SHA256).Hash
    codex_auth_sha256_before = $authHashBefore
    codex_auth_sha256_after = $authHashAfter
    backup_directory = $BackupRoot
}
$reportPath = Join-Path $TargetDir 'migration-report.json'
[System.IO.File]::WriteAllText(
    $reportPath,
    ($report | ConvertTo-Json -Depth 6),
    [System.Text.UTF8Encoding]::new($false)
)

Write-Host 'Migration completed safely.' -ForegroundColor Green
Write-Host "Accounts: $newCount"
Write-Host "Backup: $BackupRoot"
Write-Host "Report: $reportPath"
Write-Host 'Legacy accounts and Codex auth.json were not modified.'
