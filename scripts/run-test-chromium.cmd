@echo off
rem Double-click to run (downloads the Chromium snapshot on first run, then opens the test profile).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-test-chromium.ps1" %*
