<#
  Give every Fjord browser window a taskbar identity: our AppUserModelID plus a relaunch command, icon and name.
  With that, "Pin to taskbar" on the running window creates a proper Fjord pin (launcher + icon + name),
  and the pinned shortcut (stamped with the same id by make-shortcut.ps1) groups with the window.
  Runs hidden next to the browser and exits when the browser has no processes left.
  Usage: powershell -File scripts\taskbar-identity.ps1
#>
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\shell-props.ps1")

$repo = Split-Path -Parent $PSScriptRoot
$cfg = Get-Content (Join-Path $repo "browser.config.json") -Raw | ConvertFrom-Json
$exe = $cfg.name.ToLower() + ".exe"
$appId = $cfg.appId
if (-not $appId) { $appId = "$($cfg.name).Browser" }

# one watcher at a time
$created = $false
$mutex = New-Object System.Threading.Mutex($true, "Local\$appId.TaskbarIdentity", [ref]$created)
if (-not $created) { return }

$launcher = "wscript.exe `"" + (Join-Path $PSScriptRoot "launch.vbs") + "`""
$icon = (Join-Path $repo "assets\icon.ico") + ",0"
$idleSince = $null
$done = @{}   # window handles already stamped (the shell does not let us read the values back)

while ($true) {
  $pids = @(Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($exe)) -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  if ($pids.Count -eq 0) {
    if (-not $idleSince) { $idleSince = Get-Date }
    if (((Get-Date) - $idleSince).TotalSeconds -gt 60) { break }   # browser had 60 s to appear, or has quit
  } else {
    $idleSince = $null
    foreach ($h in [ShellProps]::BrowserWindows([uint32[]]$pids)) {
      if ($done.ContainsKey([string]$h)) { continue }
      try { [void][ShellProps]::SetWindowIdentity($h, $appId, $launcher, $icon, $cfg.name); $done[[string]$h] = $true } catch {}
    }
  }
  Start-Sleep -Milliseconds 1500
}
