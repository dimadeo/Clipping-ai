# Pipeline and connections

Open the Pipeline tab to see the 17-stage artwork workflow. It is a live view of this local application, not a claim that all 17 stages have been built or completed.

## What the colours mean

| Status | Meaning |
| --- | --- |
| Ready | The reported local capability or files are available; this does not mean the entire stage was executed. |
| Waiting | Input or work is still needed. |
| Running | A local job reports that it is working. |
| Manual step | Your action or judgment is required. |
| Blocked | A problem or missing requirement prevents progress. |
| Not connected | The integration is not implemented or not ready in this application. |

## Check a stage

Select a numbered card. Its details explain the count, the current evidence and the next action. **Check stage** rereads that stage's local status. The image-provider stage instead offers **Check BFL connection**, which checks account access and credits without generating an image. A successful connection result is treated as fresh for five minutes.

For Originals, Resolution and Pricing, select one artwork and click **Recheck selected artwork** to read the actual image again. This measures pixels and refreshes price guidance; it does not upscale or publish. A changed file requires fresh approval. The saved selling price of an unchanged approved artwork stays protected.

If a remote link fails, open Review and use **Upload original file** on the pending artwork. Import the exact original PNG or JPG from your computer; a preview screenshot is not the delivery file.

## Pause or restart

**Refresh status** reads current local data. **Pause monitoring** stops this panel's automatic updates. **Restart monitoring** starts those updates again. The panel refreshes every 15 seconds while visible and stops automatic retries after an error until you refresh or restart it.

Restarting monitoring does not restart the application, restart paid generation, change approvals or publish products. Uncertain FLUX submissions must be checked in the provider account before any new paid request; this panel never resubmits them.

## How the Lang systems fit together

LangChain provides model integration. LangGraph runs the creative steps: understand the brief, produce directions, review the directions, then wait for your approval. LangSmith is optional tracing and debugging, not an image generator or the orchestrator.

These packages are installed locally with the application's Node dependencies. The Systems & connections cards read the installed package versions. LangSmith may be installed as a dependency of another package. The graph can run local creative rules without a paid language-model call. Configuring an OpenAI key allows the existing text art-director review; it does not automatically add visual scoring or a pricing AI.

The pricing guide uses measured pixels and dated market comparisons with explicit retail rules. It is separate from the LangGraph creative process.

## Installed is not the same as connected

| System | What the dashboard can confirm |
| --- | --- |
| LangChain | Installed package version and whether the application's text model is configured. |
| LangGraph | Installed version and whether the running app has created its local graph. |
| LangSmith | Installed version, tracing-key presence and whether tracing is enabled. Trace delivery is not automatically verified. |
| OpenAI | Whether a key/model is configured. This monitor does not make a paid model call. |
| FLUX / BFL | Key presence; an explicit connection check can verify access and available credits. |
| Midjourney | Manual handoff and original-file import. No automated Midjourney API is connected. |
| Shopify | Local product fields exist, but automatic Admin API publishing remains unimplemented. A webhook secret or client ID alone does not establish publishing access. |
| Digital Products | You reported installing the app. Customer-file attachment and delivery still need integration and a download test. |
| Gelato | You reported installing the app. Product mapping and fulfillment are not connected to this dashboard yet. |

No secret keys are displayed. An installed or configured badge is not proof of a working external connection. Historical generated files prove previous results exist, not that current credentials or credits are valid.

## What remains manual

Inspect artistic quality, approve each artwork and selling price, and verify customer delivery. Saved files and backup presence are counted; a status refresh alone does not perform a new file-integrity audit.

The dashboard runs locally. This monitor is not evidence of cloud hosting or an always-running cloud worker.
