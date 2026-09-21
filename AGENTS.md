# Project agents

This repository has specialized Copilot agents for the fine-art creation, upscale production, and dashboard monitoring system. Use the most specific agent for the task instead of the default coding agent when the issue is in one of the pipeline domains below.

## Agent selection guide

### Dashboard Orchestrator Monitor
Use when:
- monitoring dashboard status
- tracing failed orchestrator runs
- debugging worker or queue issues
- checking dashboard_state health and operational status transitions

Best for:
- run-state, queue, status, and lifecycle monitoring problems
- failures in backend-to-dashboard reporting

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
- the work is not clearly in orchestration, dashboard, or prompt-registry paths
- you need a general-purpose implementation or refactor with no workflow-specific constraints

## Working style
- Prefer the smallest relevant agent.
- Start with the most specific one for the failing domain.
- Keep investigations scoped to the affected workflow and artifact contract.
- Validate with the narrowest targeted test or check before concluding.
