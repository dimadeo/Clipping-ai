# DARK MATTERS autonomous art fulfillment

A dependency-free Node service that turns a paid storefront order into a traceable fulfillment job. It now includes an operations control room at `/`, so the automation is visible as a professional workflow rather than a black box. It implements the four layers from the supplied blueprint:

1. **Ingestion** - Shopify-compatible signed webhook endpoint.
2. **Middleware** - payload normalization, idempotency, durable job journal, and retry queue.
3. **Rendering** - catalog-driven luxury-art prompt compiler with swappable rendering adapter.
4. **Delivery** - asset storage, expiring customer download link, and fulfillment notification adapter.

## Run locally

```powershell
$env:SHOPIFY_WEBHOOK_SECRET = 'dev-secret'
node src/server.js
```

Send a signed Shopify-style payload to `POST /webhooks/shopify/orders-paid`. The local renderer creates a JSON asset manifest instead of calling a generative image service, so development is safe and credential-free.

```powershell
node --test
```

## Local Rust Image Preflight

This branch inherits the shared image core at `../upscaled/rust_core`. Art-Ai can use it before a paid upscale submission to verify source dimensions, record a SHA-256 hash, and calculate scale passes. It never replaces the configured image-restoration provider or publishes an asset by itself.

Enable the preflight locally:

```powershell
$env:RUST_IMAGE_CORE_ENABLED = 'true'
node src/server.js
```

Set `RUST_IMAGE_CORE_DIR` only when the Rust core is stored somewhere other than the inherited `upscaled/rust_core` directory. The Rust toolchain must be installed and available as `cargo`.

## Production adapter contract

Set `RENDERER_ENDPOINT` and `RENDERER_API_KEY` for an image/render API. It receives `{ prompt, negativePrompt, aspectRatio, seed, overlays, order }` and must return `{ assetUrl }`.

Set `STORAGE_ENDPOINT` to POST the generated artifact for durable storage; return `{ assetUrl }`. Set `DELIVERY_WEBHOOK_URL` to receive `{ orderId, customerEmail, downloadUrl, assetUrl, status }`; use it for Shopify fulfillment state updates, email, and optional Printify/theprintspace routing.

The job journal is JSONL at `data/jobs.jsonl`. For multi-instance production, replace `Journal` and `JobQueue` with Postgres/Redis or SQS while preserving the idempotency key `store:orderId:lineItemId`.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/webhooks/shopify/orders-paid` | Signed order ingestion |
| `GET` | `/health` | Service health and queue depth |
| `GET` | `/` | Live autonomous-pipeline control room |
| `GET` | `/api/overview` | Dashboard data: stage health, job counts, and recent activity |
| `POST` | `/api/creative/prompts` | Create three creative prompt directions from a brief |
| `POST` | `/api/creative/feedback` | Record a 1-5 rating and creative-direction tags |
| `GET` | `/api/creative/insights` | View the learning agent's preferred/avoided directions |
| `GET` | `/jobs/:id` | Order/job state for support tooling |
| `GET` | `/downloads/:token` | Expiring local delivery redirect/manifest |

## Catalog

`50_luxury_digital_art_prompts.csv` remains the source of truth. The service looks up product titles from it and falls back to a safe generic gallery prompt when a product is not present.

## Creative Prompt Agent

The Creative Prompt Agent is a supervised learning loop. Give it a brief with `subject`, `goal`, `audience`, `mood`, `palette`, `medium`, `movement`, and `aspectRatio`; it creates three intentional prompt directions. Rate a rendered outcome from 1 to 5 and attach concise creative-direction tags (for example, `quiet luxury` or `too literal`). It learns only from this explicit feedback journal; it does not train itself on buyer personal data or publish material automatically.

```json
{
  "subject": "fluid plaster waves in warm sand",
  "goal": "create an artwork for a quiet-luxury living room",
  "audience": "interior-design collectors",
  "mood": "calm, tactile and refined",
  "palette": "warm beige, terracotta, raw ivory"
}
```

See `CONTROL_ROOM_ARCHITECTURE.md` for the production control-plane design, checkpoints, and scale path.

## LangChain, LangGraph, and LangSmith

The Creative Studio now uses a human-supervised LangGraph workflow around the prompt agent:

`brief → three directions → art-director review → your approval → Midjourney handoff`

LangChain provides the optional art-director model connection. Set `OPENAI_API_KEY` and, optionally, `CREATIVE_MODEL` to enable it. Without a key, the graph stays in local review mode and keeps working safely.

LangSmith is ready for tracing and quality evaluation. Set these secrets in the cloud host (not in source files):

```powershell
$env:LANGSMITH_TRACING = 'true'
$env:LANGSMITH_API_KEY = '...'
$env:LANGSMITH_PROJECT = 'dark-matters-creative-studio'
```

The workflow deliberately waits for a human approval before it creates or publishes anything. See `docs/ADR-001-creative-ai-orchestration.md` for the decision record.
