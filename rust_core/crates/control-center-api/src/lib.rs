use std::collections::VecDeque;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use monitoring_service::MonitoringStore;
use orchestration_service::run_production_workflow;
use shared_types::{ProductionRequest, RunStatus};

#[derive(Clone)]
pub struct ControlCenter {
    queue: Arc<Mutex<VecDeque<ProductionRequest>>>,
    monitor: MonitoringStore,
}

impl ControlCenter {
    pub fn new(monitor: MonitoringStore) -> Self {
        Self {
            queue: Arc::new(Mutex::new(VecDeque::new())),
            monitor,
        }
    }

    pub fn queue_run(&self, request: ProductionRequest) {
        self.queue.lock().expect("poisoned").push_back(request);
        self.monitor.queue_run();
    }

    pub fn process_next(&self) -> Result<bool, String> {
        let next = self.queue.lock().expect("poisoned").pop_front();
        let Some(request) = next else {
            return Ok(false);
        };

        self.monitor.start_run();
        let started = Instant::now();

        match run_production_workflow(request) {
            Ok(state) => {
                let status = state.status.clone();
                let returncode = if matches!(status, RunStatus::Completed) {
                    0
                } else {
                    1
                };
                self.monitor.finish_run(
                    status,
                    serde_json::to_value(state).unwrap_or_else(|_| serde_json::json!({})),
                    returncode,
                    started.elapsed().as_secs_f64(),
                );
                Ok(true)
            }
            Err(err) => {
                self.monitor.mark_retry();
                self.monitor.finish_run(
                    RunStatus::Failed,
                    serde_json::json!({"error": err}),
                    1,
                    started.elapsed().as_secs_f64(),
                );
                Err("workflow execution failed".to_string())
            }
        }
    }

    pub fn status_json(&self) -> String {
        serde_json::to_string(&self.monitor.snapshot()).unwrap_or_else(|_| "{}".to_string())
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

fn parse_body(request: &str) -> Option<&str> {
    request.split("\r\n\r\n").nth(1)
}

fn handle_connection(stream: TcpStream, center: &ControlCenter) {
    let mut stream = stream;
    let mut buffer = vec![0_u8; 16384];
    let bytes_read = stream.read(&mut buffer).unwrap_or(0);
    let request = String::from_utf8_lossy(&buffer[..bytes_read]);

    let first_line = request.lines().next().unwrap_or("");
    let method = first_line.split_whitespace().next().unwrap_or("GET");
    let path = first_line.split_whitespace().nth(1).unwrap_or("/");

    match (method, path) {
        ("GET", "/health") => respond(stream, "200 OK", "{\"ok\":true}", "application/json"),
        ("GET", "/status") => respond(stream, "200 OK", &center.status_json(), "application/json"),
        ("POST", "/run") => {
            let Some(body) = parse_body(&request) else {
                respond(
                    stream,
                    "400 Bad Request",
                    "{\"error\":\"missing request body\"}",
                    "application/json",
                );
                return;
            };

            let request_payload = match serde_json::from_str::<ProductionRequest>(body) {
                Ok(payload) => payload,
                Err(_) => {
                    respond(
                        stream,
                        "400 Bad Request",
                        "{\"error\":\"invalid request payload\"}",
                        "application/json",
                    );
                    return;
                }
            };

            center.queue_run(request_payload);
            let _ = center.process_next();
            respond(stream, "200 OK", "{\"ok\":true}", "application/json");
        }
        _ => respond(stream, "404 Not Found", "Not found", "text/plain"),
    }
}

pub fn run_control_center_server(bind: &str, state_path: &str) -> Result<(), String> {
    let monitor = MonitoringStore::new(state_path);
    let center = ControlCenter::new(monitor);

    let listener = TcpListener::bind(bind).map_err(|err| err.to_string())?;
    for stream in listener.incoming().flatten() {
        let clone = center.clone();
        std::thread::spawn(move || handle_connection(stream, &clone));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_malformed_run_payload() {
        let malformed = r#"{"topic": 1"#;
        let parsed = serde_json::from_str::<ProductionRequest>(malformed);
        assert!(parsed.is_err());
    }

    #[test]
    fn queue_and_process_updates_status() {
        let temp = std::env::temp_dir().join("control_center_state.json");
        let _ = std::fs::remove_file(&temp);
        let monitor = MonitoringStore::new(&temp);
        let center = ControlCenter::new(monitor);

        center.queue_run(ProductionRequest::default());
        let processed = center.process_next().unwrap();
        assert!(processed);

        let status: serde_json::Value = serde_json::from_str(&center.status_json()).unwrap();
        assert!(status.get("status").is_some());
        assert!(status.get("metrics").is_some());
    }
}
