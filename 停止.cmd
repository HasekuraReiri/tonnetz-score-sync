@echo off
rem Tonnetz Studio - stop local server
start "" /b powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-server.ps1"
