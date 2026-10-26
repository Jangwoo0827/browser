<#
  Let the Claude extension inside Fjord (official Chromium snapshot) reach the same Claude native messaging
  hosts that Google Chrome already has registered (Claude Code /chrome, Claude Desktop).

  How it works: Chromium on Windows looks up native messaging hosts under
    HKCU\Software\Chromium\NativeMessagingHosts\<host name>   (default value = path of the host manifest JSON)
  Claude registers its hosts only for Chrome (HKCU\Software\Google\Chrome\NativeMessagingHosts) and Edge.
  This script mirrors every "com.anthropic.*" registration into the Chromium key. The manifests it points to
  already list the Claude extension id in allowed_origins, which is the same id inside Fjord.

  IMPORTANT: run it from a normal PowerShell / double-click install-native-hosts.cmd, NOT from inside the
  Claude desktop app (its registry/file view is virtualized, so keys written there are invisible to Fjord).

  Usage:
    install-native-hosts.cmd            # show what would change, then apply
    install-native-hosts.cmd -DryRun    # only show
    install-native-hosts.cmd -Uninstall # remove the mirrored keys
#>
param(
  [switch]$DryRun,
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$target = "HKCU:\Software\Chromium\NativeMessagingHosts"
$sources = @(
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts",
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts"
)

if ($Uninstall) {
  if (Test-Path $target) {
    Get-ChildItem $target | Where-Object { $_.PSChildName -like "com.anthropic.*" } | ForEach-Object {
      Write-Host "remove $($_.PSChildName)"
      if (-not $DryRun) { Remove-Item $_.PSPath -Recurse -Force }
    }
  }
  return
}

$found = @{}
foreach ($src in $sources) {
  if (-not (Test-Path $src)) { continue }
  Get-ChildItem $src | Where-Object { $_.PSChildName -like "com.anthropic.*" } | ForEach-Object {
    $manifest = (Get-ItemProperty $_.PSPath).'(default)'
    if ($manifest -and -not $found.ContainsKey($_.PSChildName)) { $found[$_.PSChildName] = $manifest }
  }
}

if ($found.Count -eq 0) {
  Write-Host "No com.anthropic.* native messaging hosts are registered for Chrome or Edge yet."
  Write-Host "Run  claude --chrome  once (it registers com.anthropic.claude_code_browser_extension), then run this again."
  return
}

foreach ($name in $found.Keys) {
  $manifest = $found[$name]
  $ok = Test-Path $manifest
  Write-Host ("{0}`n  -> {1}  [{2}]" -f $name, $manifest, $(if ($ok) { "manifest exists" } else { "MANIFEST MISSING" }))
  if ($DryRun -or -not $ok) { continue }
  $key = Join-Path $target $name
  New-Item -Path $key -Force | Out-Null
  Set-Item -Path $key -Value $manifest
}

if ($DryRun) { Write-Host "(dry run: nothing written)" } else { Write-Host "Done. Restart Fjord so it re-reads the hosts." }
