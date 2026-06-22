# Install Desktop Calendar by copying the prebuilt app into the per-user
# Programs folder and creating shortcuts — NO NSIS installer.
#
# Why: some AV products (e.g. AVG) quarantine the exe that the NSIS installer
# DROPS into a "Programs" folder, even though the identical exe runs fine when
# copied directly. This script sidesteps that by copying the files itself.
#
# Run after `npm run build` (or `electron-builder --dir`) has produced
# dist\win-unpacked. Optionally signs the copied exe first via scripts\sign.ps1.
param(
  [switch]$NoSign
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$src  = Join-Path $root 'dist\win-unpacked'
if (-not (Test-Path (Join-Path $src 'Desktop Calendar.exe'))) {
  throw "dist\win-unpacked not found. Run `npm run build` first."
}

if (-not $NoSign) {
  & (Join-Path $PSScriptRoot 'sign.ps1') -Files ((Get-ChildItem $src -Filter *.exe).FullName)
}

$dst = Join-Path $env:LOCALAPPDATA 'Programs\Desktop Calendar'
Write-Host "Installing to $dst"
New-Item -ItemType Directory -Force $dst | Out-Null
Copy-Item (Join-Path $src '*') $dst -Recurse -Force
Copy-Item (Join-Path $root 'build\icon.ico') (Join-Path $dst 'app.ico') -Force

$exe = Join-Path $dst 'Desktop Calendar.exe'
$ico = Join-Path $dst 'app.ico'
$ws = New-Object -ComObject WScript.Shell
$targets = @(
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Desktop Calendar.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Desktop Calendar.lnk')
)
foreach ($lnk in $targets) {
  $sc = $ws.CreateShortcut($lnk)
  $sc.TargetPath = $exe
  $sc.WorkingDirectory = $dst
  $sc.IconLocation = $ico
  $sc.Description = 'Desktop Calendar'
  $sc.Save()
  Write-Host "shortcut -> $lnk"
}
Write-Host "`nDone. Launch from the Start Menu or Desktop shortcut."
Write-Host "To uninstall: close the app, delete '$dst' and the two shortcuts."
