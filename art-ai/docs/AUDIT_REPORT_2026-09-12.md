# The Dark Matters — Architecture Audit

**Date:** 2026-09-12
**Scope:** `src/` (34 modules), `data/` decision records, prompt library, Shopify integration, LLM deployment
**Verdict:** The system is not an autonomous pipeline. It is a well-built *manual review tool* with an autonomous facade. Six defects block autonomy; one of them invalidates the entire product promise.

---

## 1. Executive summary

Nothing is working as you wish because the pipeline was deliberately designed to stop at every stage and ask you. That was a safety choice, and it is encoded in the source. The autopilot's own rule list says so:

> `'Never submit to Midjourney, Shopify, or customers without your action'` — `src/server.js:224`

But the more serious finding is not the missing automation. **No artwork you have produced is printable at the resolution you are selling.** That single defect explains the 76% rejection rate, the low visual scores, the flat pricing, and the stalled Shopify stage simultaneously.

---

## 2. The defect that invalidates the product

Your listings promise a 300 DPI print file. The generator cannot produce one, and no upscale step exists.

| Requirement | Pixels | Megapixels | Share of requirement |
|---|---|---|---|
| 30 × 40 cm @ 300 PPI (what you sell) | 3543 × 4724 | 16.7 | 100% |
| FLUX hard ceiling (`FLUX_MAX_PIXELS`) | 2048 × 2048 | 4.2 | **25%** |
| Best artwork you ever approved | 2496 × 1664 | 4.2 | **25%** |
| Typical rejected artwork | 960 × 1200 | 1.2 | **7%** |

`src/creation-formats.js:3` caps generation at 4 MP because that is the BFL API limit. A 2.31× linear upscale is *mandatory* to reach print spec. Searching the whole tree for upscaling returns nothing — `sharp` is imported in three files and used only for `.metadata()` and `.stats()`. Every UI string confirms the absence rather than fixing it:

> `'A recheck reads the actual image... It does not upscale the file.'` — `src/pipeline-panel.js:41`

**Consequence:** `resolutionReport()` scores every artwork against the 300 PPI target, so scores top out at 47/100. The gate is mathematically unpassable. Your 35 rejections were not aesthetic judgements — the system was rejecting thumbnails.

---

## 3. The LLM layer is not deployed

You asked me to check how the language system is deployed. It is installed but inert.

`.env` contains `LANGSMITH_API_KEY`, `BFL_API_KEY`, `SHOPIFY_CLIENT_ID/SECRET`. It does **not** contain `OPENAI_API_KEY`. The orchestrator degrades silently:

```js
this.model = apiKey ? new ChatOpenAI({ apiKey, model, temperature: 0.8 }) : null;
```
— `src/langchain-orchestrator.js:24`

With `model === null`, `review()` returns a hardcoded English sentence. The "art director review" node in your LangGraph has never once consulted a model. Four `@langchain/*` packages are installed and shipping zero inference.

This is why **the agents are not briefed properly**: no agent writes a brief. `CreativePromptAgent.create()` is string concatenation over five hardcoded arrays, with variation chosen by a SHA-256 hash of the subject (`pick()`, `src/creative-agent.js:18`). It is deterministic templating wearing the word "agent".

The feedback loop is equally hollow. `CreativeMemory` records a score only when you call `learn()`. Your 35 rejection records contain **no reason field at all** — I checked every file in `data/Rejected/`. The memory has learned nothing from 35 failures, so the next batch reproduces the same prompts.

---

## 4. Why Midjourney returns poor work

Audited all 50 rows of `50_luxury_digital_art_prompts.csv`:

| Check | Result | Impact |
|---|---|---|
| Pin a model version (`--v 7`) | **0 / 50** | Output silently follows whatever your account defaults to; quality drifts between sessions |
| Style reference (`--sref`) | **0 / 50** | A "collection" of 50 works has 50 unrelated visual identities |
| Quality flag (`--q`) | 0 / 50 | Leaves detail on the table |
| Negative prompt content | `--no ... blurry, low resolution` | **Actively harmful.** Midjourney's `--no` removes *depicted objects*. Abstract quality words are not objects; they add noise to the weighting |

The generated prompt is a 328-character comma chain in which the subject competes with ~40 words of luxury filler. Midjourney v7 distributes attention across the phrase, so "Layered architectural plaster waves" — the actual artwork — receives a minority of the weight. The runtime prompt from `creative-agent.js:97` is worse: roughly 60 words with three separate style clauses before any parameter.

A further defect: `resolveArtworkRatio(brief.subject)` derives the aspect ratio by parsing the *subject text*. Aspect ratio is a product decision (what the customer frames), not something to infer from prose.

