use chrono::Utc;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::thread;
use std::time::Duration;

use shared_types::{
    ApprovalDecision, ErrorCategory, ParityReport, ProductionState, PromptCandidate, PromptTask,
    RenderRecord, StructuredError,
};

pub trait PromptRegistryAdapter {
    fn evaluate_prompt(
        &self,
        prompt: &str,
        metadata: &HashMap<String, String>,
    ) -> Result<f64, String>;
    fn register_prompt(
        &self,
        key: &str,
        prompt: &str,
        score: f64,
    ) -> Result<serde_json::Value, String>;
    fn promote_to_prod(&self, key: &str, version: u64) -> Result<serde_json::Value, String>;
}

pub trait RendererAdapter {
    fn render(&self, prompt: &str, idempotency_key: &str) -> Result<serde_json::Value, String>;
}

#[derive(Default)]
pub struct InMemoryRenderCache {
    records: HashMap<String, RenderRecord>,
}

impl InMemoryRenderCache {
    pub fn execute(
        &mut self,
        renderer: &dyn RendererAdapter,
        prompt: &str,
        idempotency_key: &str,
        max_retries: u32,
        retry_delay_seconds: u64,
    ) -> Result<RenderRecord, String> {
        if let Some(existing) = self.records.get(idempotency_key) {
            let mut clone = existing.clone();
            clone.cached = true;
            return Ok(clone);
        }

        let mut last_error: Option<String> = None;
        for attempt in 0..=max_retries {
            match renderer.render(prompt, idempotency_key) {
                Ok(response) => {
                    let record = RenderRecord {
                        idempotency_key: idempotency_key.to_string(),
                        attempts: attempt + 1,
                        response,
                        cached: false,
                    };
                    self.records
                        .insert(idempotency_key.to_string(), record.clone());
                    return Ok(record);
                }
                Err(err) => {
                    last_error = Some(err);
                    if attempt < max_retries {
                        thread::sleep(Duration::from_secs(retry_delay_seconds));
                    }
                }
            }
        }

        Err(last_error.unwrap_or_else(|| "render failed without error".to_string()))
    }
}

pub fn validate_prompt_request(
    topic: &str,
    audience: &str,
    angle: &str,
    cta: &str,
) -> Result<(), String> {
    let values = [
        ("topic", topic.trim()),
        ("audience", audience.trim()),
        ("angle", angle.trim()),
        ("cta", cta.trim()),
    ];

    let missing: Vec<_> = values
        .iter()
        .filter_map(|(field, value)| if value.is_empty() { Some(*field) } else { None })
        .collect();

    if !missing.is_empty() {
        return Err(format!(
            "Missing required prompt fields: {}",
            missing.join(", ")
        ));
    }

    Ok(())
}

