@echo off
rem Mirror Claude's native messaging host registrations from Chrome to Chromium (Fjord). Run by double-clicking.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-native-hosts.ps1" %*
echo.
pause
