@echo off
start "" /b powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-server.ps1"