On the FLUX path, `fluxPrompt()` strips every `--parameter` before submission — correct for the API, but it means the stylize and chaos sliders in your dashboard are silently discarded on that path.

---

## 5. Approval and pricing

**Approval has no automated component.** `src/production-review.js:242` refuses to proceed without a human-typed integer:

```js
if (!Number.isInteger(score) || score < 1 || score > 10 || input.visualConfirmed !== true)
  fail('Inspect the artwork and give a visual score from 1 to 10');
```

The monitor states it plainly: `'Automatic AI visual scoring is not connected.'` With 65 artworks and no assistance, fatigue produces contradictions. Evidence from your own decision records:

- One artwork at **960 × 1200 was approved**. Fifteen artworks at **exactly 960 × 1200 were rejected**.
- Visual scores on **approved** work: `2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 7`. You are shipping inventory you rate 3/10.

**Pricing is ignored because it is anchored wrong.** `MARKET_COMPARABLES` holds three listings: $5, $10, $14.99 — mass-market printable wall art. Median $10, multiplied by a size factor of 0.6–1.5. For a luxury brand this produces a suggestion around $8.

Your actual approved prices: **$18.00 on ten of eleven items, $69.00 on one.** You override the engine every single time. The engine also has a time bomb — `checkedAt: '2026-09-12'` on all three samples, and `MAX_AGE_DAYS = 90` returns `status: 'unavailable'` from 2026-12-11 onward.

Pricing is also blind to everything that determines art value: subject, collection, archetype, and your own visual score are all unused. Only pixel count feeds the formula.

---

## 6. Shopify publishing does not exist

Stages 14–16 in your dashboard are honest. Grepping `server.js` for Shopify returns **one inbound webhook** (`/webhooks/shopify/orders-paid`) and nothing outbound. No Admin API client, no `productCreate`, no media upload, no digital-file attachment. The constant is explicit:

```js
const publishingBlockers = ['Automatic Shopify upload is not implemented yet; ...'];
```
— `src/production-review.js:50`

Credentials are the wrong type for the job. You have `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` (a public-app OAuth pair, used here only for HMAC verification). Publishing requires a custom-app Admin token (`shpat_…`) plus the shop domain, with `write_products` and `write_files`.

Product copy, when it is eventually sent, is a two-sentence template with no title strategy, no SEO, no collection narrative:

```js
descriptionHtml: `<p>${html(title)} — digital artwork from The Dark Matters.</p><p>File dimensions: ...</p>`
```

Titles are currently truncated prompt text — `"A single giant Monstera leaf draped in liqu … Option 1"`.

---

## 7. Defect register

| # | Defect | Location | Severity | Blocks |
|---|---|---|---|---|
| D1 | No upscale; 4 MP ceiling vs 16.7 MP promise | absent | **Critical** | every stage |
| D2 | No `OPENAI_API_KEY`; LLM layer inert | `.env`, `langchain-orchestrator.js:24` | **Critical** | briefing, scoring, copy |
| D3 | Shopify publishing unimplemented | `server.js` | **Critical** | 14, 15, 16 |
| D4 | No automated aesthetic scoring | `production-review.js:242` | High | 9, 11 |
| D5 | Rejections record no reason; memory never learns | `data/Rejected/*` | High | 1, 2 |
| D6 | Prompts lack `--v`, `--sref`; harmful `--no` terms | `50_luxury...csv`, `creative-agent.js:97` | High | 6 |
| D7 | Pricing anchored to $5–15 comparables, expires in 90 days | `pricing-market.js` | Medium | 10 |
| D8 | Aspect ratio inferred from subject prose | `creative-agent.js:61` | Medium | 6 |
| D9 | FLUX serialises to one batch; `--params` silently dropped | `flux.js:42`, `flux.js:9` | Medium | 5, 6 |
| D10 | Autopilot is a prompt-list writer, not a pipeline | `server.js:213` | Medium | all |

---

## 8. Proposed architecture

The current graph runs `brief → directions → review → STOP`. The upgrade inserts the three missing engines and converts human approval from a *gate on every item* to an *exception queue*.

