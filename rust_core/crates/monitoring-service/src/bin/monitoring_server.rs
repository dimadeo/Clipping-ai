use monitoring_service::{run_http_server, MonitoringStore};

fn main() {
    let state_path = std::env::var("DASHBOARD_STATE_PATH")
        .unwrap_or_else(|_| "dashboard_state.json".to_string());
    let bind = std::env::var("MONITORING_BIND").unwrap_or_else(|_| "0.0.0.0:8001".to_string());
    let store = MonitoringStore::new(state_path);
    if let Err(err) = run_http_server(store, &bind) {
        eprintln!("{}", err);
        std::process::exit(1);
    }
}
