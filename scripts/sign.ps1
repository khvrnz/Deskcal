# Authenticode-sign the built artifacts with a self-signed code-signing cert.
#
# Usage:   powershell -ExecutionPolicy Bypass -File scripts\sign.ps1
#          powershell ... -File scripts\sign.ps1 -Files "dist\Desktop Calendar Setup 1.1.0.exe"
#
# Real (globally trusted) signing instead: pass a PFX from a CA-issued cert:
#          scripts\sign.ps1 -PfxPath C:\path\cert.pfx -PfxPassword 'secret'
#
# A self-signed signature is only trusted on machines where the public cert
# (dist\HarshacalDesktopCalendar.cer) has been added to Trusted Root + Trusted
# Publishers. See README / the install commands printed at the end.
param(
  [string[]]$Files,
  [string]$Subject = 'CN=Harshacal Desktop Calendar',
  [string]$PfxPath,
  [string]$PfxPassword,
  [string]$TimestampServer = 'http://timestamp.digicert.com'
)

$ErrorActionPreference = 'Stop'

if ($PfxPath) {
  $sec = if ($PfxPassword) { ConvertTo-SecureString $PfxPassword -AsPlainText -Force } else { $null }
  $cert = Get-PfxCertificate -FilePath $PfxPath -Password $sec
} else {
  $cert = Get-ChildItem Cert:\CurrentUser\My |
    Where-Object { $_.Subject -eq $Subject -and $_.EnhancedKeyUsageList.FriendlyName -contains 'Code Signing' } |
    Select-Object -First 1
  if (-not $cert) {
    Write-Host "Creating self-signed code-signing certificate..."
    $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $Subject `
      -FriendlyName 'Harshacal Desktop Calendar Code Signing' `
      -CertStoreLocation Cert:\CurrentUser\My -KeyUsage DigitalSignature `
      -KeyExportPolicy Exportable -KeyAlgorithm RSA -KeyLength 3072 `
      -HashAlgorithm SHA256 -NotAfter (Get-Date).AddYears(5)
  }
}

if (-not $Files -or $Files.Count -eq 0) {
  $base = Join-Path $env:LOCALAPPDATA 'Programs\Desktop Calendar'
  $Files = @(Get-ChildItem 'dist' -Filter '*.exe' -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
  foreach ($f in @('Desktop Calendar.exe', 'Uninstall Desktop Calendar.exe')) {
    $p = Join-Path $base $f; if (Test-Path $p) { $Files += $p }
  }
}

foreach ($f in $Files) {
  if (-not (Test-Path $f)) { Write-Host "MISSING  $f"; continue }
  $r = Set-AuthenticodeSignature -FilePath $f -Certificate $cert -HashAlgorithm SHA256 -TimestampServer $TimestampServer
  "{0,-14} {1}" -f $r.Status, (Split-Path $f -Leaf)
}

# Export public cert so it can be trusted on this/other machines.
$cer = 'dist\HarshacalDesktopCalendar.cer'
New-Item -ItemType Directory -Force 'dist' | Out-Null
Export-Certificate -Cert $cert -FilePath $cer -Force | Out-Null
Write-Host "`nPublic certificate: $cer"
Write-Host "To TRUST it on this PC (run an ELEVATED PowerShell):"
Write-Host "  Import-Certificate -FilePath '$cer' -CertStoreLocation Cert:\LocalMachine\Root"
Write-Host "  Import-Certificate -FilePath '$cer' -CertStoreLocation Cert:\LocalMachine\TrustedPublisher"
