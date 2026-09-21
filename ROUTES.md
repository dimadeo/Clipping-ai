# Route Guide

This file documents active HTTP routes in this repository and what each one does.

## Dashboard Server (`dashboard_server.py`)

Base URL when running locally: `http://localhost:8000`

### UI Routes

| Method | Canonical Path | Alias | Purpose |
| --- | --- | --- | --- |
| GET | `/` | `/index.html` | Serves the main virtual-office dashboard UI. |
| GET | `/offline-ready.html` | `/offline` | Serves the offline readiness page UI. |

### API Routes

| Method | Canonical Path | Alias | Purpose |
| --- | --- | --- | --- |
| GET | `/api/v1/routes` | `/routes` | Returns this API manifest, route metadata, and run payload contract. |
| GET | `/api/v1/status` | `/status` | Returns live orchestrator status, run result, review sections, warnings, and final output links. |
| GET | `/api/v1/offline-health` | `/offline-health` | Returns offline readiness checks from local runtime report and key file checks. |
| POST | `/api/v1/runs` | `/run` | Queues a new workflow run (`fine_art_creation`, `production`, or `prepress`). |
| POST | `/api/v1/approvals` | `/approval` | Applies an approval decision (`approve` or `reject`) when a workflow is paused for human review. |
| POST | `/api/v1/attachments` | `/attachments` | Uploads one base64 attachment (max 8 MB) and returns attachment metadata. |
| GET | `/api/v1/attachments/{id}` | `/attachments/{id}` | Downloads or previews a previously uploaded attachment by id. |
| GET | `/api/v1/artifacts/print/{name}` | `/print-artifact/{name}` | Streams an allowed Upscaled print artifact from batch status. |

### Notes

- Canonical paths are under `/api/v1`.
- Legacy aliases remain supported for backward compatibility.
- Legacy workflow payloads can still send `campaign`; the server normalizes that to `fine_art_creation`.
- Workflow `production` is the Upscale Digital Fine Art route (300 DPI target matrix, attachment-driven source image).
- New clients should use canonical paths only.

## Print Quality Auditor Server (`upscaled/Print Quality Auditor/auditor_server.py`)

Base URL when running locally: `http://127.0.0.1:8792`

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | Redirects to `/index.html` for the auditor web UI. |
| GET | `/output/_list.json` | Returns output folder listing used by UI file chooser and batch views. |
| GET | `/workflow.json` | Returns computed workflow status summary for draft, input, output batches, deliveries, and disk checks. |
| GET | `/output/...` | Serves allowed output artifacts (`pdf`, `tiff`, `png`, `jpg`, `webp`, `json`, `txt`, etc.) read-only. |

## Route Change Policy

- Keep canonical routes stable.
- Add new behavior behind canonical routes first.
- Keep aliases only when required for compatibility; prefer deprecating them over time.
