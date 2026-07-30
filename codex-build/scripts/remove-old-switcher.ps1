[CmdletBinding()]
param(
    [switch]$Apply,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$legacyAccountsPath = Join-Path $env:USERPROFILE '.codex-switcher\accounts.json'
$hardenedAccountsPath = Join-Path $env:USERPROFILE '.codex-switcher-hardened\accounts.json'

function Read-Count([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    $store = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    return @($store.accounts).Count
}

$uninstallRoots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)
$entries = Get-ChildItem -Path $uninstallRoots -ErrorAction SilentlyContinue |
    Get-ItemProperty -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -eq 'Codex Switcher' }

if (-not $entries) {
    Write-Host 'Old Codex Switcher installation was not found.'
    exit 0
}

$legacyCount = Read-Count $legacyAccountsPath
$hardenedCount = Read-Count $hardenedAccountsPath
$entries | Select-Object DisplayName, DisplayVersion, UninstallString | Format-List
Write-Host "Legacy accounts: $legacyCount"
Write-Host "Hardened accounts: $hardenedCount"

if (-not $Apply) {
    Write-Host 'Dry run only. Re-run with -Apply after the hardened version is verified.' -ForegroundColor Yellow
    exit 0
}

if (-not $Force -and ($null -eq $legacyCount -or $null -eq $hardenedCount -or $legacyCount -ne $hardenedCount)) {
    throw 'Account stores are missing or counts differ. Old application was not removed. Use -Force only after manual verification.'
}

foreach ($entry in $entries) {
    $command = [string]$entry.UninstallString
    if ([string]::IsNullOrWhiteSpace($command)) { continue }
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/d', '/s', '/c', $command -Wait
}
Write-Host 'Old application uninstall completed or was started. Legacy account data was intentionally kept.' -ForegroundColor Green
