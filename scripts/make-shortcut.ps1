<#
  Create a desktop shortcut named after "name" in browser.config.json, with the project icon.
  Usage: powershell -ExecutionPolicy Bypass -File scripts\make-shortcut.ps1
#>
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$cfg = Get-Content (Join-Path $repo "browser.config.json") -Raw | ConvertFrom-Json

$desktop = [Environment]::GetFolderPath("Desktop")
$lnk = Join-Path $desktop ($cfg.name + ".lnk")

$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut($lnk)
$s.TargetPath = Join-Path $env:WINDIR "System32\wscript.exe"
$s.Arguments = "`"" + (Join-Path $PSScriptRoot "launch.vbs") + "`""
$s.WorkingDirectory = $repo
$s.IconLocation = (Join-Path $repo "assets\icon.ico")
$s.Description = $cfg.name
$s.Save()
Write-Host "Shortcut created: $lnk"
