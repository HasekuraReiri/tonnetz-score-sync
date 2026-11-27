#requires -Version 5.1
# Tonnetz Lite local static server. Loopback only.
param(
  [int]$Port = 8850,
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (-not $root) { $root = Split-Path -Parent $MyInvocation.MyCommand.Path }
$root = [System.IO.Path]::GetFullPath($root)
$runtime = Join-Path $root '.runtime'
if (-not (Test-Path $runtime)) { New-Item -ItemType Directory -Path $runtime | Out-Null }

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.htm'  = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.mjs'  = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.gif'  = 'image/gif'
  '.ico'  = 'image/x-icon'
  '.webp' = 'image/webp'
  '.woff' = 'font/woff'
  '.woff2' = 'font/woff2'
  '.ttf'  = 'font/ttf'
  '.map'  = 'application/json; charset=utf-8'
  '.txt'  = 'text/plain; charset=utf-8'
  '.md'   = 'text/plain; charset=utf-8'
  '.xml'  = 'application/xml; charset=utf-8'
  '.musicxml' = 'application/vnd.recordare.musicxml+xml; charset=utf-8'
  '.mxl'  = 'application/vnd.recordare.musicxml'
  '.mid'  = 'audio/midi'
  '.midi' = 'audio/midi'
  '.mp3'  = 'audio/mpeg'
  '.wav'  = 'audio/wav'
  '.webm' = 'video/webm'
  '.mp4'  = 'video/mp4'
}

