[CmdletBinding()]
param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\CodexSwitcherHardened'),
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourceExe = Join-Path $scriptDir 'codex-switcher-hardened.exe'
if (-not (Test-Path -LiteralPath $sourceExe -PathType Leaf)) {
    throw "Portable executable not found next to installer script: $sourceExe"
}

$blocking = Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ProcessName -match '^(codex-switcher|codex-switcher-hardened)$'
}
if ($blocking) {
    $names = ($blocking | Select-Object -ExpandProperty ProcessName -Unique) -join ', '
    throw "Close both Switcher applications before installation. Running: $names"
}

$legacyStore = Join-Path $env:USERPROFILE '.codex-switcher\accounts.json'
$legacyHashBefore = if (Test-Path -LiteralPath $legacyStore -PathType Leaf) {
    (Get-FileHash -LiteralPath $legacyStore -Algorithm SHA256).Hash
} else { $null }

$targetExe = Join-Path $InstallDir 'codex-switcher-hardened.exe'
if ((Test-Path -LiteralPath $targetExe -PathType Leaf) -and -not $Force) {
    $existingVersion = (Get-Item -LiteralPath $targetExe).VersionInfo.ProductVersion
    throw "Hardened installation already exists ($existingVersion). Re-run with -Force only for an intentional upgrade."
}

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
$tempExe = "$targetExe.new"
Copy-Item -LiteralPath $sourceExe -Destination $tempExe -Force
if ((Get-FileHash -LiteralPath $sourceExe -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $tempExe -Algorithm SHA256).Hash) {
    Remove-Item -LiteralPath $tempExe -Force -ErrorAction SilentlyContinue
    throw 'Executable hash mismatch after copy.'
}
if (Test-Path -LiteralPath $targetExe -PathType Leaf) {
    Move-Item -LiteralPath $targetExe -Destination "$targetExe.previous" -Force
}
Move-Item -LiteralPath $tempExe -Destination $targetExe -Force

$uninstallScript = Join-Path $InstallDir 'uninstall-hardened.ps1'
$uninstallBody = @'
$ErrorActionPreference = 'Stop'
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Codex Switcher Hardened.lnk'
Remove-Item -LiteralPath $startMenu -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\CodexSwitcherHardened' -Recurse -Force -ErrorAction SilentlyContinue
$installDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile','-Command',"Start-Sleep 1; Remove-Item -LiteralPath '$installDir' -Recurse -Force")
'@
[IO.File]::WriteAllText($uninstallScript, $uninstallBody, [Text.UTF8Encoding]::new($false))

$startMenuDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
New-Item -ItemType Directory -Path $startMenuDir -Force | Out-Null
$shortcutPath = Join-Path $startMenuDir 'Codex Switcher Hardened.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetExe
$shortcut.WorkingDirectory = $InstallDir
$shortcut.Description = 'Codex Switcher Hardened 0.3.1'
$shortcut.Save()

$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\CodexSwitcherHardened'
New-Item -Path $uninstallKey -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name DisplayName -Value 'Codex Switcher Hardened' -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name DisplayVersion -Value '0.3.1' -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name InstallLocation -Value $InstallDir -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name DisplayIcon -Value $targetExe -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name UninstallString -Value "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$uninstallScript`"" -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name NoModify -Value 1 -PropertyType DWord -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name NoRepair -Value 1 -PropertyType DWord -Force | Out-Null

$legacyHashAfter = if (Test-Path -LiteralPath $legacyStore -PathType Leaf) {
    (Get-FileHash -LiteralPath $legacyStore -Algorithm SHA256).Hash
} else { $null }
if ($legacyHashAfter -ne $legacyHashBefore) {
    throw 'Safety check failed: legacy accounts.json changed during installation.'
}

Write-Host 'Codex Switcher Hardened 0.3.1 installed.' -ForegroundColor Green
Write-Host "Executable: $targetExe"
Write-Host "Shortcut: $shortcutPath"
Write-Host 'The legacy account store was not modified.'
Write-Host 'Do not launch the app until account migration is completed.' -ForegroundColor Yellow
