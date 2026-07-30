[CmdletBinding()]
param(
    [string]$SourceDir = (Join-Path $env:USERPROFILE '.codex-switcher'),
    [string]$TargetDir = (Join-Path $env:USERPROFILE '.codex-switcher-hardened'),
    [string]$CodexDir = (Join-Path $env:USERPROFILE '.codex')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$legacy = Join-Path $SourceDir 'accounts.json'
$hardened = Join-Path $TargetDir 'accounts.json'
$reportPath = Join-Path $TargetDir 'migration-report.json'
$codexAuth = Join-Path $CodexDir 'auth.json'

function Read-Json([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "File not found: $Path" }
    Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
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

function Account-Key([object]$Account) {
    $type = if ($null -ne $Account.auth_data -and $Account.auth_data.PSObject.Properties.Name -contains 'type') {
        [string]$Account.auth_data.type
    } else { [string]$Account.auth_mode }
    if ($type -in @('chatgpt', 'chat_gpt', 'chat_g_pt', 'chat_g_p_t', 'ChatGPT')) {
        $workspace = [string]$Account.auth_data.account_id
        $user = if ($Account.PSObject.Properties.Name -contains 'user_id') { [string]$Account.user_id } else { '' }
        if ([string]::IsNullOrWhiteSpace($user) -and $Account.auth_data.PSObject.Properties.Name -contains 'id_token') {
            $claims = Decode-JwtPayload ([string]$Account.auth_data.id_token)
            if ($null -ne $claims) {
                if ($claims.PSObject.Properties.Name -contains 'chatgpt_user_id') {
                    $user = [string]$claims.chatgpt_user_id
                }
                elseif ($claims.PSObject.Properties.Name -contains 'sub') {
                    $user = [string]$claims.sub
                }
            }
        }
        if (-not [string]::IsNullOrWhiteSpace($workspace)) { return "chatgpt:${user}:$workspace" }
        return "chatgpt-local-id:$([string]$Account.id)"
    }
    return "api-local-id:$([string]$Account.id)"
}

function To-Multiset([string[]]$Values) {
    $map = @{}
    foreach ($value in $Values) {
        if (-not $map.ContainsKey($value)) { $map[$value] = 0 }
        $map[$value] += 1
    }
    return $map
}

$old = Read-Json $legacy
$new = Read-Json $hardened
$report = Read-Json $reportPath
$oldAccounts = @($old.accounts)
$newAccounts = @($new.accounts)

$oldIds = @($oldAccounts | ForEach-Object { [string]$_.id })
$newIds = @($newAccounts | ForEach-Object { [string]$_.id })
$duplicateOldIds = @($oldIds | Group-Object | Where-Object Count -gt 1)
$duplicateNewIds = @($newIds | Group-Object | Where-Object Count -gt 1)

$oldMap = To-Multiset @($oldAccounts | ForEach-Object { Account-Key $_ })
$newMap = To-Multiset @($newAccounts | ForEach-Object { Account-Key $_ })
$allKeys = @($oldMap.Keys + $newMap.Keys | Sort-Object -Unique)
$mismatches = @($allKeys | Where-Object {
    $oldValue = if ($oldMap.ContainsKey($_)) { $oldMap[$_] } else { 0 }
    $newValue = if ($newMap.ContainsKey($_)) { $newMap[$_] } else { 0 }
    $oldValue -ne $newValue
})

$activeId = [string]$new.active_account_id
$activeValid = [string]::IsNullOrWhiteSpace($activeId) -or $activeId -in $newIds
$sourceHashCurrent = (Get-FileHash -LiteralPath $legacy -Algorithm SHA256).Hash
$sourceUnchanged = $sourceHashCurrent -eq [string]$report.source_sha256_before
$codexAuthPresent = Test-Path -LiteralPath $codexAuth -PathType Leaf
$authUnchangedSinceMigration = $true
if ($codexAuthPresent -and $report.PSObject.Properties.Name -contains 'codex_auth_sha256_after') {
    $authUnchangedSinceMigration = (Get-FileHash -LiteralPath $codexAuth -Algorithm SHA256).Hash -eq [string]$report.codex_auth_sha256_after
}

$statusOk = (
    $oldAccounts.Count -eq $newAccounts.Count -and
    $mismatches.Count -eq 0 -and
    $duplicateOldIds.Count -eq 0 -and
    $duplicateNewIds.Count -eq 0 -and
    $activeValid -and
    $sourceUnchanged -and
    $authUnchangedSinceMigration -and
    [string]$report.status -eq 'OK'
)

$result = [ordered]@{
    legacy_count = $oldAccounts.Count
    hardened_count = $newAccounts.Count
    active_account_id = $activeId
    active_account_valid = $activeValid
    identity_multiset_mismatches = $mismatches.Count
    duplicate_legacy_ids = $duplicateOldIds.Count
    duplicate_hardened_ids = $duplicateNewIds.Count
    legacy_store_unchanged = $sourceUnchanged
    codex_auth_present = $codexAuthPresent
    codex_auth_unchanged_since_migration = $authUnchangedSinceMigration
    status = if ($statusOk) { 'OK' } else { 'REVIEW' }
}

$result | Format-List
if (-not $statusOk) {
    if ($mismatches.Count -gt 0) {
        Write-Host 'Identity count mismatches:' -ForegroundColor Yellow
        $mismatches | ForEach-Object { Write-Host "  $_ old=$($oldMap[$_]) new=$($newMap[$_])" }
    }
    exit 2
}
Write-Host 'Account migration verification passed.' -ForegroundColor Green
