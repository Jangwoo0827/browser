<#
  Download (once) the latest official Chromium snapshot for Windows x64 and launch it
  with a throw-away, separate profile so nothing touches your normal Chrome profile.

  Usage:
    powershell -ExecutionPolicy Bypass -File scripts\run-test-chromium.ps1            # download if missing, then run
    powershell -ExecutionPolicy Bypass -File scripts\run-test-chromium.ps1 -Update    # re-download newest snapshot
    powershell -ExecutionPolicy Bypass -File scripts\run-test-chromium.ps1 -Revision 1726626
    powershell -ExecutionPolicy Bypass -File scripts\run-test-chromium.ps1 -ResetProfile
    powershell -ExecutionPolicy Bypass -File scripts\run-test-chromium.ps1 -Url https://chromewebstore.google.com/
#>
param(
  [string]$Revision = "",
  [switch]$Update,
  [switch]$ResetProfile,
  [string]$Url = "https://chromewebstore.google.com/",
  [string]$Root = (Join-Path $env:LOCALAPPDATA "BrowserProject\chromium-snapshot")
)

$ErrorActionPreference = "Stop"
$base = "https://storage.googleapis.com/chromium-browser-snapshots/Win_x64"
$profileDir = Join-Path $Root "profile"
$binDir = Join-Path $Root "bin"

New-Item -ItemType Directory -Force $Root | Out-Null

if (-not $Revision) {
  if ((Test-Path (Join-Path $Root "revision.txt")) -and -not $Update) {
    $Revision = (Get-Content (Join-Path $Root "revision.txt") -Raw).Trim()
  } else {
    $Revision = (Invoke-RestMethod "$base/LAST_CHANGE").ToString().Trim()
  }
}

$chromeExe = Join-Path $binDir "chrome-win\chrome.exe"
$installed = if (Test-Path (Join-Path $Root "revision.txt")) { (Get-Content (Join-Path $Root "revision.txt") -Raw).Trim() } else { "" }

if (-not (Test-Path $chromeExe) -or $installed -ne $Revision) {
  $zip = Join-Path $Root "chrome-win-$Revision.zip"
  Write-Host "Downloading Chromium snapshot r$Revision (~370 MB) ..."
  Invoke-WebRequest "$base/$Revision/chrome-win.zip" -OutFile $zip
  if (Test-Path $binDir) { Remove-Item -Recurse -Force $binDir }
  Expand-Archive $zip -DestinationPath $binDir
  Remove-Item $zip
  Set-Content (Join-Path $Root "revision.txt") $Revision -Encoding ascii
}

if ($ResetProfile -and (Test-Path $profileDir)) {
  Remove-Item -Recurse -Force $profileDir
}

Write-Host "Chromium r$Revision, profile: $profileDir"
Start-Process $chromeExe -ArgumentList @(
  "--user-data-dir=`"$profileDir`"",
  "--no-first-run",
  "--no-default-browser-check",
  $Url
)
