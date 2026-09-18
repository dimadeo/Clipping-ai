# ADR-001: Human-supervised creative AI orchestration

**Status:** Accepted
**Date:** 2026-09-11
**Decider:** The Dark Matters owner

## Context

The Creative Studio needs to create strong art directions without becoming a black box. The owner must always be able to compare ideas, choose an image, and decide whether anything proceeds to Midjourney or Shopify.

## Decision

Use LangGraph as the workflow controller around the existing Creative Prompt Agent. Use LangChain as the optional model connection for art-director review. Use LangSmith tracing when its project key is configured.

The workflow is:

`brief → three directions → art-director review → owner approval → Midjourney handoff`

The graph stops at owner approval. It does not generate in Midjourney, publish to Shopify, or send customer files without a separate explicit action.

## Consequences

- The dashboard remains the simple approval room.
- With no model key, the system works in safe local-review mode.
- Setting `OPENAI_API_KEY` enables a LangChain art-director note.
- Setting `LANGSMITH_TRACING=true`, `LANGSMITH_API_KEY`, and optionally `LANGSMITH_PROJECT` records traces for debugging and quality evaluation.
- Cloud deployment should provide these values as secret environment variables, never in source code.
