<#
run_auditor.ps1 -- open the Print Quality Auditor on this computer.

  .\run_auditor.ps1                 serves this folder at http://127.0.0.1:8792 and opens your browser
  .\run_auditor.ps1 -Port 8800      another port
  .\run_auditor.ps1 -Output "D:\prints\output"   audit files from another output folder

The page reads files from the pipeline's output folder (from ..\.env by default): choose one in
"Open a delivered file", or follow a running batch. Nothing leaves this computer. Close this window to stop.
#>
param(
    [int]$Port = 8792,
    [string]$Output = "",
    [switch]$NoBrowser
)
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$py = Join-Path (Split-Path -Parent $here) ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) { $py = "python" }
$cli = @((Join-Path $here "auditor_server.py"), "--port", $Port)
if ($Output)   { $cli += @("--output", $Output) }
if ($NoBrowser) { $cli += "--no-browser" }
& $py @cli
exit $LASTEXITCODE