pub fn create_idempotency_key(prompt: &str, topic: &str, audience: &str, angle: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(prompt.as_bytes());
    hasher.update(b"|");
    hasher.update(topic.as_bytes());
    hasher.update(b"|");
    hasher.update(audience.as_bytes());
    hasher.update(b"|");
    hasher.update(angle.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn planner_node(mut state: ProductionState) -> Result<ProductionState, String> {
    validate_prompt_request(&state.topic, &state.audience, &state.angle, &state.cta)?;

    let patterns = [
        ("AI & Tech Breakthroughs", "FOMO"),
        ("Founder & Business Strategy", "Curiosity Gap"),
        ("Psychology & Human Behavior", "Ego Validation"),
        ("Personal Finance & Wealth", "High-Utility Outrage"),
        ("Creator Economy", "FOMO"),
    ];

    let count = state.count.max(1).min(patterns.len() as u32) as usize;
    state.tasks = patterns[..count]
        .iter()
        .enumerate()
        .map(|(index, (niche, trigger))| PromptTask {
            niche: niche.to_string(),
            trigger: trigger.to_string(),
            index: (index + 1) as u32,
        })
        .collect();
    state.status = shared_types::RunStatus::Queued;

    Ok(state)
}

pub fn candidate_worker_node(
    mut state: ProductionState,
    task: PromptTask,
) -> Result<ProductionState, String> {
    let prompt = format!(
        "Create a 45-second viral short-form video in 9:16 vertical format for TikTok, Reels, and Shorts. Topic: {}. Audience: {}. Angle: {}. Niche: {}. Trigger: {}. Open with a bold stop-the-scroll hook in the first 1-2 seconds, show a fast premium visual story, deliver a surprising payoff, and end with a strong CTA: {}.",
        state.topic,
        state.audience,
        state.angle,
        task.niche,
        task.trigger,
        state.cta
    );

    let candidate = PromptCandidate {
        title: format!("{} - {} - {}", task.niche, task.trigger, task.index),
        prompt,
        angle: state.angle.clone(),
        niche: task.niche,
        trigger: task.trigger,
        score: 9.0 + ((task.index as f64) - 1.0) * 0.2,
    };

    state.candidates.push(candidate);
    state.status = shared_types::RunStatus::Running;
    Ok(state)
}

pub fn rank_node(mut state: ProductionState) -> Result<ProductionState, String> {
    if state.candidates.is_empty() {
        state.errors.push(StructuredError {
            category: ErrorCategory::Runtime,
            message: "No prompt candidates were produced.".to_string(),
        });
        state.status = shared_types::RunStatus::Failed;
        return Ok(state);
    }

    let mut ranked = state.candidates.clone();
    ranked.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.title.cmp(&b.title))
    });

    let winner = ranked.first().cloned().unwrap();
    let key = create_idempotency_key(&winner.prompt, &state.topic, &state.audience, &state.angle);

    state.ranked_candidates = ranked;
    state.winner = Some(winner.clone());
    state.idempotency_key = Some(key);
    state.status = shared_types::RunStatus::Running;
    Ok(state)
}

pub fn approval_node(mut state: ProductionState) -> Result<ProductionState, String> {
    if !state.require_approval {
        state.status = shared_types::RunStatus::Running;
        return Ok(state);
    }

    let decision = ApprovalDecision {
        approved: true,
        source: Some("automatic_policy".to_string()),
        decision: Some("approve".to_string()),
    };

    if !decision.approved {
        state.status = shared_types::RunStatus::Rejected;
        return Ok(state);
    }

    state.status = shared_types::RunStatus::Running;
    Ok(state)
}

pub fn release_node(
    state: &ProductionState,
    registry: &dyn PromptRegistryAdapter,
) -> Result<serde_json::Value, String> {
    let winner = state.winner.as_ref().ok_or("No winner selected")?;
    let metadata = HashMap::from([
        ("topic".to_string(), state.topic.clone()),
        ("audience".to_string(), state.audience.clone()),
        ("angle".to_string(), state.angle.clone()),
        ("cta".to_string(), state.cta.clone()),
        ("niche".to_string(), winner.niche.clone()),
        ("trigger".to_string(), winner.trigger.clone()),
    ]);

    let score = registry.evaluate_prompt(&winner.prompt, &metadata)?;
    let entry = registry.register_prompt("viral_master_prod_prompt", &winner.prompt, score)?;
    let version = entry
        .get("version")
        .and_then(|value| value.as_u64())
        .ok_or("registry response missing version")?;
    registry.promote_to_prod("viral_master_prod_prompt", version)
}

pub fn render_node(
    state: &ProductionState,
    cache: &mut InMemoryRenderCache,
    renderer: &dyn RendererAdapter,
    max_retries: u32,
    retry_delay_seconds: u64,
) -> Result<RenderRecord, String> {
    let winner = state.winner.as_ref().ok_or("No winner selected")?;
    let key = state.idempotency_key.clone().unwrap_or_else(|| {
        create_idempotency_key(&winner.prompt, &state.topic, &state.audience, &state.angle)
    });
    cache.execute(
        renderer,
        &winner.prompt,
        &key,
        max_retries,
        retry_delay_seconds,
    )
}

pub fn render_job_record(state: &ProductionState) -> Result<RenderRecord, String> {
    let winner = state.winner.as_ref().ok_or("No winner selected")?;
    let key = state.idempotency_key.clone().unwrap_or_else(|| {
        create_idempotency_key(&winner.prompt, &state.topic, &state.audience, &state.angle)
    });

    Ok(RenderRecord {
        idempotency_key: key,
        attempts: 1,
        response: serde_json::json!({
            "submitted_at": Utc::now().to_rfc3339(),
            "winner": {
                "title": winner.title,
                "niche": winner.niche,
                "trigger": winner.trigger,
                "score": winner.score,
            }
        }),
        cached: false,
    })
}

