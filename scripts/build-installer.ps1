<#
  Build dist\Fjord-Setup.exe: a self-extracting installer made with IExpress (built into Windows, no extra tools).
  It carries payload.zip (the launcher scripts + the bundled extensions) and installer\install.ps1.
  The Chromium snapshot is NOT inside: install.ps1 downloads it on the target PC.

  Usage: powershell -ExecutionPolicy Bypass -File scripts\build-installer.ps1
#>
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $repo "dist"
$stage = Join-Path $dist "stage"
$app = Join-Path $stage "app"
$exe = Join-Path $dist "Fjord-Setup.exe"

# the service worker entry is generated (and untracked): make sure it is current before copying
if (Get-Command node -ErrorAction SilentlyContinue) { & node (Join-Path $PSScriptRoot "stamp-build.mjs") | Out-Null }
if (-not (Test-Path (Join-Path $repo "extensions\fjord\sw.js"))) { throw "extensions\fjord\sw.js is missing (run node scripts\stamp-build.mjs)" }

if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Force $app | Out-Null

function Copy-Into($rel, $exclude = @()) {
  $src = Join-Path $repo $rel
  $dst = Join-Path $app $rel
  New-Item -ItemType Directory -Force (Split-Path -Parent $dst) | Out-Null
  Copy-Item $src $dst -Recurse -Force -Exclude $exclude
}

foreach ($f in "launch.ps1", "launch.vbs", "run-test-chromium.ps1", "make-shortcut.ps1", "set-exe-icon.ps1", "taskbar-identity.ps1",
               "stamp-build.mjs", "pin-extensions.mjs", "apply-prefs.mjs", "brand-exe.mjs", "brand-paks.mjs") {
  Copy-Into "scripts\$f"
}
Copy-Into "scripts\lib"
Copy-Into "extensions\fjord"
Copy-Into "extensions\theme" @("Cached Theme.pak")   # Chromium regenerates the theme pack on the target PC
Copy-Into "assets\icon.ico"
Copy-Into "assets\icon.png"
Copy-Into "browser.config.json"
Copy-Item (Join-Path $repo "installer\uninstall.ps1") (Join-Path $app "uninstall.ps1")

$zip = Join-Path $stage "payload.zip"
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($app, $zip, [System.IO.Compression.CompressionLevel]::Optimal, $false)
Copy-Item (Join-Path $repo "installer\install.ps1") $stage
Copy-Item (Join-Path $repo "installer\install.cmd") $stage

# IExpress directive file (ASCII only; the Korean texts live in install.ps1)
$sed = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=0
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=%InstallPrompt%
DisplayLicense=%DisplayLicense%
FinishMessage=%FinishMessage%
TargetName=%TargetName%
FriendlyName=%FriendlyName%
AppLaunched=%AppLaunched%
PostInstallCmd=%PostInstallCmd%
AdminQuietInstCmd=%AdminQuietInstCmd%
UserQuietInstCmd=%UserQuietInstCmd%
SourceFiles=SourceFiles
[Strings]
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=$exe
FriendlyName=Fjord Setup
AppLaunched=cmd /c install.cmd
PostInstallCmd=<None>
AdminQuietInstCmd=cmd /c install.cmd -Silent -NoLaunch
UserQuietInstCmd=cmd /c install.cmd -Silent -NoLaunch
FILE0="install.cmd"
FILE1="install.ps1"
FILE2="payload.zip"
[SourceFiles]
SourceFiles0=$stage\
[SourceFiles0]
%FILE0%=
%FILE1%=
%FILE2%=
"@
$sedFile = Join-Path $dist "Fjord-Setup.sed"
Set-Content -Path $sedFile -Value $sed -Encoding ascii

# IExpress sometimes fails when a virus scanner still holds the freshly written files: retry a few times
for ($i = 1; $i -le 6 -and -not (Test-Path $exe); $i++) {
  Start-Process -FilePath (Join-Path $env:WINDIR "System32\iexpress.exe") -ArgumentList @("/N", "/Q", $sedFile)   # IExpress does not accept a quoted path; the repo path has no spaces -Wait | Out-Null
  if (-not (Test-Path $exe)) { Start-Sleep -Seconds 3 }
}
if (-not (Test-Path $exe)) { throw "IExpress did not produce $exe" }
$mb = [math]::Round((Get-Item $exe).Length / 1MB, 1)
Write-Host "Built $exe ($mb MB)"
