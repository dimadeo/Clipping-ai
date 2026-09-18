use control_center_api::run_control_center_server;

fn main() {
    let bind = std::env::var("CONTROL_CENTER_BIND").unwrap_or_else(|_| "0.0.0.0:8000".to_string());
    let state_path = std::env::var("DASHBOARD_STATE_PATH")
        .unwrap_or_else(|_| "dashboard_state.json".to_string());

    if let Err(err) = run_control_center_server(&bind, &state_path) {
        eprintln!("{}", err);
        std::process::exit(1);
    }
}
