# The Dark Matters — User Guide

Your guide to creating collections, reviewing artwork and preparing products for your shop.

Guide updated: 12 September 2026. The status descriptions below reflect the current application, not a promise that every planned integration is live.

## Read these guides

1. [Dashboard instructions](Dashboard Instructions.md) — how to create a brief, choose formats, generate images and review results.
2. [Agent directory](Agent Directory.md) — each agent or system component, its responsibilities and what still needs setup.
3. [Glossary](Glossary.md) — the words used in your dashboard, explained simply.
4. [Creative brief vocabulary](Creative Brief Vocabulary.md) — an expanded art vocabulary with meanings, example phrases, a brief template and complete examples.

Open your [dashboard](http://127.0.0.1:3002/#canvas). It currently runs on this computer; the local service must be running to use it.

## The workflow

Creative brief → three directions → you approve a direction → image creation → quality and price review → you approve the artwork and price → product fields prepared → Shopify publishing when connected.

There are two separate decisions: approving a creative direction allows generation; approving the finished artwork and price prepares its product information. One does not replace the other.

## What is ready today?

| Feature | Current position |
| --- | --- |
| Canvas, size selection and prompt directions | Available locally |
| FLUX automatic creation and image return | Connector implemented; last live connection check returned HTTP 500, so not yet verified |
| Midjourney | Manual creation and image-link return |
| Actual image dimensions and print-resolution checks | Available for supported PNG/JPEG files |
| Visual scoring | You score the artwork; automatic AI visual scoring is pending |
| Price proposal | Measured pixels and print capacity combined with dated digital-download comparisons; editable suggestion, not an appraisal |
| Product information | Prepared locally after your approval |
| Shopify publishing and downloadable customer files | Still need implementation/configuration |

Keep API keys in the private settings file. Never add keys, passwords or customer information to this guide.
