# ULTRON Windows launcher: checks prerequisites, installs/builds on first run, starts the service,
# and opens ULTRON in its own app window (Microsoft Edge app mode; falls back to the default browser).
param([switch]$Background)
$ErrorActionPreference = "Stop"
if ($args -contains "--background") { $Background = $true }
Set-Location (Split-Path $PSScriptRoot -Parent)
$port = if ($env:ULTRON_PORT) { $env:ULTRON_PORT } else { 7477 }
$url = "http://localhost:$port"

function Say($msg) { Write-Host "  $msg" -ForegroundColor Cyan }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "  Node.js is not installed. Download the LTS version from https://nodejs.org, install it, then double-click Start-ULTRON again." -ForegroundColor Yellow
  Start-Process "https://nodejs.org"
  exit 1
}

try {
  if ((Invoke-WebRequest "$url/api/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) {
    if ($Background) { exit 0 }
    Say "ULTRON is already running. Opening it..."
    $edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
    if (Test-Path $edge) { Start-Process $edge "--app=$url" } else { Start-Process $url }
    exit 0
  }
} catch {}

if (-not (Test-Path "node_modules")) { Say "First run: installing components (takes a minute)..."; npm install --no-audit --no-fund; if ($LASTEXITCODE) { exit 1 } }
if (-not (Test-Path "apps\desktop\dist\index.html")) { Say "Building the interface..."; npm run build; if ($LASTEXITCODE) { exit 1 } }

Say "Starting ULTRON..."
$server = Start-Process node -ArgumentList "--disable-warning=ExperimentalWarning","--import","tsx","services/gateway/src/main.ts" -PassThru -NoNewWindow
# First start on a slow or busy PC can take a while (antivirus scans the files once); wait up to 2 minutes.
$ready = $false
for ($i = 0; $i -lt 240; $i++) {
  Start-Sleep -Milliseconds 500
  try { if ((Invoke-WebRequest "$url/api/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { $ready = $true; break } } catch {}
  if ($server.HasExited) { Write-Host "  ULTRON stopped unexpectedly. Run 'npm run doctor' in this folder for a diagnosis." -ForegroundColor Red; exit 1 }
  if ($i -eq 20) { Say "Still starting (first start can take a minute)..." }
}
if (-not $ready) { Write-Host "  ULTRON is taking unusually long to start. It will open as soon as it's ready; if not, run 'npm run doctor'." -ForegroundColor Yellow }

$edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
if (-not $Background) {
  if (Test-Path $edge) { Start-Process $edge "--app=$url --window-size=1400,900" } else { Start-Process $url }
}
Say "ULTRON is online at $url. Keep this window open; close it (or press Ctrl+C) to stop ULTRON."
Wait-Process -Id $server.Id
