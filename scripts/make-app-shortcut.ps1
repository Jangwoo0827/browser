<#
  Desktop shortcut for the Electron version of Fjord (app/), with the project icon.
  Usage: powershell -ExecutionPolicy Bypass -File scripts\make-app-shortcut.ps1
#>
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$lnk = Join-Path ([Environment]::GetFolderPath("Desktop")) "Fjord (app).lnk"
$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut($lnk)
$s.TargetPath = Join-Path $env:WINDIR "System32\wscript.exe"
$s.Arguments = "`"" + (Join-Path $repo "app\run.vbs") + "`""
$s.WorkingDirectory = Join-Path $repo "app"
$s.IconLocation = Join-Path $repo "assets\icon.ico"
$s.Description = "Fjord (Electron)"
$s.Save()
. (Join-Path $PSScriptRoot "lib\shell-props.ps1")
[ShellProps]::SetLinkAppId($lnk, "Fjord.App")
Write-Host "Shortcut created: $lnk"
