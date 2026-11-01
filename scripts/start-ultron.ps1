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
# npm prints harmless warnings on stderr; Windows PowerShell would treat those as fatal errors. Judge by exit code only.
function Npm([string[]]$npmArgs) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & cmd /c "npm $($npmArgs -join ' ') 2>&1" | Out-Host
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prev
  return $code
}
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

# Is a copy of ULTRON already running? Only reuse it if it's THIS folder's code, as it is now. An older copy (another
# folder, e.g. the start-at-sign-in shortcut of a previous download, or files updated since it started) is stopped, so
# you never end up looking at an old version.
function StopRunning {
  try {
    $boot = Invoke-RestMethod "$url/api/bootstrap" -TimeoutSec 3
    Invoke-RestMethod -Method Post "$url/api/system/quit" -Headers @{ Authorization = "Bearer $($boot.token)" } -ContentType "application/json" -Body "{}" -TimeoutSec 5 | Out-Null
  } catch {}
  for ($i = 0; $i -lt 20 -and (Healthy); $i++) { Start-Sleep -Milliseconds 500 }
  if (Healthy) {
    # Older versions have no Quit: stop whatever is listening on ULTRON's port.
    try { Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } } catch {}
    Start-Sleep -Seconds 1
  }
}
# Security: Node.js versions before the October 2026 fixes have a remote-code-execution flaw. Warn (ULTRON still runs).
$nodeCheck = (& node -e "const [a,b,c]=process.versions.node.split('.').map(Number);const m={22:[23,4],24:[22,1],26:[12,1]}[a];process.stdout.write(m&&(b>m[0]||(b===m[0]&&c>=m[1]))?'ok':process.versions.node)")
if ($nodeCheck -ne "ok") {
  Write-Host "  SECURITY: Node.js $nodeCheck has known security flaws. Please install the latest Node.js 22 LTS from https://nodejs.org" -ForegroundColor Yellow
  if (-not $Background) { Start-Process "https://nodejs.org/en/download" }
}

if (Healthy) {
  $running = $null
  try {
    $boot = Invoke-RestMethod "$url/api/bootstrap" -TimeoutSec 3
    $running = Invoke-RestMethod "$url/api/system/identity" -Headers @{ Authorization = "Bearer $($boot.token)" } -TimeoutSec 3
  } catch {}
  $here = (Resolve-Path ".").Path.TrimEnd('\').ToLower()
  $there = if ($running.root) { ([string]$running.root).TrimEnd('\').ToLower() } else { "" }
  $codeNow = (& node scripts/code-stamp.mjs service)
  if ($there -eq $here -and $running.code -eq $codeNow) { Say "ULTRON is already running. Opening it..."; OpenWindow; exit 0 }
  if ($there -and $there -ne $here) { Say "An older copy of ULTRON is running (from $($running.root)). Switching to this one..." }
  else { Say "ULTRON was updated since it started. Restarting it..." }
  StopRunning
}

# Reinstall components when the component list changed (a new version was unpacked over an old one), rebuild the interface
# when the version changed. Stale leftovers were a common cause of "ULTRON stopped".
$lockHash = (& node -e "process.stdout.write(require('crypto').createHash('sha256').update(require('fs').readFileSync('package-lock.json')).digest('hex'))")
$stamp = "node_modules\.ultron-installed"
if (-not (Test-Path $stamp) -or (Get-Content $stamp -Raw).Trim() -ne $lockHash) {
  Say "Installing components (first run or after an update; takes a minute or two)..."
  if (Npm @("install", "--no-audit", "--no-fund")) { Write-Host "  Installing failed. Check your internet connection and try again." -ForegroundColor Yellow; exit 1 }
  Set-Content $stamp $lockHash
  Remove-Item "apps\desktop\dist" -Recurse -Force -ErrorAction SilentlyContinue
}
# Rebuild the interface whenever its code changed (not just the version number).
$uiStamp = (& node scripts/code-stamp.mjs ui)
$built = "apps\desktop\dist\.ultron-build"
if (-not (Test-Path "apps\desktop\dist\index.html") -or -not (Test-Path $built) -or (Get-Content $built -Raw).Trim() -ne $uiStamp) {
  Say "Building the interface..."
  if (Npm @("run", "build")) { Write-Host "  Building the interface failed (see above)." -ForegroundColor Yellow; exit 1 }
  Set-Content $built $uiStamp
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
