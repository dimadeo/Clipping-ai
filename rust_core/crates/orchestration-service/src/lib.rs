use std::collections::HashMap;

use core_logic::{
    approval_node, candidate_worker_node, planner_node, rank_node, PromptRegistryAdapter,
    RendererAdapter,
};
use shared_types::{ProductionRequest, ProductionState, RunStatus};

pub struct LocalPromptRegistry;

impl PromptRegistryAdapter for LocalPromptRegistry {
    fn evaluate_prompt(
        &self,
        _prompt: &str,
        _metadata: &HashMap<String, String>,
    ) -> Result<f64, String> {
        Ok(9.4)
    }

    fn register_prompt(
        &self,
        _key: &str,
        prompt: &str,
        score: f64,
    ) -> Result<serde_json::Value, String> {
        Ok(serde_json::json!({"version": 1, "prompt": prompt, "score": score}))
    }

    fn promote_to_prod(&self, _key: &str, version: u64) -> Result<serde_json::Value, String> {
        Ok(serde_json::json!({"version": version, "prompt": "prod_prompt", "score": 9.4}))
    }
}

pub struct NoopRenderer;

impl RendererAdapter for NoopRenderer {
    fn render(&self, prompt: &str, idempotency_key: &str) -> Result<serde_json::Value, String> {
        Ok(serde_json::json!({"job":"accepted","prompt":prompt,"idempotency_key":idempotency_key}))
    }
}

pub fn run_production_workflow(request: ProductionRequest) -> Result<ProductionState, String> {
    let mut state = ProductionState {
        topic: request.topic,
        audience: request.audience,
        angle: request.angle,
        cta: request.cta,
        count: request.count,
        render_enabled: request.render,
        require_approval: request.require_approval,
        ..Default::default()
    };

    state = planner_node(state)?;
    for task in state.tasks.clone() {
        state = candidate_worker_node(state, task)?;
    }
    state = rank_node(state)?;
    state = approval_node(state)?;

    if matches!(state.status, RunStatus::Rejected | RunStatus::Failed) {
        return Ok(state);
    }

    state.status = RunStatus::Completed;
    Ok(state)
}

pub fn parse_request_from_args(args: &[String]) -> ProductionRequest {
    let mut request = ProductionRequest::default();
    let mut i = 1;

    while i < args.len() {
        match args[i].as_str() {
            "--topic" => {
                i += 1;
                request.topic = args
                    .get(i)
                    .cloned()
                    .unwrap_or_else(|| request.topic.clone());
            }
            "--audience" => {
                i += 1;
                request.audience = args
                    .get(i)
                    .cloned()
                    .unwrap_or_else(|| request.audience.clone());
            }
            "--angle" => {
                i += 1;
                request.angle = args
                    .get(i)
                    .cloned()
                    .unwrap_or_else(|| request.angle.clone());
            }
            "--cta" => {
                i += 1;
                request.cta = args.get(i).cloned().unwrap_or_else(|| request.cta.clone());
            }
            "--count" => {
                i += 1;
                request.count = args
                    .get(i)
                    .and_then(|v| v.parse::<u32>().ok())
                    .unwrap_or(request.count);
            }
            "--render" => request.render = true,
            "--require-approval" => request.require_approval = true,
            "--max-retries" => {
                i += 1;
                request.max_retries = args
                    .get(i)
                    .and_then(|v| v.parse::<u32>().ok())
                    .unwrap_or(request.max_retries);
            }
            "--retry-delay-seconds" => {
                i += 1;
                request.retry_delay_seconds = args
                    .get(i)
                    .and_then(|v| v.parse::<u64>().ok())
                    .unwrap_or(request.retry_delay_seconds);
            }
            _ => {}
        }
        i += 1;
    }

    request
}
