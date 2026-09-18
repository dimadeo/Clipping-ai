# DMAS control-room architecture

The system is a **supervised autonomous fulfillment pipeline**. It removes repetitive fulfillment work while retaining explicit safety controls for payments, live provider credentials, and any release that needs human judgement.

```text
Shopify order/paid
      |
      v
[1 Intake & signature validation] --> reject invalid requests
      |
      v
[2 Normalise & deduplicate] --> durable job journal
      |
      v
[3 Creative agent] --> catalog lookup, prompt, overlays, seed
      |
      v
[4 Render & quality gate] --> image/PDF provider, technical checks
      |
      v
[5 Store & package] --> immutable asset URL + expiring download token
      |
      v
[6 Deliver & sync] --> buyer email, Shopify fulfillment, POD connector
      |
      v
[7 Observe & improve] --> dashboard, audit trail, retries, alerts
```

## Control-room views

- **Pipeline map** shows each operational stage and its live condition.
- **Stage counts** distinguish queued, working, delivered, retrying, and failed work.
- **Recent activity** displays the latest traceable order runs and asset links.
- **Integration health** makes local/test mode explicit until live provider endpoints are configured.

## Creative Prompt Agent and learning loop

The Creative Prompt Agent creates three distinct, intentional directions from a creative brief rather than returning one generic prompt. A human selects, renders, and rates the result. The agent records explicit 1-5 ratings and short creative-direction tags, then favors directions that have proven useful and deprioritizes weak ones. This is transparent feedback learning, not unbounded self-training.

Customer email, address, payment data, and private order notes are intentionally excluded from this learning journal.

## Cloud hosting target

```text
Shopify --> HTTPS API / webhook verifier --> managed queue --> worker service
                    |                       |                  |
                 Postgres                audit events        renderer/storage/delivery
                    |
              control-room API --> hosted dashboard
```

Use a managed container or worker platform for the API and workers, a managed Postgres database for jobs and learning feedback, Redis/SQS for queueing, object storage for generated assets, and a secrets manager for credentials. The local JSONL journal and in-memory queue are for development only; replace them before multi-instance cloud deployment.

## Agent boundaries

| Agent | Autonomous responsibility | Must not decide alone |
| --- | --- | --- |
| Intake agent | Verify signatures, reject malformed requests | Change storefront permissions |
| Creative agent | Compile prompt, aspect ratio, layers, deterministic seed | Use protected style/IP or buyer data outside the order |
| Production agent | Request render, retry transient errors, record outputs | Spend beyond configured provider limits |
| Delivery agent | Store asset, issue expiring link, send configured fulfillment event | Refund, cancel, or alter payment |
| Operations agent | Detect failures and surface anomalies | Delete data or change credentials |

## Reliability decisions

- The idempotency key `store:orderId:lineItemId` prevents duplicate webhooks from producing duplicate files.
- Every state change is journaled; failed jobs retry up to `MAX_ATTEMPTS` and remain visible as failed work.
- HMAC validation happens before payload parsing or queueing.
- Local adapters write manifests only. Live external rendering, storage, and delivery require explicitly configured endpoints and keys.
- Download tokens expire after seven days. Replace local JSONL storage with Postgres and the in-memory queue with Redis/SQS before running multiple instances.

## Production evolution

At low volume, one Node instance plus managed object storage is sufficient. At growth, move the journal to Postgres, dispatch jobs through SQS/Redis, run workers independently, send traces to an observability provider, and add a human review queue for exceptional or premium commissions.
