<#
  Launch the browser: official Chromium snapshot + the bundled extensions listed in browser.config.json.
  Uses its own profile (profileName in the config), separate from the test profile.

  Usage: powershell -ExecutionPolicy Bypass -File scripts\launch.ps1 [-Update] [-Url <page>]
#>
param(
  [switch]$Update,
  [string]$Url = ""
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$cfg = Get-Content (Join-Path $repo "browser.config.json") -Raw | ConvertFrom-Json

if (-not $Url) { $Url = $cfg.startUrl }

$exts = @()
foreach ($e in $cfg.extensions) {
  $p = (Resolve-Path (Join-Path $repo $e)).Path
  if (-not (Test-Path (Join-Path $p "manifest.json"))) { throw "no manifest.json in $p" }
  $exts += $p
}

$extra = @("--disable-features=DisableLoadExtensionCommandLineSwitch")
if ($exts.Count -gt 0) { $extra += "--load-extension=$($exts -join ',')" }

$testScript = Join-Path $PSScriptRoot "run-test-chromium.ps1"
if ($Update) { & $testScript -NoLaunch -Update }
& $testScript -ProfileName $cfg.profileName -ExtraArgs $extra -Url $Url
