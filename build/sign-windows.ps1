# KLM - tanda tangan kode Windows dengan sertifikat .pfx (signtool + timestamp)
# Dipakai CI bila secret WIN_CSC_LINK (isi file .pfx dalam base64) & WIN_CSC_KEY_PASSWORD tersedia.
#   pwsh build/sign-windows.ps1 -Files "dist/win-unpacked/KLM.exe","dist/KLM-Setup-1.16.0.exe"
param(
  [Parameter(Mandatory = $true)][string[]]$Files,
  [string]$Timestamp = "http://timestamp.digicert.com",
  [string]$Description = "KLM - Kinetic Live Mixer"
)
$ErrorActionPreference = "Stop"
if (-not $env:WIN_CSC_LINK) { Write-Host "WIN_CSC_LINK kosong - lewati tanda tangan"; exit 0 }

$pfx = Join-Path $env:RUNNER_TEMP "klm-sign.pfx"
[IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($env:WIN_CSC_LINK))
try {
  $signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
  if (-not $signtool) { throw "signtool.exe tidak ditemukan (Windows SDK)" }
  foreach ($f in $Files) {
    if (-not (Test-Path $f)) { Write-Host "::warning::tidak ada: $f"; continue }
    & $signtool.FullName sign /f $pfx /p "$env:WIN_CSC_KEY_PASSWORD" /fd sha256 /tr $Timestamp /td sha256 /d $Description "$f"
    if ($LASTEXITCODE -ne 0) { throw "gagal menandatangani $f" }
    & $signtool.FullName verify /pa "$f" | Out-Host
    Write-Host "Ditandatangani: $f"
  }
} finally {
  Remove-Item $pfx -Force -ErrorAction SilentlyContinue
}
