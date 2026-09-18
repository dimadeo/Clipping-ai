use chrono::Utc;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use shared_types::{DashboardStateV1, RunStatus, DASHBOARD_SCHEMA_V1};

#[derive(Clone)]
pub struct MonitoringStore {
    path: PathBuf,
    state: Arc<Mutex<DashboardStateV1>>,
}

impl MonitoringStore {
    pub fn new(path: impl AsRef<Path>) -> Self {
        let path = path.as_ref().to_path_buf();
        let state = load_or_default(&path);
        Self {
            path,
            state: Arc::new(Mutex::new(state)),
        }
    }

    pub fn snapshot(&self) -> DashboardStateV1 {
        self.state.lock().expect("poisoned").clone()
    }

    pub fn queue_run(&self) {
        let mut state = self.state.lock().expect("poisoned");
        state.status = "queued".to_string();
        state.message = "Run added to orchestrator queue".to_string();
        state.queue_depth += 1;
        state.updated_at = Utc::now().to_rfc3339();
        persist(&self.path, &state);
    }

    pub fn start_run(&self) {
        let mut state = self.state.lock().expect("poisoned");
        state.status = "running".to_string();
        state.message = "Orchestrator run started".to_string();
        state.last_run = Some("in_progress".to_string());
        state.metrics.runs_total += 1;
        if state.queue_depth > 0 {
            state.queue_depth -= 1;
        }
        state.updated_at = Utc::now().to_rfc3339();
        persist(&self.path, &state);
    }

    pub fn mark_retry(&self) {
        let mut state = self.state.lock().expect("poisoned");
        state.status = "retrying".to_string();
        state.message = "Render failed; retrying".to_string();
        state.metrics.render_retries += 1;
        state.updated_at = Utc::now().to_rfc3339();
        persist(&self.path, &state);
    }

    pub fn finish_run(
        &self,
        status: RunStatus,
        result: serde_json::Value,
        returncode: i32,
        duration_seconds: f64,
    ) {
        let mut state = self.state.lock().expect("poisoned");
        state.status = match status {
            RunStatus::Completed => "completed",
            RunStatus::Failed | RunStatus::Error => "error",
            RunStatus::Rejected => "rejected",
            RunStatus::Retrying => "retrying",
            RunStatus::Running => "running",
            RunStatus::Queued => "queued",
            RunStatus::Idle => "idle",
        }
        .to_string();

        state.message = match status {
            RunStatus::Completed => "Orchestrator run finished".to_string(),
            RunStatus::Rejected => "Orchestrator run rejected".to_string(),
            _ => "Orchestrator run failed".to_string(),
        };
        state.last_run = Some(match status {
            RunStatus::Completed => "completed".to_string(),
            RunStatus::Rejected => "rejected".to_string(),
            _ => "failed".to_string(),
        });
        state.returncode = Some(returncode);
        state.result = result;
        state.metrics.last_duration_seconds = Some(duration_seconds);
        if matches!(status, RunStatus::Completed) {
            state.metrics.runs_completed += 1;
        } else if matches!(status, RunStatus::Failed | RunStatus::Error) {
            state.metrics.runs_failed += 1;
        }
        state.updated_at = Utc::now().to_rfc3339();
        persist(&self.path, &state);
    }

    pub fn migrate_legacy_payload(&self, legacy_json: &str) -> DashboardStateV1 {
        let mut state = DashboardStateV1::default();
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(legacy_json) {
            if let Some(status) = value.get("status").and_then(|v| v.as_str()) {
                state.status = status.to_string();
            }
            if let Some(message) = value.get("message").and_then(|v| v.as_str()) {
                state.message = message.to_string();
            }
            if let Some(last_run) = value.get("last_run").and_then(|v| v.as_str()) {
                state.last_run = Some(last_run.to_string());
            }
            if let Some(result) = value.get("result") {
                state.result = result.clone();
            }
            if let Some(returncode) = value.get("returncode").and_then(|v| v.as_i64()) {
                if (i32::MIN as i64..=i32::MAX as i64).contains(&returncode) {
                    state.returncode = Some(returncode as i32);
                }
            }
            if let Some(queue_depth) = value.get("queue_depth").and_then(|v| v.as_u64()) {
                if queue_depth <= usize::MAX as u64 {
                    state.queue_depth = queue_depth as usize;
                }
            }
            if let Some(metrics) = value.get("metrics") {
                if let Some(total) = metrics.get("runs_total").and_then(|v| v.as_u64()) {
                    state.metrics.runs_total = total;
                }
                if let Some(completed) = metrics.get("runs_completed").and_then(|v| v.as_u64()) {
                    state.metrics.runs_completed = completed;
                }
                if let Some(failed) = metrics.get("runs_failed").and_then(|v| v.as_u64()) {
                    state.metrics.runs_failed = failed;
                }
                if let Some(retries) = metrics.get("render_retries").and_then(|v| v.as_u64()) {
                    state.metrics.render_retries = retries;
                }
                if let Some(last_duration) = metrics
                    .get("last_duration_seconds")
                    .and_then(|v| v.as_f64())
                {
                    state.metrics.last_duration_seconds = Some(last_duration);
                }
            }
        }

        state.schema_version = DASHBOARD_SCHEMA_V1;
        state.updated_at = Utc::now().to_rfc3339();
        state
    }
}

