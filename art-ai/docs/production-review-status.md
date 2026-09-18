# Creation-to-publication workflow

Requested flow: human approves creative brief; generation provider creates images; results return to the dashboard; agents assess quality and suggest a price; human approves the exact artwork and price; product fields are generated; Shopify receives the files and publishes.

## Implemented

- Existing approved-brief Midjourney handoff remains available.
- Returned studio images and existing collection selections appear in `/api/production-review` and the dashboard `#production-review` section.
- PNG/JPEG resolution inspection reads actual file headers, reports pixels, megapixels, print size at 300 PPI, and resolution sufficiency for the three planned sizes. It does not assess artistic quality or promise successful printing.
- Image return triggers resolution inspection; download failure leaves the received artwork available for a manual retry.
- A proposed $18 USD price comes from the existing local draft catalogue. It is explicitly labelled as a proposal, not live market research or AI valuation.
- Human visual scoring, acceptance/rejection and editable title/price are persisted. Approval is tied to a SHA-256 digest of the inspected image. Reinspection of changed bytes clears the approval and prepared product.
- Approval prepares local Shopify fields (title, description, SEO, SKU, digital product type, price, tags and image alt text).

## Still needed

### FLUX connection update

The owner selected Black Forest Labs for pay-as-you-go automatic creation and saved `BFL_API_KEY` privately. `src/flux.js` and the FLUX studio panel now support explicit direction approval, the brief's image count (1–50), durable generation records, polling, local PNG/JPEG downloads, and automatic resolution review. Generation uses FLUX.2 Pro at approximately 1 MP for initial review. Midjourney handoffs remain available separately.

Paid submissions are not automatically retried after an uncertain response; remaining batch items pause. Polling resumes from saved provider IDs after restart. The API key is never returned to the browser or sent to image download hosts. The provider connection check currently returns HTTP 500; authentication and live generation are not verified, and no paid test image has been requested. Eleven tests pass, including mocked submission/return and duplicate-charge prevention.

- User is checking for a Midjourney-approved API connection. No automatic Midjourney submission/return integration has been implemented. Midjourney documentation currently states that API/automation access requires explicit exceptions.
- AI vision scoring and agent price suggestions need a model connection and implementation. `OPENAI_API_KEY` was absent when checked. Existing LangSmith configuration is tracing, not a model credential.
- Shopify Admin publishing adapter, credentials and sales-channel selection are not implemented/configured. The webhook signing secret is not an Admin API token.
- Digital download attachment and final file preparation remain unconfigured. A product preview image is not a customer digital download attachment.
- No live products were created or published by this change.

Tests: `node --test`; includes human approval prerequisites, persistence, and invalidation when bytes change.