$listener = New-Object System.Net.HttpListener
$prefix = "http://127.0.0.1:$Port/"
$listener.Prefixes.Add($prefix)
try {
  $listener.Start()
} catch {
  Write-Host "Cannot start server on port $Port : $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

$PID | Out-String | Set-Content -Path (Join-Path $runtime 'server.pid') -Encoding ASCII
if (-not $Quiet) {
  Write-Host "Tonnetz Studio server started: $prefix" -ForegroundColor Green
  Write-Host "Press Ctrl+C to stop."
}

function Send-Bytes {
  param($Context, [byte[]]$Bytes, [string]$ContentType, [int]$Status = 200, [string]$Cache = 'no-store')
  $res = $Context.Response
  $res.StatusCode = $Status
  $res.ContentType = $ContentType
  $res.Headers['Cache-Control'] = $Cache
  $res.Headers['X-Content-Type-Options'] = 'nosniff'
  $res.ContentLength64 = $Bytes.Length
  if ($Context.Request.HttpMethod -ne 'HEAD') {
    $res.OutputStream.Write($Bytes, 0, $Bytes.Length)
  }
  $res.OutputStream.Close()
}

function Send-Text {
  param($Context, [string]$Text, [string]$ContentType = 'text/plain; charset=utf-8', [int]$Status = 200)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
  Send-Bytes -Context $Context -Bytes $bytes -ContentType $ContentType -Status $Status
}

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    try {
      $req = $context.Request
      $path = $req.Url.AbsolutePath
      if ($path -eq '/api/ping') {
        Send-Text -Context $context -Text '{"app":"tonnetz-studio","ok":true}' -ContentType 'application/json; charset=utf-8'
        continue
      }
      if ($path -eq '/api/musescore' -and $req.HttpMethod -eq 'POST') {
        try {
          $len = [int]$req.ContentLength64
          if ($len -le 0 -or $len -gt 8388608) { throw 'invalid request size' }
          $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
          $body = $reader.ReadToEnd()
          $payload = $body | ConvertFrom-Json
          $xml = [string]$payload.xml
          if (-not $xml -or $xml.Length -lt 80) { throw 'empty MusicXML' }
          $safe = [string]$payload.name
          if (-not $safe) { $safe = 'score' }
          $safe = ($safe -replace '[^A-Za-z0-9._-]', '-').Trim('-')
          if (-not $safe) { $safe = 'score' }
          $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
          $dir = Join-Path $root 'exports\musescore'
          if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
          $file = Join-Path $dir ("{0}-{1}.musicxml" -f $safe, $stamp)
          $utf8 = New-Object System.Text.UTF8Encoding($false)
          [System.IO.File]::WriteAllText($file, $xml, $utf8)
          $ms = $null
          foreach ($p in @(
            (Join-Path $env:ProgramFiles 'MuseScore 4\bin\MuseScore4.exe'),
            (Join-Path ${env:ProgramFiles(x86)} 'MuseScore 4\bin\MuseScore4.exe'),
            (Join-Path $env:LOCALAPPDATA 'Programs\MuseScore 4\bin\MuseScore4.exe')
          )) {
            if ($p -and (Test-Path -LiteralPath $p)) { $ms = $p; break }
          }
          if (-not $ms) { throw 'MuseScore 4 not found' }
          $relFile = '/exports/musescore/' + [System.Uri]::EscapeDataString([System.IO.Path]::GetFileName($file))
          if ([string]$payload.mode -eq 'open') {
            Start-Process -FilePath $ms -ArgumentList ('"' + $file + '"') | Out-Null
            $resp = @{ ok = $true; file = $relFile; musescore = $ms } | ConvertTo-Json -Compress
            Send-Text -Context $context -Text $resp -ContentType 'application/json; charset=utf-8'
            continue
          }
          $base = [System.IO.Path]::Combine($dir, ("{0}-{1}" -f $safe, $stamp))
          $png = $base + '.png'
          $args = '-o "' + $png + '" "' + $file + '"'
          $proc = Start-Process -FilePath $ms -ArgumentList $args -Wait -PassThru -WindowStyle Hidden
          Start-Sleep -Milliseconds 250
          $pages = @(Get-ChildItem -LiteralPath $dir -Filter ((Split-Path -Leaf $base) + '-*.png') -ErrorAction SilentlyContinue | Sort-Object Name)
          if (-not $pages.Count) { throw ('MuseScore did not produce PNG (exit ' + $proc.ExitCode + ')') }
          $urls = @($pages | ForEach-Object { '/exports/musescore/' + [System.Uri]::EscapeDataString($_.Name) })
          $resp = @{ ok = $true; pages = $urls; file = $relFile; musescore = $ms } | ConvertTo-Json -Compress
          Send-Text -Context $context -Text $resp -ContentType 'application/json; charset=utf-8'
        } catch {
          $msg = [string]$_.Exception.Message
          $err = @{ ok = $false; error = $msg } | ConvertTo-Json -Compress
          Send-Text -Context $context -Text $err -ContentType 'application/json; charset=utf-8' -Status 500
        }
        continue
      }
      if ($path -eq '/' -or $path -eq '') { $path = '/index.html' }
      $rel = [System.Uri]::UnescapeDataString($path).TrimStart('/')
      $rel = $rel -replace '/', [System.IO.Path]::DirectorySeparatorChar
      $full = [System.IO.Path]::GetFullPath((Join-Path $root $rel))
      $rootFull = $root.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
      if (-not $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        Send-Text -Context $context -Text '403 Forbidden' -Status 403
        continue
      }
      if (Test-Path -LiteralPath $full -PathType Container) {
        $full = Join-Path $full 'index.html'
      }
      if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
        Send-Text -Context $context -Text "404 Not Found: $rel" -Status 404
        continue
      }
      $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
      $ctype = $mime[$ext]
      if (-not $ctype) { $ctype = 'application/octet-stream' }
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $cache = if ($ext -eq '.png' -or $ext -eq '.jpg' -or $ext -eq '.ico' -or $ext -eq '.woff2') { 'public, max-age=3600' } else { 'no-store' }
      Send-Bytes -Context $context -Bytes $bytes -ContentType $ctype -Cache $cache
    } catch {
      try { Send-Text -Context $context -Text '500 Internal Server Error' -Status 500 } catch { }
    }
  }
} finally {
  try { $listener.Stop(); $listener.Close() } catch { }
  try { Remove-Item -LiteralPath (Join-Path $runtime 'server.pid') -Force -ErrorAction SilentlyContinue } catch { }
}