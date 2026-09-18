# Agent directory

“Agent” here means a named responsibility in the workflow. Some responsibilities use AI, some are ordinary software checks, and some are still planned. They are not all independent AI workers running continuously.

## Creative Prompt Agent

- **Purpose:** Turn your brief into usable art prompts.
- **Responsibilities:** Combine the subject, material, palette, mood and shape; produce Foundation, Contrast and Editorial directions; include the selected delivery-size plan.
- **Receives:** Your collection brief and previously recorded creative feedback.
- **Produces:** Three prompt candidates and their creative rationale.
- **Status:** Implemented. The current prompt builder uses rules and templates.
- **Your decision:** Choose the direction worth creating.

## Art Director

- **Purpose:** Review the proposed creative direction.
- **Responsibilities:** Comment on composition, material realism and how the artwork could work in an interior.
- **Receives:** The written brief and candidate descriptions.
- **Produces:** A short review note.
- **Status:** An optional LangChain model connection exists. Without the model key, it returns a standard local review note. It does not currently inspect the generated image.
- **Your decision:** Accept a direction or revise the brief.

## Creative Workflow Orchestrator — LangGraph

- **Purpose:** Coordinate the creative-brief stages.
- **Responsibilities:** Understand the brief, run prompt creation, request the Art Director note and mark the draft as waiting for owner approval.
- **Produces:** A structured creative result with stage information.
- **Status:** Implemented for this creative sequence. It is not yet a single end-to-end graph controlling Shopify publication.

## FLUX Creation Executor — FLUX.2 Pro

- **Purpose:** Generate images through Black Forest Labs.
- **Responsibilities:** Submit an approved batch, track provider jobs, retrieve completed images and save them for review.
- **Receives:** An approved prompt, image count and shape.
- **Produces:** Locally saved images, provider job identifiers and progress states.
- **Status:** Connector implemented. Last connection verification returned HTTP 500; live generation remains unverified.
- **Your decision:** Approve the batch before spending generation credits.

## Midjourney Handoff Assistant

- **Purpose:** Support creation in your existing Midjourney account.
- **Responsibilities:** Prepare a copyable prompt and accept a chosen image link back into the system.
- **Status:** Manual handoff. It does not submit or retrieve generations automatically.
- **Your responsibility:** Run the prompt in Midjourney and return the selected image link.

## Resolution Inspector

- **Purpose:** Check whether a file contains enough pixels for the intended print.
- **Responsibilities:** Read PNG/JPEG dimensions; calculate megapixels, a resolution score, print sizes at 300 PPI and crop warnings.
- **Produces:** Measured technical information, separate from artistic quality.
- **Status:** Implemented as a software check, not AI image judgment. It does not enlarge files or assess whether they look beautiful.

## Visual Quality Agent — planned

- **Purpose:** Help assess the actual finished image.
- **Intended responsibilities:** Identify visible defects, assess texture and composition, and propose a visual score with reasons.
- **Status:** Not implemented. A model connection and image-review workflow are still needed.
- **Current responsibility:** You inspect and score the image from 1 to 10.

## Pricing Guide — resolution and market comparisons

- **Purpose:** Recommend a selling price with an explanation.
- **Responsibilities:** Read measured pixel dimensions, calculate full-image print capacity at 300 PPI, and suggest a USD digital-download price using a dated sample of comparable listings.
- **Status:** Implemented as transparent retail rules, not an AI appraisal or continuous market-research agent. The dashboard shows the sample date, source links, suggested range and limitations. Physical printing and framing costs are excluded.
- **Safeguards:** Existing approved prices remain unchanged. Old market observations expire after 90 days; insufficient evidence asks you to set the price manually. See [Pricing Guide](Pricing Guide.md).
- **Your decision:** Set and approve the final proposed price.

## Product Preparation Assistant

- **Purpose:** Prepare product information after artwork and price approval.
- **Responsibilities:** Build a title, description, price, SKU, tags, search-engine text and image alt text; mark the item as digital with no shipping required.
- **Status:** Implemented locally using templates. It does not create Shopify products or attach customer downloads.
- **Your decision:** Review the prepared fields.

## Shopify Publishing Agent — planned

- **Purpose:** Send approved products to Shopify and publish them.
- **Intended responsibilities:** Create/update product fields, associate media, attach the deliverable through the chosen digital-products app and publish to the intended sales channel.
- **Status:** Publishing adapter and credentials are pending. The existing order webhook is a different connection.
- **Your decision:** Approve the exact artwork and price before this stage may run.

## Creative Memory

- **Purpose:** Retain explicit creative preferences.
- **Responsibilities:** Store ratings and tags and use them to influence later prompt directions.
- **Status:** Implemented. This is preference tracking, not training a new image model.

## Workflow Tracing — LangSmith

- **Purpose:** Help inspect what happened during an AI workflow.
- **Responsibilities:** Record supported runs when tracing is configured, assisting with debugging and evaluation.
- **Status:** Tracing support is configured separately from image generation and model access. A saved tracing key does not prove every run was received successfully.
- **Not responsible for:** Creating artwork, setting prices or publishing products.

## Owner and Final Approver — you

You set the collection direction, approve generation, inspect the final artwork, decide the price and approve product preparation. Human approval is an actual dashboard action, not something the agents infer from a quality score.
