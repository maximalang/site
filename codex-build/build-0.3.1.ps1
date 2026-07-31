[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$workspace = (Get-Location).Path
$payload = Join-Path $workspace 'payload'
$source = Join-Path $workspace 'source'
$deliverables = Join-Path $workspace 'deliverables'

Remove-Item -LiteralPath $source, $deliverables -Recurse -Force -ErrorAction SilentlyContinue

$parts = Get-ChildItem (Join-Path $payload 'codex-build\patch.part*') | Sort-Object Name
if ($parts.Count -ne 8) { throw "Expected 8 base patch parts, found $($parts.Count)" }
$encoded = ($parts | ForEach-Object { (Get-Content $_.FullName -Raw).Trim() }) -join ''
$gzipPath = Join-Path $workspace 'hardened.patch.gz'
$patchPath = Join-Path $workspace 'hardened.patch'
[IO.File]::WriteAllBytes($gzipPath, [Convert]::FromBase64String($encoded))
$input = [IO.File]::OpenRead($gzipPath)
$output = [IO.File]::Create($patchPath)
$gzip = [IO.Compression.GZipStream]::new($input, [IO.Compression.CompressionMode]::Decompress)
try { $gzip.CopyTo($output) } finally { $gzip.Dispose(); $output.Dispose(); $input.Dispose() }

& git clone https://github.com/Lampese/codex-switcher.git $source
Push-Location $source
try {
    & git checkout 31e2b962009a51f27e964fa5c1984b1aeb237079
    & git apply --check $patchPath
    & git apply $patchPath
    $fix1 = Join-Path $payload 'codex-build\fix-001-remove-updater-permission.patch'
    $fix5 = Join-Path $payload 'codex-build\fix-005-separate-install-0.3.1.patch'
    & git apply --check $fix1
    & git apply $fix1
    & git apply --check $fix5
    & git apply $fix5
    Copy-Item (Join-Path $payload 'codex-build\scripts\migrate-accounts.ps1') 'tools\migrate-accounts.ps1' -Force
    Copy-Item (Join-Path $payload 'codex-build\scripts\verify-accounts.ps1') 'tools\verify-accounts.ps1' -Force
    Copy-Item (Join-Path $payload 'codex-build\scripts\remove-old-switcher.ps1') 'tools\remove-old-switcher.ps1' -Force
    Copy-Item (Join-Path $payload 'codex-build\scripts\install-hardened.ps1') 'tools\install-hardened.ps1' -Force
}
finally { Pop-Location }

& corepack enable
& corepack prepare pnpm@10 --activate
& rustup target add x86_64-pc-windows-msvc

Push-Location $source
try {
    & pnpm install --frozen-lockfile
    & pnpm build

    $config = Get-Content 'src-tauri\tauri.conf.json' -Raw | ConvertFrom-Json
    $win = Get-Content 'src-tauri\tauri.windows.conf.json' -Raw | ConvertFrom-Json
    if ($config.productName -ne 'Codex Switcher Hardened') { throw 'Wrong productName' }
    if ($config.version -ne '0.3.1') { throw 'Wrong version' }
    if ($config.identifier -ne 'com.maximalang.codex-switcher-hardened') { throw 'Wrong identifier' }
    if ($win.app.windows[0].title -ne 'Codex Switcher Hardened') { throw 'Wrong Windows title' }
    $storage = Get-Content 'src-tauri\src\auth\storage.rs' -Raw
    if ($storage -notmatch 'CODEX_SWITCHER_HARDENED_HOME') { throw 'Dedicated home override missing' }
    if ($storage -match 'var\("CODEX_SWITCHER_HOME"\)') { throw 'Legacy home override is still accepted' }
    if ($storage -notmatch '\.codex-switcher-hardened') { throw 'Dedicated default store missing' }

    $scripts = @('tools\install-hardened.ps1','tools\migrate-accounts.ps1','tools\verify-accounts.ps1','tools\remove-old-switcher.ps1')
    foreach ($script in $scripts) {
        $tokens = $null
        $parseErrors = $null
        [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $script), [ref]$tokens, [ref]$parseErrors) | Out-Null
        if (@($parseErrors).Count -gt 0) {
            throw "PowerShell parse failure in $script`n$((@($parseErrors | ForEach-Object Message) -join "`n"))"
        }
    }

    function ConvertTo-Base64Url([string]$Text) {
        [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Text)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    }
    $testRoot = Join-Path $env:RUNNER_TEMP 'codex-switcher-migration-test'
    $legacy = Join-Path $testRoot 'legacy'
    $target = Join-Path $testRoot 'target'
    $codex = Join-Path $testRoot 'codex'
    $backup = Join-Path $testRoot 'backup'
    Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $legacy, $codex -Force | Out-Null
    $header = ConvertTo-Base64Url '{"alg":"none","typ":"JWT"}'
    $jwtPayload = ConvertTo-Base64Url '{"sub":"user-test-1","email":"test@example.com"}'
    $idToken = "$header.$jwtPayload.signature"
    $store = [ordered]@{
        version = 1
        accounts = @(
            [ordered]@{ id='account-1'; name='Primary'; email='test@example.com'; plan_type='plus'; auth_mode='chat_g_pt'; auth_data=[ordered]@{ type='chat_g_pt'; id_token=$idToken; access_token='access-1'; refresh_token='refresh-1'; account_id='workspace-1' }; created_at='2026-01-01T00:00:00Z'; last_used_at=$null },
            [ordered]@{ id='account-2'; name='API account'; email=$null; plan_type=$null; auth_mode='api_key'; auth_data=[ordered]@{ type='api_key'; key='sk-test-only' }; created_at='2026-01-01T00:00:00Z'; last_used_at=$null }
        )
        active_account_id = 'account-1'
        masked_account_ids = @()
    }
    [IO.File]::WriteAllText((Join-Path $legacy 'accounts.json'), ($store | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $codex 'auth.json'), (@{ tokens=@{ id_token=$idToken; access_token='access-live'; refresh_token='refresh-live'; account_id='workspace-1' } } | ConvertTo-Json -Depth 10), [Text.UTF8Encoding]::new($false))
    $sourceBefore = (Get-FileHash (Join-Path $legacy 'accounts.json') -Algorithm SHA256).Hash
    $authBefore = (Get-FileHash (Join-Path $codex 'auth.json') -Algorithm SHA256).Hash
    & '.\tools\migrate-accounts.ps1' -SourceDir $legacy -TargetDir $target -CodexDir $codex -BackupRoot $backup -SkipProcessCheck
    & '.\tools\verify-accounts.ps1' -SourceDir $legacy -TargetDir $target -CodexDir $codex
    if ($LASTEXITCODE -ne 0) { throw 'Synthetic verification failed' }
    if ($sourceBefore -ne (Get-FileHash (Join-Path $legacy 'accounts.json') -Algorithm SHA256).Hash) { throw 'Migration changed legacy store' }
    if ($authBefore -ne (Get-FileHash (Join-Path $codex 'auth.json') -Algorithm SHA256).Hash) { throw 'Migration changed Codex auth' }

    & cargo fmt --manifest-path src-tauri/Cargo.toml
    & cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
    & cargo test --release --target x86_64-pc-windows-msvc --manifest-path src-tauri/Cargo.toml
    & pnpm tauri:win build --target x86_64-pc-windows-msvc

    $portable = Join-Path $source 'src-tauri\target\x86_64-pc-windows-msvc\release\codex-switcher-hardened.exe'
    if (-not (Test-Path -LiteralPath $portable -PathType Leaf)) { throw 'Portable executable missing' }
    $portableTest = Join-Path $env:RUNNER_TEMP 'portable-package'
    $portableInstall = Join-Path $env:RUNNER_TEMP 'portable-installed'
    Remove-Item -LiteralPath $portableTest, $portableInstall -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $portableTest -Force | Out-Null
    Copy-Item $portable (Join-Path $portableTest 'codex-switcher-hardened.exe') -Force
    Copy-Item 'tools\install-hardened.ps1' $portableTest -Force
    & (Join-Path $portableTest 'install-hardened.ps1') -InstallDir $portableInstall
    $installed = Join-Path $portableInstall 'codex-switcher-hardened.exe'
    if (-not (Test-Path $installed)) { throw 'Portable installer did not copy executable' }
    if ((Get-FileHash $portable -Algorithm SHA256).Hash -ne (Get-FileHash $installed -Algorithm SHA256).Hash) { throw 'Portable installed binary hash mismatch' }
    $entry = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\CodexSwitcherHardened'
    if ($entry.DisplayVersion -ne '0.3.1') { throw 'Portable uninstall registration failed' }

    New-Item -ItemType Directory -Path $deliverables -Force | Out-Null
    $installer = Get-ChildItem 'src-tauri\target\x86_64-pc-windows-msvc\release\bundle\nsis\*.exe' | Select-Object -First 1
    if (-not $installer) { throw 'NSIS installer was not produced' }
    Copy-Item $installer.FullName (Join-Path $deliverables 'Codex-Switcher-Hardened-0.3.1-x64-setup.exe')
    Copy-Item $portable (Join-Path $deliverables 'codex-switcher-hardened.exe')
    Copy-Item 'tools\install-hardened.ps1' $deliverables
    Copy-Item 'tools\migrate-accounts.ps1' $deliverables
    Copy-Item 'tools\verify-accounts.ps1' $deliverables
    Copy-Item 'tools\remove-old-switcher.ps1' $deliverables
    Copy-Item 'HARDENED-README.md' $deliverables
    $lines = Get-ChildItem $deliverables -File | Sort-Object Name | ForEach-Object {
        $hash = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256
        "$($hash.Hash)  $($_.Name)"
    }
    [IO.File]::WriteAllLines((Join-Path $deliverables 'SHA256SUMS.txt'), $lines, [Text.UTF8Encoding]::new($false))
}
finally { Pop-Location }

Write-Host 'Codex Switcher Hardened 0.3.1 build completed.' -ForegroundColor Green
