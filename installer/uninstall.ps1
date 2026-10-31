# Fjord uninstaller (also reachable from Settings > Apps). UTF-8 with BOM for the Korean messages.
param([switch]$Silent, [switch]$DeleteData)
$ErrorActionPreference = "Continue"
$Dir = Split-Path -Parent $MyInvocation.MyCommand.Path
try { $Host.UI.RawUI.WindowTitle = "Fjord 제거" } catch {}

Write-Host ""
Write-Host "  Fjord를 제거해요: $Dir" -ForegroundColor White

# running Fjord windows hold files open
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq "fjord.exe" -and $_.CommandLine -like "*profile-app*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Remove-Item (Join-Path ([Environment]::GetFolderPath("Desktop")) "Fjord.lnk") -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Fjord.lnk") -Force -ErrorAction SilentlyContinue
Remove-Item "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Fjord" -Recurse -Force -ErrorAction SilentlyContinue

# browsing data (profile, bookmarks, logins) and the downloaded Chromium live outside the program folder
$data = Join-Path $env:USERPROFILE "BrowserProject\chromium-snapshot"
if (Test-Path $data) {
  $delete = [bool]$DeleteData   # unattended runs never delete browsing data unless asked to with -DeleteData
  if (-not $Silent -and -not $DeleteData) {
    $answer = Read-Host "  방문 기록·북마크·로그인과 내려받은 Chromium(약 1GB)도 지울까요? (y/N)"
    $delete = $answer -match '^[yY]'
  }
  if ($delete) { Remove-Item $data -Recurse -Force -ErrorAction SilentlyContinue; Write-Host "  데이터를 지웠어요." }
  else { Write-Host "  데이터는 그대로 두었어요: $data" }
}

# this script lives inside the folder it deletes: let a detached cmd finish the job after we exit
Start-Process cmd.exe -WindowStyle Hidden -ArgumentList "/c ping -n 3 127.0.0.1 >nul & rmdir /s /q `"$Dir`""
Write-Host "  제거가 끝났어요." -ForegroundColor Green
if (-not $Silent) { Read-Host "Enter 키를 누르면 창이 닫혀요" | Out-Null }
