param(
    [Parameter(Mandatory = $true)]
    [string]$Url
)

$ErrorActionPreference = "Stop"

if (-not $Url.StartsWith("https://")) {
    throw "Temporary edge URL must use HTTPS."
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
Write-Host "AI World local edge verification completed."
