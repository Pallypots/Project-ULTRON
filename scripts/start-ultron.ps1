# ULTRON Windows launcher: checks prerequisites, installs/rebuilds when the files changed (e.g. a new download), starts the
# service in the background (kept running and restarted automatically if it ever stops), and opens ULTRON in its own window.
# The service no longer depends on this window: closing it doesn't stop ULTRON. Quit from Settings -> System.
param([switch]$Background)
$ErrorActionPreference = "Stop"
if ($args -contains "--background") { $Background = $true }
Set-Location (Split-Path $PSScriptRoot -Parent)
$port = if ($env:ULTRON_PORT) { $env:ULTRON_PORT } else { 7477 }
$url = "http://localhost:$port"
$dataDir = if ($env:ULTRON_DATA_DIR) { $env:ULTRON_DATA_DIR } else { Join-Path $env:APPDATA "ULTRON" }

function Say($msg) { Write-Host "  $msg" -ForegroundColor Red }
function Healthy { try { return (Invoke-WebRequest "$url/api/health" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch { return $false } }
function OpenWindow {
  if ($Background) { return }
  $edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
  if (-not (Test-Path $edge)) { $edge = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe" }
  if (Test-Path $edge) { Start-Process $edge "--app=$url --window-size=1500,950" } else { Start-Process $url }
}

Write-Host ""
Write-Host "  U L T R O N" -ForegroundColor Red
Write-Host ""

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "  Node.js is not installed. Download the LTS version from https://nodejs.org, install it, then double-click Start-ULTRON again." -ForegroundColor Yellow
  Start-Process "https://nodejs.org"
  exit 1
}

if (Healthy) { Say "ULTRON is already running. Opening it..."; OpenWindow; exit 0 }

# Reinstall components when the component list changed (a new version was unpacked over an old one), rebuild the interface
# when the version changed. Stale leftovers were a common cause of "ULTRON stopped".
$lockHash = (Get-FileHash "package-lock.json" -Algorithm SHA256).Hash
$stamp = "node_modules\.ultron-installed"
if (-not (Test-Path $stamp) -or (Get-Content $stamp -Raw).Trim() -ne $lockHash) {
  Say "Installing components (first run or after an update; takes a minute or two)..."
  npm install --no-audit --no-fund
  if ($LASTEXITCODE) { Write-Host "  Installing failed. Check your internet connection and try again." -ForegroundColor Yellow; exit 1 }
  Set-Content $stamp $lockHash
  Remove-Item "apps\desktop\dist" -Recurse -Force -ErrorAction SilentlyContinue
}
$version = (Get-Content "package.json" -Raw | ConvertFrom-Json).version
$built = "apps\desktop\dist\.ultron-version"
if (-not (Test-Path "apps\desktop\dist\index.html") -or -not (Test-Path $built) -or (Get-Content $built -Raw).Trim() -ne $version) {
  Say "Building the interface..."
  npm run build
  if ($LASTEXITCODE) { exit 1 }
  Set-Content $built $version
}

Say "Starting ULTRON..."
$sup = Start-Process node -ArgumentList "scripts/supervise.mjs" -WindowStyle Hidden -PassThru
$ready = $false
for ($i = 0; $i -lt 360; $i++) {
  Start-Sleep -Milliseconds 500
  if (Healthy) { $ready = $true; break }
  if ($sup.HasExited) { break }
  if ($i -eq 20) { Say "Still starting (the first start after an update can take a minute)..." }
}
if (-not $ready) {
  Write-Host "  ULTRON didn't start. The last lines of its log:" -ForegroundColor Yellow
  Get-Content (Join-Path $dataDir "logs\service.log") -Tail 25 -ErrorAction SilentlyContinue
  Write-Host "  Run 'npm run doctor' in this folder for a full check." -ForegroundColor Yellow
  exit 1
}
OpenWindow
Say "ULTRON is online. This window can be closed; ULTRON keeps running in the background."
Say "To stop ULTRON completely: Settings -> System -> Quit ULTRON."
if (-not $Background) { Start-Sleep -Seconds 4 }
exit 0
