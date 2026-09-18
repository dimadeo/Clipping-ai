use monitoring_service::MonitoringStore;
use shared_types::RunStatus;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let state_path = args
        .get(1)
        .cloned()
        .unwrap_or_else(|| "dashboard_state.json".to_string());
    let status = args
        .get(2)
        .cloned()
        .unwrap_or_else(|| "completed".to_string());

    let run_status = match status.as_str() {
        "queued" => RunStatus::Queued,
        "running" => RunStatus::Running,
        "retrying" => RunStatus::Retrying,
        "failed" => RunStatus::Failed,
        "error" => RunStatus::Error,
        _ => RunStatus::Completed,
    };

    let store = MonitoringStore::new(state_path);
    store.finish_run(run_status, serde_json::json!({"status": status}), 0, 0.0);
    println!(
        "{}",
        serde_json::to_string_pretty(&store.snapshot()).unwrap()
    );
}
