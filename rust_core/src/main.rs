use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptTask {
    pub niche: String,
    pub trigger: String,
    pub index: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptCandidate {
    pub title: String,
    pub prompt: String,
    pub angle: String,
    pub niche: String,
    pub trigger: String,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProductionState {
    pub topic: String,
    pub audience: String,
    pub angle: String,
    pub cta: String,
    pub count: u32,
    pub require_approval: bool,
    pub render_enabled: bool,
    pub tasks: Vec<PromptTask>,
    pub candidates: Vec<PromptCandidate>,
    pub ranked_candidates: Vec<PromptCandidate>,
    pub winner: Option<PromptCandidate>,
    pub idempotency_key: Option<String>,
    pub status: String,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalDecision {
    pub approved: bool,
    pub source: Option<String>,
    pub decision: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RenderRecord {
    pub idempotency_key: String,
    pub attempts: u32,
    pub response: HashMap<String, serde_json::Value>,
    pub cached: bool,
}

pub fn validate_prompt_request(topic: &str, audience: &str, angle: &str, cta: &str) -> Result<(), String> {
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
        return Err(format!("Missing required prompt fields: {}", missing.join(", ")));
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
    state.status = "planned".to_string();

    Ok(state)
}

pub fn candidate_worker_node(mut state: ProductionState, task: PromptTask) -> Result<ProductionState, String> {
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
    state.status = "candidate_ready".to_string();
    Ok(state)
}

pub fn rank_node(mut state: ProductionState) -> Result<ProductionState, String> {
    if state.candidates.is_empty() {
        state.errors.push("No prompt candidates were produced.".to_string());
        state.status = "failed".to_string();
        return Ok(state);
    }

    let mut ranked = state.candidates.clone();
    ranked.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal).then_with(|| a.title.cmp(&b.title)));

    let winner = ranked.first().cloned().unwrap();
    let key = create_idempotency_key(&winner.prompt, &state.topic, &state.audience, &state.angle);

    state.ranked_candidates = ranked;
    state.winner = Some(winner.clone());
    state.idempotency_key = Some(key);
    state.status = "ranked".to_string();
    Ok(state)
}

pub fn approval_node(mut state: ProductionState) -> Result<ProductionState, String> {
    if !state.require_approval {
        state.status = "approved".to_string();
        state.winner = state.winner.clone();
        return Ok(state);
    }

    let decision = ApprovalDecision {
        approved: true,
        source: Some("automatic_policy".to_string()),
        decision: Some("approve".to_string()),
    };

    if !decision.approved {
        state.status = "rejected".to_string();
        return Ok(state);
    }

    state.status = "approved".to_string();
    Ok(state)
}

pub fn render_job_record(state: &ProductionState) -> Result<RenderRecord, String> {
    let winner = state.winner.as_ref().ok_or("No winner selected")?;
    let key = state.idempotency_key.clone().unwrap_or_else(|| {
        create_idempotency_key(&winner.prompt, &state.topic, &state.audience, &state.angle)
    });

    let mut response = HashMap::new();
    response.insert("submitted_at".to_string(), serde_json::Value::String(Utc::now().to_rfc3339()));
    response.insert("winner".to_string(), serde_json::json!({
        "title": winner.title,
        "niche": winner.niche,
        "trigger": winner.trigger,
        "score": winner.score
    }));

    Ok(RenderRecord {
        idempotency_key: key,
        attempts: 1,
        response,
        cached: false,
    })
}

fn main() {
    let base = ProductionState {
        topic: "AI for founders".to_string(),
        audience: "startup founders".to_string(),
        angle: "counterintuitive business leverage with high stop-the-scroll tension and a sharp emotional payoff".to_string(),
        cta: "Follow for more".to_string(),
        count: 5,
        require_approval: true,
        render_enabled: true,
        ..Default::default()
    };

    let planned = planner_node(base).expect("planner should validate input");
    let mut current = planned;

    for task in current.tasks.clone() {
        current = candidate_worker_node(current, task).expect("worker should create candidate");
    }

    current = rank_node(current).expect("ranking should succeed");
    current = approval_node(current).expect("approval should succeed");

    let record = render_job_record(&current).expect("render record should be created");
    println!("status={} winner={} idempotency_key={} cached={}", current.status, current.winner.as_ref().map(|w| w.title.as_str()).unwrap_or("none"), record.idempotency_key, record.cached);
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!(current.status, "ranked");
    }
}
