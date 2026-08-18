param(
  [string]$LocalUrl = "http://127.0.0.1:18080",
  [string]$UpstreamFile = "ops/agent-world-edge-upstream.txt"
)

$ErrorActionPreference = "Stop"

Write-Host "=== AI World local Pinggy edge helper ==="

if (-not (Get-Command pinggy -ErrorAction SilentlyContinue)) {
  throw "pinggy CLI not found"
}

try {
  Invoke-WebRequest -UseBasicParsing -Uri "$LocalUrl/api/health/live" -TimeoutSec 10 | Out-Null
} catch {
  throw "Local AI World is not healthy at $LocalUrl"
}

Write-Host "Cleaning stale tunnels..."
& pinggy stop --all 2>$null | Out-Null

Write-Host "Starting detached tunnel..."
$output = & pinggy start --http $LocalUrl 2>&1 | Out-String

$url = [regex]::Match($output, 'https://[^\s]+').Value

if (-not $url) {
  $ps = (& pinggy ps 2>&1 | Out-String)
  $url = [regex]::Match($ps, 'https://[^\s]+').Value
}

if (-not $url) {
  throw "Pinggy tunnel URL was not published"
}

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$file = Join-Path $root "agent-world-edge-upstream.txt"

Set-Content -Path $file -Value $url -NoNewline

Write-Host "EDGE_URL=$url"
Write-Host "UPSTREAM_FILE=$file"
