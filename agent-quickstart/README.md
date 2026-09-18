# QVAC On-Device Assistant

This is a command-line assistant using the open-source QVAC SDK. The model runs locally on the user's machine; no API key or hosted inference service is required.

## Install

```bash
npm install
```

## Run

```bash
npm start
```

Pass a custom prompt after the start command:

```bash
npm start -- "Summarize why local AI is useful in one sentence."
```

The first run downloads the model. Later runs reuse the local model cache.

## Notes

- No API key required
- No remote inference call
- Data stays on the user's machine
- Model downloads on first run automatically
- Responses stream directly in the terminal
