<#
open_dashboard_offline.ps1

One-click local/offline start:
1) Runs local regression tests
2) Writes dashboard/offline_runtime_status.json
3) Starts dashboard_server.py if needed
4) Opens offline readiness page
#>
param(
    [int]$Port = 8000,
    [switch]$SkipTests,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) { $python = "python" }

$reportPath = Join-Path $root "dashboard\offline_runtime_status.json"
$testCommand = "$python -m unittest -q test_dashboard_server.py test_production_orchestrator.py"

function Test-DashboardApi {
    param([int]$PortToCheck)

    $probe = "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://localhost:$PortToCheck/api/v1/status', timeout=2).status == 200 else 1)"

    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & $python -c $probe *> $null
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorAction
    return ($exitCode -eq 0)
}

function Write-OfflineReport {
    param(
        [bool]$Passed,
        [int]$ExitCode,
        [double]$DurationSeconds,
        [string[]]$OutputLines,
        [string]$Summary
    )

    $report = [ordered]@{
        passed = $Passed
        checked_at = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        command = $testCommand
        exit_code = $ExitCode
        duration_seconds = [Math]::Round($DurationSeconds, 2)
        summary = $Summary
        output_tail = @($OutputLines | Select-Object -Last 120)
    }

    $reportDir = Split-Path -Parent $reportPath
    if (-not (Test-Path $reportDir)) { New-Item -ItemType Directory -Path $reportDir | Out-Null }
    $report | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 $reportPath
}

if (-not $SkipTests) {
    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $output = & $python -m unittest -q test_dashboard_server.py test_production_orchestrator.py 2>&1
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorAction
    $timer.Stop()
    $lines = @($output | ForEach-Object { $_.ToString() })

    if ($exitCode -eq 0) {
        Write-OfflineReport -Passed $true -ExitCode 0 -DurationSeconds $timer.Elapsed.TotalSeconds -OutputLines $lines -Summary "All local regression tests passed."
    } else {
        Write-OfflineReport -Passed $false -ExitCode $exitCode -DurationSeconds $timer.Elapsed.TotalSeconds -OutputLines $lines -Summary "Local regression tests failed."
        Write-Host "Local tests failed. See dashboard/offline_runtime_status.json for details." -ForegroundColor Red
        exit $exitCode
    }
}

$statusUrl = "http://localhost:$Port/api/v1/status"
$offlineUrl = "http://localhost:$Port/offline-ready.html"
$serverReady = Test-DashboardApi -PortToCheck $Port

if (-not $serverReady) {
    $previousPort = [Environment]::GetEnvironmentVariable("PORT", "Process")
    $env:PORT = "$Port"
    Start-Process -FilePath $python -ArgumentList "dashboard_server.py" -WorkingDirectory $root | Out-Null
    if ($null -eq $previousPort) {
        Remove-Item Env:PORT -ErrorAction SilentlyContinue
    } else {
        $env:PORT = $previousPort
    }

    for ($i = 0; $i -lt 30; $i++) {
        if (Test-DashboardApi -PortToCheck $Port) {
            $serverReady = $true
            break
        }
        Start-Sleep -Milliseconds 350
    }
}

if (-not $serverReady) {
    Write-Host "Dashboard server did not start on port $Port." -ForegroundColor Red
    exit 1
}

Write-Host "Offline dashboard is ready at $offlineUrl" -ForegroundColor Green
if (-not $NoBrowser) {
    Start-Process $offlineUrl | Out-Null
}
