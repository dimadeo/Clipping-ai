use core_logic::{release_node, render_node, InMemoryRenderCache};
use orchestration_service::{
    parse_request_from_args, run_production_workflow, LocalPromptRegistry, NoopRenderer,
};
use shared_types::RunStatus;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let request = parse_request_from_args(&args);

    match run_production_workflow(request.clone()) {
        Ok(mut state) => {
            if matches!(state.status, RunStatus::Rejected | RunStatus::Failed) {
                println!("{}", serde_json::to_string_pretty(&state).unwrap());
                return;
            }

            let release = release_node(&state, &LocalPromptRegistry);
            match release {
                Ok(value) => {
                    if request.render {
                        let mut cache = InMemoryRenderCache::default();
                        if let Err(err) = render_node(
                            &state,
                            &mut cache,
                            &NoopRenderer,
                            request.max_retries,
                            request.retry_delay_seconds,
                        ) {
                            state.status = RunStatus::Failed;
                            eprintln!("{}", err);
                            std::process::exit(1);
                        }
                    }
                    let output = serde_json::json!({"state": state, "release": value});
                    println!("{}", serde_json::to_string_pretty(&output).unwrap());
                }
                Err(err) => {
                    eprintln!("{}", err);
                    std::process::exit(1);
                }
            }
        }
        Err(err) => {
            eprintln!("{}", err);
            std::process::exit(1);
        }
    }
}
