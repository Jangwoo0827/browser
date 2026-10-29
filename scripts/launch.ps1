<#
  Launch the browser: official Chromium snapshot + the bundled extensions listed in browser.config.json.
  Uses its own profile (profileName in the config), separate from the test profile.

  Usage: powershell -ExecutionPolicy Bypass -File scripts\launch.ps1 [-Update] [-Url <page>]
#>
param(
  [switch]$Update,
  [int]$DebugPort = 0,
  [string]$Url = ""
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
# The shortcut starts this hidden: keep a log so failures are not invisible.
New-Item -ItemType Directory -Force (Join-Path $repo "logs") | Out-Null
try { Start-Transcript -Path (Join-Path $repo "logs\launch.log") -Force | Out-Null } catch {}
$cfg = Get-Content (Join-Path $repo "browser.config.json") -Raw | ConvertFrom-Json

if (-not $Url) { $Url = $cfg.startUrl }

# service worker entry stamped with a hash of all extension files (Chromium ignores edits inside imported modules otherwise)
if (Get-Command node -ErrorAction SilentlyContinue) { & node (Join-Path $PSScriptRoot "stamp-build.mjs") | Out-Null }

$exts = @()
foreach ($e in $cfg.extensions) {
  $p = (Resolve-Path (Join-Path $repo $e)).Path
  if (-not (Test-Path (Join-Path $p "manifest.json"))) { throw "no manifest.json in $p" }
  $exts += $p
}

$extra = @("--disable-features=DisableLoadExtensionCommandLineSwitch")
if ($DebugPort -gt 0) { $extra += "--remote-debugging-port=$DebugPort" }  # loopback only; for debugging extensions
if ($exts.Count -gt 0) { $extra += "--load-extension=$($exts -join ',')" }

# Pin Fjord + Claude to the toolbar (only possible while this profile's browser is not running).
$profileDir = Join-Path $env:USERPROFILE ("BrowserProject\chromium-snapshot\" + $cfg.profileName)
$running = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -in @("chrome.exe", ($cfg.name.ToLower() + ".exe")) -and $_.CommandLine -like "*$($cfg.profileName)*" }
if (-not $running -and (Get-Command node -ErrorAction SilentlyContinue)) {
  & node (Join-Path $PSScriptRoot "pin-extensions.mjs") $profileDir "nnklkcbakchplbggofbfjijbmfepehnh" "fcoeoabgfenejglbffodgkkbkcdhcgfn" | Out-Null
  # browser preferences from browser.config.json (e.g. vertical tabs)
  if ($cfg.browserPrefs) {
    $patch = ($cfg.browserPrefs | ConvertTo-Json -Depth 10 -Compress)
    $b64 = "b64:" + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($patch))
    & node (Join-Path $PSScriptRoot "apply-prefs.mjs") $profileDir $b64 | Out-Null
  }
}

# Chromium keeps the extension's service worker registration in the profile and reuses it even when the extension's
# files (or the worker's script path) changed. When the build stamp changed, drop the cached workers (browser must be closed).
$swFile = Join-Path (Join-Path (Join-Path $repo "extensions") "fjord") "sw.js"
if ((Test-Path $swFile) -and -not $running) {
  $stamp = (Get-Content $swFile -TotalCount 1)
  $stampFile = Join-Path $profileDir "fjord-sw-stamp.txt"
  $old = if (Test-Path $stampFile) { (Get-Content $stampFile -TotalCount 1) } else { "" }
  if ($old -ne $stamp) {
    Remove-Item (Join-Path $profileDir "Default\Service Worker") -Recurse -Force -ErrorAction SilentlyContinue
    Set-Content $stampFile $stamp -Encoding ascii
  }
}

$testScript = Join-Path $PSScriptRoot "run-test-chromium.ps1"
$ensure = @{ NoLaunch = $true; ProfileName = $cfg.profileName }   # make sure the snapshot is installed
if ($Update) { $ensure.Update = $true }
& $testScript @ensure

# Branded copy of chrome.exe (our icon + name instead of "Chromium") and branded locale packs.
# Files are locked while the browser runs, so this only happens on a cold start.
$exeName = "chrome.exe"
if (Get-Command node -ErrorAction SilentlyContinue) {
  $chromeDir = Join-Path $env:USERPROFILE "BrowserProject\chromium-snapshot\bin\chrome-win"
  if (-not $running) {
    & node (Join-Path $PSScriptRoot "brand-exe.mjs") $chromeDir $cfg.name (Join-Path $repo "assets\icon.png")
    & node (Join-Path $PSScriptRoot "brand-paks.mjs") $chromeDir $cfg.name
  }
  if (Test-Path (Join-Path $chromeDir ($cfg.name.ToLower() + ".exe"))) { $exeName = $cfg.name.ToLower() + ".exe" }
}

& $testScript -ProfileName $cfg.profileName -ExeName $exeName -ExtraArgs $extra -Url $Url

# Taskbar identity watcher (hidden): AppUserModelID + relaunch command/icon/name on every Fjord window.
Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "taskbar-identity.ps1"))
