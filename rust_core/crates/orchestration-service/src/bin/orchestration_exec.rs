use orchestration_service::{parse_request_from_args, run_production_workflow};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let request = parse_request_from_args(&args);
    match run_production_workflow(request) {
        Ok(state) => println!("{}", serde_json::to_string_pretty(&state).unwrap()),
        Err(err) => {
            eprintln!("{}", err);
            std::process::exit(1);
        }
    }
}
