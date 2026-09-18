# Rust Migration Workspace

This workspace is the migration foundation for moving clipping orchestration, production, monitoring, and control-center workflows to Rust while keeping the current Python runtime active.

## Workspace crates

- `shared-types`: versioned contracts and shared state models.
- `core-logic`: deterministic production logic (validation, ranking, idempotency, release/render adapters, parity comparison).
- `orchestration-service`: Rust orchestration runtime and CLI entrypoints.
- `monitoring-service`: dashboard-compatible monitoring state manager and monitoring HTTP server.
- `control-center-api`: control-center API for queuing and executing runs with integrated monitoring.

## Runtime entrypoints

- `cargo run -p orchestration-service --bin orchestration_exec -- --topic "AI"`
- `cargo run -p orchestration-service --bin production_exec -- --render --max-retries 2`
- `cargo run -p monitoring-service --bin monitoring_server`
- `cargo run -p monitoring-service --bin dashboard_state_update -- dashboard_state.json completed`
- `cargo run -p control-center-api --bin control_center`

## Validation

Run full Rust checks:

```bash
cargo test
```

The monitoring and control-center tests cover queued/running/completed/failed/retry lifecycle behavior and legacy JSON migration to a versioned schema.
