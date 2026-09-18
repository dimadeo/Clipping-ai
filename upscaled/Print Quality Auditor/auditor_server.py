#!/usr/bin/env python3
r"""auditor_server.py -- run the Print Quality Auditor on this computer (no internet needed).

  python auditor_server.py                      serve this folder on http://127.0.0.1:8792 and open the browser
  python auditor_server.py --port 8800          another port
  python auditor_server.py --output C:\path     the pipeline's output folder (default: from ..\.env, else ..\output)
  python auditor_server.py --no-browser

Routes: /            the dashboard (index.html, scripts, vendor libraries)
        /output/...  the pipeline's output folder, read-only (PDF, TIFF, PNG, JPEG, WebP, JSON, TXT)
        /output/_list.json  the delivered files and batch folders, used by the page's chooser and batch view
Binds to 127.0.0.1 only: nothing is reachable from other machines.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import threading
import urllib.parse
import webbrowser
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
IMAGES = {".pdf", ".tif", ".tiff", ".png", ".jpg", ".jpeg", ".webp"}
SERVED = IMAGES | {".json", ".jsonl", ".txt", ".md", ".csv"}


def default_output() -> Path:
    """This tool lives inside the pipeline's project folder (Upscaled\\Print Quality Auditor), so the pipeline
    root is simply this folder's parent."""
    env = HERE.parent / ".env"
    try:
        for line in env.read_text(encoding="utf-8").splitlines():
            m = re.match(r"\s*UPSCALE_OUTPUT_DIR\s*=\s*(.+?)\s*$", line)
            if m:
                return Path(m.group(1).strip().strip('"').strip("'"))
    except OSError:
        pass
    return HERE.parent / "output"


INPUT_EXT = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp"}


def env_paths() -> dict:
    root = HERE.parent
    keys = {}
    try:
        for line in (root / ".env").read_text(encoding="utf-8").splitlines():
            m = re.match(r"\s*(UPSCALE_(?:INPUT|OUTPUT|WORK)_DIR)\s*=\s*(.+?)\s*$", line)
            if m:
                keys[m.group(1)] = Path(m.group(2).strip().strip('"').strip("'"))
    except OSError:
        pass
    return {"root": root, "input": keys.get("UPSCALE_INPUT_DIR", root / "input"),
            "output": keys.get("UPSCALE_OUTPUT_DIR", root / "output"), "work": keys.get("UPSCALE_WORK_DIR", root / "work"),
            "draft": root / "draft"}


def read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def workflow(out: Path) -> dict:
    """The state of the whole print job, read from the folders: draft, input, batches, deliveries, audits, disk."""
    import shutil
    import time
    p = env_paths()
    now = time.time()
    delivered: dict[str, dict] = {}
    folders_out = [out] + (sorted(d for d in out.iterdir() if d.is_dir()) if out.is_dir() else [])
    for d in folders_out:
        for r in d.glob("*_report.json"):
            j = read_json(r)
            if not j or j.get("status") not in ("ok", "skipped") or not j.get("final_path"):
                continue
            final = Path(j["final_path"])
            if not final.exists():
                # the path is stored as the pipeline saw it: relative to its own folder, or from before a project move
                final = d / final.name
            # print deliveries only: 1.2+ reports carry a delivery record; the 1.0 run's PNG reports do not
            if not final.exists() or not j.get("delivery") or final.suffix.lower() not in (".pdf", ".tif", ".tiff"):
                continue
            src = Path(str(j.get("source", ""))).name
            pdf = final if final.suffix.lower() == ".pdf" else final.with_suffix(".pdf")
            delivered[src] = {"final": final.name, "folder": d.name, "pdf": pdf.exists()}
    draft_files = [f for f in p["draft"].iterdir() if f.is_file() and not f.name.startswith("_")] if p["draft"].is_dir() else []
    preview = p["draft"] / "_job_preview.txt"
    prev_txt = preview.read_text(encoding="utf-8", errors="replace") if preview.exists() else ""
    ready = re.search(r"ready at no cost:\s+(\d+)", prev_txt)
    paid = re.search(r"ready but paid:\s+(\d+)", prev_txt)
    input_files = sorted(f for f in p["input"].iterdir() if f.is_file() and f.suffix.lower() in INPUT_EXT) if p["input"].is_dir() else []
    in_delivered = [f for f in input_files if f.name in delivered]
    remaining = [f.name for f in input_files if f.name not in delivered]
    batches = []
    for d in folders_out:
        st = read_json(d / "batch_status.json") or {}
        updated = None
        try:
            updated = datetime.fromisoformat(st["updated_utc"]).timestamp() if st.get("updated_utc") else None
        except ValueError:
            updated = None
        age = (now - updated) if updated else None
        pdfs = [f for f in d.glob("*.pdf")]
        tifs = [f for f in d.glob("*.tif")] + [f for f in d.glob("*.tiff")]
        no_pdf = [t.name for t in tifs if not t.with_suffix(".pdf").exists()]
        reports = list(d.glob("*_report.json"))
        key = re.sub(r"^print_", "", d.name) if d != out else "output"
        audit = HERE / f"{key}_audit.md"
        batches.append({
            "name": d.name if d != out else out.name + " (root)", "path": "" if d == out else d.name,
            "status": {k: st.get(k) for k in ("done", "total", "ok", "skipped", "failed", "critical", "caveats", "est_cost_usd", "updated_utc", "print_fix", "started_utc")} if st else None,
            "running": bool(st) and st.get("done", 0) < st.get("total", 0) and age is not None and age < 300,
            "stalled": bool(st) and st.get("done", 0) < st.get("total", 0) and age is not None and age < 300 and bool(remaining),
            "age_s": round(age) if age is not None else None,
            "pdf": len(pdfs), "tif": len(tifs), "tif_without_pdf": len(no_pdf), "reports": len(reports),
            "bytes": sum(f.stat().st_size for f in pdfs + tifs),
            "audit_report": audit.name if audit.exists() else None,
        })
    free = shutil.disk_usage(str(out)).free if out.exists() else 0
    tif_without_pdf = sum(b["tif_without_pdf"] for b in batches)
    running = [b["name"] for b in batches if b["running"]]
    complete = bool(input_files) and not remaining and tif_without_pdf == 0 and not running and not draft_files
    return {
        "checked": datetime.now().strftime("%H:%M:%S"),
        "paths": {k: str(v) for k, v in p.items()},
        "draft": {"files": len(draft_files), "preview": preview.name if preview.exists() else None,
                  "ready_free": int(ready.group(1)) if ready else None, "ready_paid": int(paid.group(1)) if paid else None,
                  "preview_age_s": round(now - preview.stat().st_mtime) if preview.exists() else None},
        "input": {"images": len(input_files), "delivered": len(in_delivered), "remaining": len(remaining),
                  "delivered_pdf": sum(1 for f in in_delivered if delivered[f.name]["pdf"]), "next": remaining[:5]},
        "batches": batches,
        "deliveries": {"pdf": sum(b["pdf"] for b in batches), "tif": sum(b["tif"] for b in batches), "tif_without_pdf": tif_without_pdf,
                       "bytes": sum(b["bytes"] for b in batches), "sources_delivered": len(delivered)},
        "disk": {"free_bytes": free, "need_bytes": len(remaining) * (30e6 + 55e6) + tif_without_pdf * 30e6},
        "running": running, "complete": complete,
    }


