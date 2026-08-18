param(
    [string]$Url = ""
)

$ErrorActionPreference = "Stop"

if (-not $Url) {
    if (Test-Path "ops/agent-world-edge-upstream.txt") {
        $Url = (Get-Content "ops/agent-world-edge-upstream.txt" -Raw).Trim()
    }
}

if (-not $Url) {
    throw "No AI World edge URL configured."
}

$checks = @(
    "/api/health/live",
    "/api/health/ready"
)

foreach ($path in $checks) {
    $target = "$Url$path"
    $response = Invoke-WebRequest -UseBasicParsing -Uri $target -TimeoutSec 20
    if ($response.StatusCode -ne 200) {
        throw "Health check failed: $target ($($response.StatusCode))"
    }
    Write-Host "PASS $target"
}

Write-Host "EDGE_URL=$Url"
Write-Host "AI World edge verification completed."
