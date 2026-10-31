@echo off
rem Started by the self-extracting Setup.exe in its temp folder.
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
