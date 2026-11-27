#requires -Version 5.1
# Tonnetz Studio launcher (standalone; port 8850-8870).
param([switch]$NoBrowser)

$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
if (-not $root) { $root = Split-Path -Parent $MyInvocation.MyCommand.Path }
$root = [System.IO.Path]::GetFullPath($root)
$runtime = Join-Path $root '.runtime'
if (-not (Test-Path $runtime)) { New-Item -ItemType Directory -Path $runtime | Out-Null }
$log = Join-Path $runtime 'launcher.log'

function Write-Log([string]$msg) {
  try {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    Add-Content -LiteralPath $log -Value $line -Encoding UTF8
  } catch { }
}

function Show-Error([string]$msg) {
  Write-Log "ERROR: $msg"
  try {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($msg, 'Tonnetz Studio 曲谱同步', 'OK', 'Error') | Out-Null
  } catch {
    Write-Host $msg -ForegroundColor Red
  }
}

function Test-TonnetzStudioServer([int]$port) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/api/ping" -TimeoutSec 2
    return ($r.StatusCode -eq 200 -and $r.Content -match '"app":"tonnetz-studio"')
  } catch { return $false }
}

function Find-FreePort([int]$start, [int]$end) {
  for ($p = $start; $p -le $end; $p++) {
    $l = $null
    try {
      $l = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $p)
      $l.Start()
      $l.Stop()
      return $p
    } catch {
      if ($l) { try { $l.Stop() } catch { } }
    }
  }
  return 0
}

$url = $null

if (Test-TonnetzStudioServer 8850) {
  $url = 'http://127.0.0.1:8850/'
  Write-Log 'Tonnetz Studio already running on 8850'
}

if (-not $url) {
  $port = Find-FreePort 8850 8870
  if ($port -eq 0) {
    Show-Error 'No free port in 8850-8870. Close the program using it and retry.'
    exit 1
  }
  $psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  if (-not (Test-Path $psExe)) { $psExe = 'powershell.exe' }
  $server = Join-Path $root 'lite-server.ps1'
  $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $server + '"'), '-Port', $port, '-Quiet')
  try {
    Start-Process -FilePath $psExe -ArgumentList $argList -WindowStyle Hidden -WorkingDirectory $root | Out-Null
    Write-Log "started server on port $port"
  } catch {
    Show-Error "Cannot start local server: $($_.Exception.Message)"
    exit 1
  }
  $ok = $false
  for ($i = 0; $i -lt 48; $i++) {
    Start-Sleep -Milliseconds 250
    if (Test-TonnetzStudioServer $port) { $ok = $true; break }
  }
  if (-not $ok) {
    Show-Error 'The server did not start in time. Check .runtime\launcher.log.'
    exit 1
  }
  $url = "http://127.0.0.1:$port/"
}

try {
  Set-Content -LiteralPath (Join-Path $runtime 'url.txt') -Value $url -Encoding UTF8
} catch { }
Write-Log "open $url"
if (-not $NoBrowser) {
  try {
    Start-Process $url | Out-Null
  } catch {
    Show-Error "Cannot open browser. Open this URL manually: $url"
    exit 1
  }
}

