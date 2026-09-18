import json
import os
import queue
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
STATUS_FILE = ROOT / "dashboard_state.json"
INDEX_FILE = ROOT / "dashboard" / "index.html"
RUN_QUEUE = queue.Queue()
STATE_LOCK = threading.Lock()


def default_state() -> dict:
    return {
        "status": "idle",
        "message": "Dashboard ready",
        "last_run": None,
        "result": {},
        "returncode": None,
        "queue_depth": 0,
        "metrics": {
            "runs_total": 0,
            "runs_completed": 0,
            "runs_failed": 0,
            "render_retries": 0,
            "last_duration_seconds": None,
        },
    }


def read_state() -> dict:
    if not STATUS_FILE.exists():
        return default_state()
    try:
        raw = STATUS_FILE.read_text(encoding="utf-8")
        if not raw.strip():
            return default_state()
        data = json.loads(raw)
        return data if isinstance(data, dict) else default_state()
    except json.JSONDecodeError:
        return default_state()


def write_state(state: dict) -> None:
    with STATE_LOCK:
        STATUS_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")


def update_state(**changes) -> dict:
    state = read_state()
    state.update(changes)
    write_state(state)
    return state


def parse_json_output(stdout: str):
    text = (stdout or "").strip()
    if not text:
        return {}
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.rfind("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            fragment = text[start : end + 1]
            try:
                return json.loads(fragment)
            except json.JSONDecodeError:
                return {"raw_output": text}
        return {"raw_output": text}


def build_command(payload: dict) -> list[str]:
    cmd = [
        sys.executable,
        str(ROOT / "viral_master_agent.py"),
        "--topic",
        payload.get("topic") or "AI for founders",
        "--audience",
        payload.get("audience") or "startup founders",
        "--angle",
        payload.get("angle") or "counterintuitive business leverage",
        "--cta",
        payload.get("cta") or "Follow for more",
        "--count",
        str(int(payload.get("count") or 3)),
    ]
    if payload.get("render"):
        cmd.append("--render")
    if payload.get("production"):
        cmd.append("--production")
    if payload.get("loop"):
        cmd.append("--loop")
    if payload.get("max_iterations") is not None:
        cmd.extend(["--max-iterations", str(payload["max_iterations"])])
    return cmd


def run_job(payload: dict) -> None:
    cmd = build_command(payload)
    max_retries = max(0, min(int(payload["max_retries"]), 5)) if "max_retries" in payload else 2
    retry_delay = max(1, min(int(payload["retry_delay_seconds"]), 300)) if "retry_delay_seconds" in payload else 15
    started = time.monotonic()
    metrics = read_state().get("metrics", default_state()["metrics"])
    metrics["runs_total"] = metrics.get("runs_total", 0) + 1
    update_state(
        status="running",
        message="Orchestrator run started",
        last_run="in_progress",
        returncode=None,
        result={},
        command=cmd,
        retry_count=0,
        queue_depth=RUN_QUEUE.qsize(),
        metrics=metrics,
    )

    result = None
    parsed_result = {}
    for attempt in range(max_retries + 1):
        env = os.environ.copy()
        result = subprocess.run(cmd, cwd=str(ROOT), env=env, capture_output=True, text=True)
        parsed_result = parse_json_output(result.stdout)
        render_failed = (
            isinstance(parsed_result, dict)
            and ("render_error" in parsed_result or parsed_result.get("status") == "failed" or parsed_result.get("errors"))
        )
        failed = result.returncode != 0 or render_failed
        if not failed or attempt >= max_retries:
            break
        metrics = read_state().get("metrics", default_state()["metrics"])
        metrics["render_retries"] = metrics.get("render_retries", 0) + 1
        update_state(
            status="retrying",
            message=f"Render failed; retrying in {retry_delay} seconds",
            retry_count=attempt + 1,
            queue_depth=RUN_QUEUE.qsize(),
            metrics=metrics,
        )
        time.sleep(retry_delay)

    duration = round(time.monotonic() - started, 2)
    failed = (
        result.returncode != 0
        or (
            isinstance(parsed_result, dict)
            and ("render_error" in parsed_result or parsed_result.get("status") == "failed" or parsed_result.get("errors"))
        )
    )
    metrics = read_state().get("metrics", default_state()["metrics"])
    metrics["last_duration_seconds"] = duration
    key = "runs_failed" if failed else "runs_completed"
    metrics[key] = metrics.get(key, 0) + 1
    update_state(
        status="error" if failed else "completed",
        message="Orchestrator run failed" if failed else "Orchestrator run finished",
        last_run="completed",
        returncode=result.returncode,
        result=parsed_result,
        stdout=result.stdout,
        stderr=result.stderr,
        command=cmd,
        duration_seconds=duration,
        queue_depth=RUN_QUEUE.qsize(),
        metrics=metrics,
    )


def queue_worker() -> None:
    while True:
        payload = RUN_QUEUE.get()
        try:
            run_job(payload)
        finally:
            RUN_QUEUE.task_done()
            state = read_state()
            state["queue_depth"] = RUN_QUEUE.qsize()
            write_state(state)


threading.Thread(target=queue_worker, name="orchestrator-worker", daemon=True).start()


class DashboardHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path in {"/", "/index.html"}:
            if not INDEX_FILE.exists():
                self.send_response(404)
                self.end_headers()
                self.wfile.write(b"Dashboard page not found")
                return
            html = INDEX_FILE.read_text(encoding="utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(html.encode("utf-8"))
            return

        if parsed.path == "/status":
            self.send_json(read_state())
            return

        self.send_response(404)
        self.end_headers()
        self.wfile.write(b"Not found")

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != "/run":
            self.send_error(404)
            return

        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)

        try:
            payload = json.loads(body.decode("utf-8")) if body else {}
        except json.JSONDecodeError:
            payload = {}

        payload["max_retries"] = payload.get("max_retries", 2)
        payload["retry_delay_seconds"] = payload.get("retry_delay_seconds", 15)
        RUN_QUEUE.put(payload)
        state = read_state()
        state["status"] = "queued"
        state["message"] = "Run added to orchestrator queue"
        state["queue_depth"] = RUN_QUEUE.qsize()
        write_state(state)
        self.send_json({"ok": True, "queued": True, "queue_depth": RUN_QUEUE.qsize()})

    def send_json(self, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args, **kwargs):
        return


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), DashboardHandler)
    print(f"Dashboard server running on http://localhost:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nDashboard server stopped.")
    finally:
        server.server_close()