def listing(out: Path) -> dict:
    folders = []
    for d in [out] + sorted(p for p in out.iterdir() if p.is_dir()) if out.is_dir() else []:
        files = [{"name": p.name, "size": p.stat().st_size, "mtime": int(p.stat().st_mtime)}
                 for p in sorted(p for p in d.iterdir() if p.is_file() and p.suffix.lower() in IMAGES)]
        status = d / "batch_status.json"
        folders.append({"name": d.name if d != out else out.name, "path": "" if d == out else d.name, "files": files,
                        "status": status.is_file(),
                        "status_updated": datetime.fromtimestamp(status.stat().st_mtime).strftime("%H:%M:%S") if status.is_file() else None})
    return {"output": str(out), "folders": folders}


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".tif": "image/tiff", ".tiff": "image/tiff",
                      ".pdf": "application/pdf", ".webp": "image/webp", ".json": "application/json", ".jsonl": "application/json", ".js": "text/javascript"}
    output: Path = HERE

    def _parts(self):
        return [p for p in urllib.parse.unquote(urllib.parse.urlsplit(self.path).path).split("/") if p]

    def translate_path(self, path):
        parts = self._parts()
        if parts and parts[0] == "output":
            base, rel = self.output.resolve(), parts[1:]
        else:
            base, rel = HERE.resolve(), parts
        target = base.joinpath(*rel).resolve()
        if target != base and base not in target.parents:
            return str(base / "__outside__")
        if base == self.output.resolve() and target.is_file() and target.suffix.lower() not in SERVED:
            return str(base / "__not_served__")
        return str(target)

    def list_directory(self, path):
        self.send_error(404)
        return None

    def do_GET(self):
        parts = self._parts()
        if not parts:
            self.send_response(302)
            self.send_header("Location", "/index.html")
            self.end_headers()
            return
        if parts in (["output", "_list.json"], ["workflow.json"]):
            try:
                data = listing(self.output) if parts[0] == "output" else workflow(self.output)
            except Exception as exc:  # noqa: BLE001 - a folder problem must show on the page, not kill the server
                data = {"error": f"{type(exc).__name__}: {exc}"}
            body = json.dumps(data).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def handle(self):
        try:
            super().handle()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass                                     # the browser cancelled a download; nothing to report

    def log_message(self, fmt, *args):
        if "404" in str(args) or "500" in str(args):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Serve the Print Quality Auditor locally.")
    ap.add_argument("--port", type=int, default=8792)
    ap.add_argument("--output", default=None, help="the pipeline's output folder")
    ap.add_argument("--no-browser", action="store_true")
    a = ap.parse_args(argv)
    Handler.output = Path(a.output) if a.output else default_output()
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    except OSError as exc:
        print(f"Could not listen on port {a.port}: {exc}. Try --port 8800.")
        return 2
    url = f"http://127.0.0.1:{a.port}/"
    print(f"Print Quality Auditor: {url}\noutput folder: {Handler.output}\nPress Ctrl+C to stop.")
    if not a.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
