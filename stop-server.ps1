#requires -Version 5.1
# Stops only this folder's lite-server.ps1. Never touches other Tonnetz copies.
param([switch]$Quiet)
$ErrorActionPreference = 'SilentlyContinue'
$root = $PSScriptRoot
if (-not $root) { $root = Split-Path -Parent $MyInvocation.MyCommand.Path }
$root = [System.IO.Path]::GetFullPath($root)
$runtime = Join-Path $root '.runtime'
$pidFile = Join-Path $runtime 'server.pid'
$stopped = 0
$selfPid = $PID
$rootFilter = [regex]::Escape($root)

if (Test-Path -LiteralPath $pidFile) {
  $serverPid = (Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($serverPid -match '^\d+$') {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$serverPid" -ErrorAction SilentlyContinue
    if ($proc -and $proc.CommandLine -and $proc.CommandLine -match '[\\/]lite-server\.ps1' -and $proc.CommandLine -match $rootFilter) {
      Stop-Process -Id ([int]$serverPid) -Force -ErrorAction SilentlyContinue
      $stopped++
    }
  }
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.ProcessId -ne $selfPid -and $_.CommandLine -and $_.CommandLine -match '[\\/]lite-server\.ps1' -and $_.CommandLine -match $rootFilter } |
  ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    $stopped++
  }

if (-not $Quiet) {
  try {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show("Tonnetz Studio server stopped: $stopped", 'Tonnetz Studio', 'OK', 'Information') | Out-Null
  } catch {
    Write-Host "Tonnetz Studio server stopped: $stopped"
  }
} else {
  Write-Host "Tonnetz Studio server stopped: $stopped"
}