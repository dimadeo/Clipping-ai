# QVAC On-Device Demo

This project demonstrates running AI on a user's device using the open-source QVAC SDK, with no API key and no cloud inference bill.

## Dashboard

The Multi-Agent Workflow Monitoring Dashboard provides a live virtual-office view of the fine-art creation, upscale production, and prepress workflows, including agent status, workflow hand-offs, queue metrics, and run controls.

Start it from the repository root:

```powershell
.\.venv\Scripts\python.exe .\dashboard_server.py
```

Then open [http://localhost:8000](http://localhost:8000) in your browser. The dashboard polls the local orchestrator status automatically.

## What it does

- Loads a real QVAC model locally
- Runs inference on the user's machine
- Uses the model without sending prompts to a hosted API
- Gives a simple, working starter app for QVAC-powered local AI

## Requirements

- Python 3.10+
- Node.js + npm (needed only so the QVAC worker can be resolved locally)
- The QVAC Python SDK: `pip install tetherto-qvac-sdk`

## Install

```bash
python -m venv .venv
. .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -U pip
pip install tetherto-qvac-sdk
npm install -g @qvac/sdk@0.19.1
```

On Windows, the demo also detects the installed QVAC SDK from the default Hermes Node install path automatically. If needed, you can set:

```bash
$env:QVAC_SDK_DIR = "C:\Users\<you>\AppData\Local\hermes\node\node_modules\@qvac\sdk"
```

## Run

```bash
python qvac_ondevice_demo.py
```

## Runway Text-to-Image

Use either of these two paths:

- Adapter path (`runway_text_to_image.py`) to test your existing dashboard renderer integration.
- Official SDK path (`runway_sdk_text_to_image.py`) to follow Runway's recommended quickstart flow.

Set your API key in the current shell:

```powershell
$env:RUNWAYML_API_SECRET = "<your_runway_api_secret>"
$env:RENDERER_PROVIDER = "runway"
$env:RUNWAY_ENDPOINT = "https://api.dev.runwayml.com/v1/text_to_image"
$env:RUNWAY_API_VERSION = "2024-11-06"
```

Install dependencies (once):

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Run the shared adapter path (dashboard-compatible):

```powershell
.\.venv\Scripts\python.exe .\runway_text_to_image.py --prompt "Cinematic portrait of a founder in a neon office" --ratio 9:16 --wait --output .\dashboard_uploads\runway_t2i_last.json
```

Run the official Runway Python SDK path:

```powershell
.\.venv\Scripts\python.exe .\runway_sdk_text_to_image.py --prompt "Editorial fine-art portrait with dramatic side light" --model gen4_image --ratio 1920:1080 --output .\dashboard_uploads\runway_sdk_t2i_last.json
```

Optional flags:

- `--endpoint` to override the default `https://api.dev.runwayml.com/v1/text_to_image`
- `--model` to force a specific Runway model
- `--reference-image` for image-to-image style guidance
- `--idempotency-key` for safe retries

SDK-specific optional flags:

- `--reference-image URI=TAG` to attach tagged reference images (repeatable)
- `--no-wait` to return immediately after task creation

Quick low-risk testing options:

- Keep using the dashboard with render disabled to validate orchestration and approvals without API calls.
- Use `runway_sdk_text_to_image.py --no-wait` for faster smoke tests when you only need task creation feedback (this still starts a billable task).

## Notes

This demo uses the QVAC SDK exactly as intended for on-device AI: no server-side API key, no per-request billing, and privacy-preserving local execution.

## License

MIT

## Rust migration workspace

The repository now includes a multi-crate Rust migration workspace at `rust_core` with orchestration, monitoring, control-center, and shared contract crates. See `rust_core/README.md` for entrypoints and validation commands.