pub fn compare_parity(
    rust_result: &serde_json::Value,
    python_result: &serde_json::Value,
) -> ParityReport {
    let rust_obj = rust_result.as_object().cloned().unwrap_or_default();
    let python_obj = python_result.as_object().cloned().unwrap_or_default();

    let mut differing = Vec::new();
    for key in rust_obj.keys().chain(python_obj.keys()) {
        let r = rust_obj.get(key);
        let p = python_obj.get(key);
        if r != p && !differing.contains(key) {
            differing.push(key.clone());
        }
    }

    ParityReport {
        equivalent: differing.is_empty(),
        differing_fields: differing,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct NoopRegistry;
    impl PromptRegistryAdapter for NoopRegistry {
        fn evaluate_prompt(
            &self,
            _prompt: &str,
            _metadata: &HashMap<String, String>,
        ) -> Result<f64, String> {
            Ok(9.5)
        }

        fn register_prompt(
            &self,
            _key: &str,
            prompt: &str,
            score: f64,
        ) -> Result<serde_json::Value, String> {
            Ok(serde_json::json!({"version": 1, "prompt": prompt, "score": score}))
        }

        fn promote_to_prod(&self, _key: &str, _version: u64) -> Result<serde_json::Value, String> {
            Ok(serde_json::json!({"version": 1, "prompt": "ok", "score": 9.5}))
        }
    }

    struct NoopRenderer;
    impl RendererAdapter for NoopRenderer {
        fn render(
            &self,
            _prompt: &str,
            idempotency_key: &str,
        ) -> Result<serde_json::Value, String> {
            Ok(serde_json::json!({"job_id": idempotency_key}))
        }
    }

    #[test]
    fn validates_required_fields() {
        let err = validate_prompt_request("AI", "founders", "angle", "").unwrap_err();
        assert!(err.contains("cta"));
    }

    #[test]
    fn creates_stable_idempotency_key() {
        let a = create_idempotency_key("prompt", "topic", "audience", "angle");
        let b = create_idempotency_key("prompt", "topic", "audience", "angle");
        assert_eq!(a, b);
        assert_eq!(a.len(), 64);
    }

    #[test]
    fn ranks_default_candidates() {
        let state = ProductionState {
            topic: "AI for founders".to_string(),
            audience: "startup founders".to_string(),
            angle: "counterintuitive leverage".to_string(),
            cta: "Follow for more".to_string(),
            count: 3,
            ..Default::default()
        };

        let planned = planner_node(state).unwrap();
        let mut current = planned;
        for task in current.tasks.clone() {
            current = candidate_worker_node(current, task).unwrap();
        }
        current = rank_node(current).unwrap();

        assert!(!current.ranked_candidates.is_empty());
        assert!(current.winner.is_some());
    }

    #[test]
    fn release_and_render_basics_work() {
        let state = ProductionState {
            topic: "AI".to_string(),
            audience: "founders".to_string(),
            angle: "angle".to_string(),
            cta: "cta".to_string(),
            count: 1,
            winner: Some(PromptCandidate {
                title: "winner".to_string(),
                prompt: "prompt".to_string(),
                angle: "angle".to_string(),
                niche: "niche".to_string(),
                trigger: "trigger".to_string(),
                score: 9.9,
            }),
            idempotency_key: Some("idempotent-key".to_string()),
            ..Default::default()
        };

        let release = release_node(&state, &NoopRegistry).unwrap();
        assert_eq!(release.get("version").and_then(|v| v.as_u64()), Some(1));

        let mut cache = InMemoryRenderCache::default();
        let first = render_node(&state, &mut cache, &NoopRenderer, 1, 0).unwrap();
        let second = render_node(&state, &mut cache, &NoopRenderer, 1, 0).unwrap();
        assert!(!first.cached);
        assert!(second.cached);
    }

    #[test]
    fn parity_detects_differences() {
        let rust = serde_json::json!({"status":"ok","count":1});
        let py = serde_json::json!({"status":"ok","count":2});
        let report = compare_parity(&rust, &py);
        assert!(!report.equivalent);
        assert_eq!(report.differing_fields, vec!["count".to_string()]);
    }
}
