# QVAC On-Device Demo

This project demonstrates running AI on a user's device using the open-source QVAC SDK, with no API key and no cloud inference bill.

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

The app downloads the model it needs on first run and then performs a local inference call.

## Notes

This demo uses the QVAC SDK exactly as intended for on-device AI: no server-side API key, no per-request billing, and privacy-preserving local execution.

## License

MIT