```
                    ┌──────────────── autonomous loop ────────────────┐
                    │                                                 │
  Collection    ┌───▼────┐   ┌─────────┐   ┌────────┐   ┌──────────┐  │
  thesis   ───► │ Brief  ├──►│ Prompt  ├──►│  FLUX  ├──►│ UPSCALE  │  │
  (you, once)   │ Agent  │   │ Compiler│   │ 4 MP   │   │ 2.4x→16MP│  │
                └────────┘   └─────────┘   └────────┘   └─────┬────┘  │
                     ▲            ▲                            │      │
                     │            │ --sref locks collection    ▼      │
                     │            │                     ┌─────────────┐│
                     │            └─────────────────────┤ AESTHETIC   ││
                     │      structured reject reasons   │ JUDGE (VLM) ││
                     │                                  └──────┬──────┘│
                     │                                         │       │
                     └─────────────────────────────────────────┘       │
                                                                │      │
                        score ≥ 7.5 ──────────────────────► auto-approve
                        score 5.0–7.4 ────────────────────► YOUR QUEUE ◄┘
                        score < 5.0 ──────────────────────► auto-reject + reason
                                          │
                                          ▼
                              ┌───────────────────────┐
                              │ Pricing Engine v2     │
                              │ quality × tier × set  │
                              └───────────┬───────────┘
                                          ▼
                              ┌───────────────────────┐
                              │ Copywriter (LLM)      │
                              │ title/SEO/description │
                              └───────────┬───────────┘
                                          ▼
                              ┌───────────────────────┐
                              │ Shopify Admin GraphQL │
                              │ product + media +     │
                              │ digital file + preview│
                              └───────────────────────┘
```

### The five components to build

**A. Upscale service — fixes D1, unblocks everything**
Insert between generation and review. Two viable routes: the BFL upscale endpoint (keeps one vendor, one key you already have), or local Real-ESRGAN via ONNX. Target 3543 × 4724 minimum. Gate on measured output, not on request. Until this exists, no other fix produces a sellable file.

**B. Aesthetic judge — fixes D4, D5**
A vision model scoring each upscaled image on four axes: composition, material realism, palette discipline, and print viability (artefacts, edge integrity, upscale halos). Returns a score plus a **structured reason code**. Route at 7.5 / 5.0 thresholds. Critically, the reason codes feed back into `CreativeMemory`, which currently learns nothing — this closes the loop that has been open for 35 rejections.

Expected effect on your workload: at your current distribution, roughly 70% of items get decided without you. You review the middle band only.

**C. Prompt compiler v2 — fixes D6, D8**
Replace `pick()` templating with a real LLM brief step, then compile deterministically:
- Pin `--v 7` on every prompt.
- Generate one `--sref` seed per collection and lock it across all 50 pieces. This is the single change that will make the collection look intentional.
- Strip quality adjectives from `--no`; keep only depictable objects (watermark, signature, text, frame).
- Take aspect ratio from the product decision, never from subject prose.
- Front-load the subject; cap style clauses at two.

**D. Pricing engine v2 — fixes D7**
Keep the transparent rule-based core, change three things: re-anchor comparables to the luxury segment you actually compete in, admit the aesthetic score as a multiplier, and add a collection-scarcity factor. Replace the hard 90-day expiry with graceful degradation to a floor price so the engine never returns `unavailable` mid-trading.

**E. Shopify publisher — fixes D3**
Admin GraphQL `productCreate` → `productCreateMedia` → digital file attach → publish. Needs a custom-app token with `write_products` and `write_files`. Pair with an LLM copywriter for title, SEO description, and alt text, plus a generated room-preview mockup — you already have ten room backgrounds in `shopify/assets/`.

---

## 9. Sequencing

Strict dependency order. Each step is independently verifiable.

| Step | Work | Verify by | Unblocks |
|---|---|---|---|
| 0 | Add `OPENAI_API_KEY`; obtain Shopify custom-app token | `/api/pipeline` shows model configured | D2 |
| 1 | **Upscale service** | one file measured ≥ 3543 × 4724, score ≥ 95 | D1 → all |
| 2 | Aesthetic judge + reason codes into memory | 65 existing artworks re-scored in one batch | D4, D5 |
| 3 | Prompt compiler v2 with locked `--sref` | new batch of 10 reads as one collection | D6, D8 |
| 4 | Pricing v2 | suggestion lands within 10% of your manual $18 | D7 |
| 5 | Shopify publisher + copywriter | one product live with preview and download | D3 |
| 6 | Promote autopilot to a real state machine | 10 pieces end-to-end, you touch only the middle band | D10 |

Step 1 before step 2 is not negotiable: scoring 1 MP thumbnails would teach the judge the wrong distribution.

---

## 10. What I recommend you decide

Three questions gate the build, and they are yours rather than mine:

1. **Upscale route** — BFL endpoint (one vendor, marginal cost per image, no local compute) or local Real-ESRGAN (free per image, needs GPU time on an Iris Xe, slower).
2. **Autonomy threshold** — the 7.5 / 5.0 split is my proposal. Raising the upper bound sends more work to you and protects the brand; lowering it ships faster.
3. **Price position** — $18 is what you actually charge. Confirm that as the anchor and I will rebuild the comparables around it, or name the target and I will build toward that instead.

No code has been changed. The tree is exactly as you left it.
