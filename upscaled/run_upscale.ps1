<#
run_upscale.ps1 -- Windows entry point for the 5K/9K upscaling pipeline.

Configuration lives in .env (see .env.example): token, folders, model, format, target, print sheet, texture, webhook.
Every parameter below is optional and, when given, overrides .env for this run only.

Layout (created on first run):
  C:\Users\andre\Upscaled\
    input\    drop source images here            (UPSCALE_INPUT_DIR)
    output\   final deliverables + reports       (UPSCALE_OUTPUT_DIR)
    work\     intermediate pass files            (UPSCALE_WORK_DIR)
    .env      REPLICATE_API_TOKEN=... + defaults

Examples:
  .\run_upscale.ps1                          # everything from .env
  .\run_upscale.ps1 -Plan                    # passes / tiles / calls / cost / print grade per image, no API
  .\run_upscale.ps1 -DryRun                  # offline plumbing test, no API calls
  .\run_upscale.ps1 -Model topaz -Format jpg
  .\run_upscale.ps1 -Format tiff             # TIFF-LZW instead of the PDF delivery
  .\run_upscale.ps1 -Final clarity -Face     # Real-ESRGAN passes, Clarity last pass, CodeFormer pre-pass
  .\run_upscale.ps1 -Texture grain -TextureStrength 0.2
  .\run_upscale.ps1 -Texture textures\paper.png -TextureMode soft-light -TextureStrength 0.25
  .\run_upscale.ps1 -Plan -MinApiScale 2    # already-upscaled files in input\: finish to the sheet with no API cost
  .\run_upscale.ps1 -MinApiScale 2 -PrintFix -PrintQualityPolicy abort   # fix ink/black/banding, deliver only if the re-check passes
#>
param(
    [string]$Root   = "C:\Users\andre\Upscaled",
    [string]$Model  = "",
    [string]$Final  = "",
    [string]$Format = "",
    [int]$Target    = 0,
    [int]$MaxPasses = 0,
    [string]$Texture = "",          # PNG/TIFF tile path, or grain / grain-color
    [string]$TextureMode = "",      # multiply | overlay | soft-light | grain | grain-color
    [string]$TextureStrength = "",  # 0..1 (passed through verbatim; use a dot: 0.25)
    [string]$MinApiScale = "",      # e.g. 2: finish already-upscaled files locally instead of paid API calls
    [string]$PrintFixSubstrate = "",# coated | uncoated | canvas | vinyl | textile (ink limit for the fix + check)
    [string]$PrintQualityPolicy = "",# warn | abort (abort = do not deliver a file still critical after the fix)
    [switch]$PrintFix,              # fix ink limit, black floor and banding before the re-check (v1.4)
    [switch]$Face,
    [switch]$NoExact,
    [switch]$Plan,
    [switch]$DryRun,
    [switch]$Force
)
$ErrorActionPreference = "Stop"

# .env -> environment (existing environment variables win)
$envFile = Join-Path $Root ".env"
if (Test-Path $envFile) {
    Get-Content $envFile -Encoding UTF8 | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
            $k, $v = $line -split "=", 2
            $k = $k.Trim(); $v = $v.Trim()
            if ($v -match '^(["''])(.*?)\1') { $v = $Matches[2] }              # quoted value kept verbatim
            else { $v = ($v -split " #", 2)[0].TrimEnd() }                  # bare value: drop "# comment"
            if ($k -and -not [Environment]::GetEnvironmentVariable($k)) { Set-Item -Path "Env:$k" -Value $v }
        }
    }
}
if (-not $env:REPLICATE_API_TOKEN -and -not $DryRun -and -not $Plan) {
    Write-Error "REPLICATE_API_TOKEN not set (environment or $envFile)"; exit 2
}

# folders (from .env, else Root\input|output|work)
$In   = if ($env:UPSCALE_INPUT_DIR)  { $env:UPSCALE_INPUT_DIR }  else { Join-Path $Root "input" }
$Out  = if ($env:UPSCALE_OUTPUT_DIR) { $env:UPSCALE_OUTPUT_DIR } else { Join-Path $Root "output" }
$Work = if ($env:UPSCALE_WORK_DIR)   { $env:UPSCALE_WORK_DIR }   else { Join-Path $Root "work" }
New-Item -ItemType Directory -Force -Path $In, $Out, $Work | Out-Null

# isolated virtualenv: create if missing, verify imports on EVERY run, install only when something is missing.
# Native programs write to stderr; under ErrorActionPreference=Stop PowerShell 5.1 turns that into a fatal
# error, so native calls run with Continue and are judged by their exit code.
$venv = Join-Path $Root ".venv"
$py   = Join-Path $venv "Scripts\python.exe"
$ErrorActionPreference = "Continue"
if (-not (Test-Path $py)) {
    python -m venv $venv
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $py)) { Write-Host "ERROR: could not create $venv (is python on PATH?)"; exit 2 }
}
& $py -c "import replicate, PIL, numpy, httpx" *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Installing dependencies into $venv ..."
    & $py -m pip install --quiet --upgrade pip
    & $py -m pip install --quiet -r (Join-Path $Root "requirements.txt")
    & $py -c "import replicate, PIL, numpy, httpx" *> $null
    if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: dependency install failed - run: $py -m pip install -r requirements.txt"; exit 2 }
}

$cli = @((Join-Path $Root "upscale_pipeline.py"), $In, "--out", $Out, "--work", $Work)
if ($Model)           { $cli += @("--model", $Model) }
if ($Final)           { $cli += @("--final-model", $Final) }
if ($Format)          { $cli += @("--format", $Format) }
if ($Target -gt 0)    { $cli += @("--target", $Target) }
if ($MaxPasses -gt 0) { $cli += @("--max-passes", $MaxPasses) }
if ($Texture)         { $cli += @("--texture", $Texture) }
if ($TextureMode)     { $cli += @("--texture-mode", $TextureMode) }
if ($TextureStrength) { $cli += @("--texture-strength", $TextureStrength) }
if ($MinApiScale)     { $cli += @("--min-api-scale", $MinApiScale) }
if ($PrintFixSubstrate) { $cli += @("--print-fix-substrate", $PrintFixSubstrate) }
if ($PrintQualityPolicy) { $cli += @("--print-quality-policy", $PrintQualityPolicy) }
if ($PrintFix)        { $cli += "--print-fix" }
if ($Face)            { $cli += "--face-restore" }
if ($NoExact)         { $cli += "--no-exact" }
if ($Plan)            { $cli += "--plan" }
if ($DryRun)          { $cli += "--dry-run" }
if ($Force)           { $cli += "--force" }

& $py @cli
exit $LASTEXITCODE