fn load_or_default(path: &Path) -> DashboardStateV1 {
    if !path.exists() {
        return DashboardStateV1::default();
    }

    match fs::read_to_string(path) {
        Ok(content) => {
            if let Ok(state) = serde_json::from_str::<DashboardStateV1>(&content) {
                state
            } else {
                let store = MonitoringStore {
                    path: path.to_path_buf(),
                    state: Arc::new(Mutex::new(DashboardStateV1::default())),
                };
                store.migrate_legacy_payload(&content)
            }
        }
        Err(_) => DashboardStateV1::default(),
    }
}

fn persist(path: &Path, state: &DashboardStateV1) {
    if let Ok(json) = serde_json::to_string_pretty(state) {
        let _ = fs::write(path, json);
    }
}

fn respond(mut stream: TcpStream, status: &str, body: &str, content_type: &str) {
    let response = format!(
        "HTTP/1.1 {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status,
        content_type,
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
}

fn handle_connection(stream: TcpStream, store: &MonitoringStore) {
    let mut stream = stream;
    let mut buffer = [0_u8; 2048];
    let bytes_read = stream.read(&mut buffer).unwrap_or(0);
    let request = String::from_utf8_lossy(&buffer[..bytes_read]);

    let path = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or("/");

    match path {
        "/health" => respond(stream, "200 OK", "{\"ok\":true}", "application/json"),
        "/status" => {
            let payload =
                serde_json::to_string(&store.snapshot()).unwrap_or_else(|_| "{}".to_string());
            respond(stream, "200 OK", &payload, "application/json")
        }
        _ => respond(stream, "404 Not Found", "Not found", "text/plain"),
    }
}

pub fn run_http_server(store: MonitoringStore, bind: &str) -> Result<(), String> {
    let listener = TcpListener::bind(bind).map_err(|err| err.to_string())?;
    for stream in listener.incoming().flatten() {
        let clone = store.clone();
        std::thread::spawn(move || handle_connection(stream, &clone));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queued_running_completed_flow_updates_metrics() {
        let temp = std::env::temp_dir().join("monitoring_state_queued_running_completed.json");
        let _ = fs::remove_file(&temp);
        let store = MonitoringStore::new(&temp);

        store.queue_run();
        let after_queue = store.snapshot();
        assert_eq!(after_queue.status, "queued");
        assert_eq!(after_queue.queue_depth, 1);

        store.start_run();
        let after_start = store.snapshot();
        assert_eq!(after_start.status, "running");
        assert_eq!(after_start.queue_depth, 0);
        assert_eq!(after_start.metrics.runs_total, 1);

        store.finish_run(
            RunStatus::Completed,
            serde_json::json!({"status":"ok"}),
            0,
            1.2,
        );
        let completed = store.snapshot();
        assert_eq!(completed.status, "completed");
        assert_eq!(completed.metrics.runs_completed, 1);
    }

    #[test]
    fn retry_and_failure_are_recorded() {
        let temp = std::env::temp_dir().join("monitoring_state_retry_failure.json");
        let _ = fs::remove_file(&temp);
        let store = MonitoringStore::new(&temp);

        store.start_run();
        store.mark_retry();
        store.finish_run(
            RunStatus::Failed,
            serde_json::json!({"status":"failed"}),
            1,
            2.5,
        );

        let state = store.snapshot();
        assert_eq!(state.status, "error");
        assert_eq!(state.last_run.as_deref(), Some("failed"));
        assert_eq!(state.metrics.render_retries, 1);
        assert_eq!(state.metrics.runs_failed, 1);
    }

    #[test]
    fn rejected_runs_have_distinct_terminal_message() {
        let temp = std::env::temp_dir().join("monitoring_state_rejected.json");
        let _ = fs::remove_file(&temp);
        let store = MonitoringStore::new(&temp);

        store.start_run();
        store.finish_run(
            RunStatus::Rejected,
            serde_json::json!({"status":"rejected"}),
            1,
            0.8,
        );

        let state = store.snapshot();
        assert_eq!(state.status, "rejected");
        assert_eq!(state.message, "Orchestrator run rejected");
        assert_eq!(state.last_run.as_deref(), Some("rejected"));
    }

    #[test]
    fn legacy_payload_is_migrated_to_versioned_schema() {
        let temp = std::env::temp_dir().join("monitoring_state_migration.json");
        let _ = fs::remove_file(&temp);
        let store = MonitoringStore::new(&temp);

        let legacy = r#"{
          "status":"completed",
          "message":"ok",
          "last_run":"completed",
          "result":{"k":"v"},
          "returncode":0,
          "queue_depth":0,
          "metrics":{"runs_total":3,"runs_completed":2,"runs_failed":1,"render_retries":4,"last_duration_seconds":9.3}
        }"#;

        let migrated = store.migrate_legacy_payload(legacy);
        assert_eq!(migrated.schema_version, DASHBOARD_SCHEMA_V1);
        assert_eq!(migrated.metrics.runs_total, 3);
        assert_eq!(migrated.status, "completed");
    }
}
