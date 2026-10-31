# Fjord installer. Runs from the self-extracting Fjord-Setup.exe (see scripts/build-installer.ps1).
# Saved as UTF-8 with BOM so Windows PowerShell 5.1 reads the Korean messages correctly.
# Flags (for tests / unattended installs): -Dir <folder> -Silent -NoDownload -NoShortcuts -NoLaunch
param(
  [string]$Dir = "",
  [switch]$Silent,
  [switch]$NoDownload,
  [switch]$NoShortcuts,
  [switch]$NoLaunch
)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Dir) { $Dir = Join-Path $env:LOCALAPPDATA "Programs\Fjord" }
try { $Host.UI.RawUI.WindowTitle = "Fjord 설치" } catch {}

function Step($n, $text) { Write-Host ""; Write-Host "[$n/5] $text" -ForegroundColor Cyan }
function Pause-Exit($code) {
  if (-not $Silent) { Write-Host ""; Read-Host "Enter 키를 누르면 창이 닫혀요" | Out-Null }
  exit $code
}

Write-Host ""
Write-Host "  Fjord 브라우저 설치" -ForegroundColor White
Write-Host "  설치 위치: $Dir" -ForegroundColor DarkGray

try {
  # ---- 1. files
  Step 1 "프로그램 파일 복사"
  $zip = Join-Path $here "payload.zip"
  if (-not (Test-Path $zip)) { throw "payload.zip 을 찾을 수 없어요." }
  if (Test-Path $Dir) {
    try { Remove-Item $Dir -Recurse -Force } catch { throw "기존 설치를 지울 수 없어요. 실행 중인 Fjord를 모두 닫고 다시 시도하세요." }
  }
  New-Item -ItemType Directory -Force $Dir | Out-Null
  Expand-Archive -Path $zip -DestinationPath $Dir -Force
  $version = "0"
  try { $version = (Get-Content (Join-Path $Dir "extensions\fjord\manifest.json") -Raw | ConvertFrom-Json).version } catch {}

  # ---- 2. uninstall entry (Settings > Apps)
  Step 2 "앱 목록에 등록"
  $key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Fjord"
  New-Item -Path $key -Force | Out-Null
  $props = @{
    DisplayName = "Fjord"; DisplayVersion = $version; Publisher = "Jangwoo0827"; InstallLocation = $Dir
    DisplayIcon = (Join-Path $Dir "assets\icon.ico"); NoModify = 1; NoRepair = 1
    UninstallString = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $Dir 'uninstall.ps1')`""
  }
  foreach ($k in $props.Keys) { Set-ItemProperty -Path $key -Name $k -Value $props[$k] }

  # ---- 3. shortcuts
  Step 3 "바로가기 만들기"
  if ($NoShortcuts) {
    Write-Host "  (건너뜀)"
  } else {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Dir "scripts\make-shortcut.ps1") | Out-Null
    $desktopLnk = Join-Path ([Environment]::GetFolderPath("Desktop")) "Fjord.lnk"
    $startDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
    if (Test-Path $desktopLnk) { Copy-Item $desktopLnk (Join-Path $startDir "Fjord.lnk") -Force }
    Write-Host "  바탕화면과 시작 메뉴에 Fjord를 추가했어요."
  }

  # ---- 4. Chromium
  Step 4 "Chromium 받기 (처음 한 번, 약 400MB)"
  if ($NoDownload) {
    Write-Host "  (건너뜀)"
  } else {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Dir "scripts\run-test-chromium.ps1") -NoLaunch -ProfileName profile-app
    if ($LASTEXITCODE -ne 0) { throw "Chromium을 받지 못했어요. 인터넷 연결을 확인하고 설치 파일을 다시 실행하세요." }
  }

  # ---- 5. notes
  Step 5 "마무리"
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "  참고: Node.js가 없어서 작업 표시줄 아이콘/이름 꾸미기는 건너뛰어요. (nodejs.org 에서 설치하면 적용돼요)" -ForegroundColor Yellow
  }
  Write-Host ""
  Write-Host "  설치가 끝났어요." -ForegroundColor Green

  if (-not $NoLaunch -and -not $Silent) {
    $answer = Read-Host "  지금 Fjord를 실행할까요? (Y/n)"
    if ($answer -notmatch '^[nN]') { Start-Process (Join-Path $env:WINDIR "System32\wscript.exe") -ArgumentList "`"$(Join-Path $Dir 'scripts\launch.vbs')`"" }
  }
  Pause-Exit 0
} catch {
  Write-Host ""
  Write-Host "  설치하지 못했어요: $($_.Exception.Message)" -ForegroundColor Red
  Pause-Exit 1
}
