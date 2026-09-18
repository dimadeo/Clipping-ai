<#
prepare_job.ps1 -- prepare a job in draft\ before it starts.

  .\prepare_job.ps1                          check draft\: ready or not and why, API calls, cost, time, disk
  .\prepare_job.ps1 -Start                   move the ready images that cost nothing into input\
  .\prepare_job.ps1 -Start -AllowCost        also move ready images that need paid API passes
  .\prepare_job.ps1 -Start -IncludePrinted   also move images that were already printed
#>
param(
    [switch]$Start,
    [switch]$AllowCost,
    [switch]$IncludePrinted,
    [string]$MinApiScale = "2",
    [string]$Root = "C:\Users\andre\Upscaled"
)
$py = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) { Write-Host "ERROR: $py not found. Run .\run_upscale.ps1 -Plan once to create it."; exit 2 }
$cli = @((Join-Path $Root "prepare_job.py"), "--min-api-scale", $MinApiScale)
if ($Start)          { $cli += "--start" }
if ($AllowCost)      { $cli += "--allow-cost" }
if ($IncludePrinted) { $cli += "--include-printed" }
& $py @cli
exit $LASTEXITCODE
