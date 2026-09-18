use chrono::Utc;
use serde::{Deserialize, Serialize};

pub const DASHBOARD_SCHEMA_V1: u16 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Idle,
    Queued,
    Running,
    Retrying,
    Completed,
    Error,
    Failed,
    Rejected,
}

impl Default for RunStatus {
    fn default() -> Self {
        Self::Idle
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCategory {
    Validation,
    Approval,
    Render,
    Adapter,
    Runtime,
}

impl Default for ErrorCategory {
    fn default() -> Self {
        Self::Runtime
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StructuredError {
    pub category: ErrorCategory,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PromptTask {
    pub niche: String,
    pub trigger: String,
    pub index: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PromptCandidate {
    pub title: String,
    pub prompt: String,
    pub angle: String,
    pub niche: String,
    pub trigger: String,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ApprovalDecision {
    pub approved: bool,
    pub source: Option<String>,
    pub decision: Option<String>,
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
    pub status: RunStatus,
    pub errors: Vec<StructuredError>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RenderRecord {
    pub idempotency_key: String,
    pub attempts: u32,
    pub response: serde_json::Value,
    pub cached: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DashboardMetrics {
    pub runs_total: u64,
    pub runs_completed: u64,
    pub runs_failed: u64,
    pub render_retries: u64,
    pub last_duration_seconds: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardStateV1 {
    pub schema_version: u16,
    pub status: String,
    pub message: String,
    pub last_run: Option<String>,
    pub result: serde_json::Value,
    pub returncode: Option<i32>,
    pub queue_depth: usize,
    pub metrics: DashboardMetrics,
    pub updated_at: String,
}

impl Default for DashboardStateV1 {
    fn default() -> Self {
        Self {
            schema_version: DASHBOARD_SCHEMA_V1,
            status: "idle".to_string(),
            message: "Dashboard ready".to_string(),
            last_run: None,
            result: serde_json::json!({}),
            returncode: None,
            queue_depth: 0,
            metrics: DashboardMetrics::default(),
            updated_at: Utc::now().to_rfc3339(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductionRequest {
    pub topic: String,
    pub audience: String,
    pub angle: String,
    pub cta: String,
    pub count: u32,
    pub render: bool,
    pub require_approval: bool,
    pub max_retries: u32,
    pub retry_delay_seconds: u64,
}

impl Default for ProductionRequest {
    fn default() -> Self {
        Self {
            topic: "AI for founders".to_string(),
            audience: "startup founders".to_string(),
            angle: "counterintuitive business leverage".to_string(),
            cta: "Follow for more".to_string(),
            count: 5,
            render: false,
            require_approval: false,
            max_retries: 2,
            retry_delay_seconds: 2,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ParityReport {
    pub equivalent: bool,
    pub differing_fields: Vec<String>,
}
