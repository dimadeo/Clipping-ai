# Project agents

This repository has specialized Copilot agents for the clipping and production system. Use the most specific agent for the task instead of the default coding agent when the issue is in one of the pipeline domains below.

## Agent selection guide

### Viral Clip Ops
Use when:
- debugging the clipping pipeline
- fixing orchestrators or workflow logic
- investigating prompt or output issues in the social-video stack
- updating production-video workflow behavior

Best for:
- cross-cutting fixes across clip generation and production automation
- root-cause analysis when the issue spans multiple files in the pipeline

### Dashboard Orchestrator Monitor
Use when:
- monitoring dashboard status
- tracing failed orchestrator runs
- debugging worker or queue issues
- checking dashboard_state health and operational status transitions

Best for:
- run-state, queue, status, and lifecycle monitoring problems
- failures in backend-to-dashboard reporting

### Clip Generation Validator
Use when:
- validating clip quality or viral logic
- checking whether generated outputs match the expected contract
- debugging failing clip-generation tests
- reviewing subtitle, metadata, and short-form output correctness

Best for:
- content-quality and output-validation issues in the clipping pipeline
- tests around duration, scoring, metadata, and artifact generation

### Prompt Registry & Approvals
Use when:
- reviewing prompt registry entries or version changes
- debugging production approval flow
- validating promotion logic to production
- checking registry state transitions and approval gating

Best for:
- prompt governance, scoring, registry integrity, and safe production promotion

## Default behavior
Use the default coding agent when:
- the task is a broad feature request not tied to a single workflow domain
- the work is not clearly in the clipping, orchestration, dashboard, or prompt-registry path
- you need a general-purpose implementation or refactor with no workflow-specific constraints

## Working style
- Prefer the smallest relevant agent.
- Start with the most specific one for the failing domain.
- Keep investigations scoped to the affected workflow and artifact contract.
- Validate with the narrowest targeted test or check before concluding.
