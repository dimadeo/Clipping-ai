#!/usr/bin/env python3
"""prepare_job.py -- check the draft folder before a job starts, then move the ready images into input.

  python prepare_job.py                            check draft: ready or not and why, API calls, cost, time, disk
  python prepare_job.py --start                    move the ready images that cost nothing into input
  python prepare_job.py --start --allow-cost       also move ready images that need paid API passes
  python prepare_job.py --start --include-printed  also move images that were already printed

Print settings come from .env and the numbers from the pipeline's own planner (--plan), so they match a real run.
"""
from __future__ import annotations

import argparse
import contextlib
import csv
import hashlib
import io
import json
import logging
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import upscale_pipeline as up  # noqa: E402
from PIL import Image, ImageOps  # noqa: E402

Image.MAX_IMAGE_PIXELS = None
PS1 = r".\prepare_job.ps1"
ROW = re.compile(r"(\d+x\d+)\s+(\d+x\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+([\d.]+)")
PPI = re.compile(r"sheet @ ([\d.]+) PPI")
SEC_PER_MP, SEC_PER_API_CALL = 0.4, 20            # rough, from batch 01 (local finishing, 150 PPI)
TIFF_BYTES_PER_PX, WORK_BYTES_PER_PX = 2.8, 1.2   # rough, measured on real 5K results


def image_files(folder: Path) -> list[Path]:
    if not folder.is_dir():
        return []
    return sorted(p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in up.SUPPORTED_INPUT_EXT)


def pixel_hash(path: Path) -> tuple[str, int]:
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        return hashlib.sha256(im.tobytes()).hexdigest(), im.width * im.height


def input_pixel_hashes(input_dir: Path, cache_file: Path) -> dict[str, str]:
    """Pixel hash -> file name for every image in input, cached by name, size and modification time."""
    try:
        cache = json.loads(cache_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        cache = {}
    fresh, by_hash, todo = {}, {}, []
    for p in image_files(input_dir):
        st = p.stat()
        key = f"{p.name}|{st.st_size}|{st.st_mtime_ns}"
        if key in cache:
            fresh[key] = cache[key]
            by_hash.setdefault(cache[key], p.name)
        else:
            todo.append((key, p))
    if todo:
        print(f"Reading {len(todo)} image(s) in input once, to recognise identical pictures. "
              "This is cached for next time.", flush=True)
    for n, (key, p) in enumerate(todo, 1):
        try:
            h, _ = pixel_hash(p)
        except Exception:  # noqa: BLE001 - an unreadable input file simply cannot match
            continue
        fresh[key] = h
        by_hash.setdefault(h, p.name)
        if n % 25 == 0:
            print(f"  {n}/{len(todo)}", flush=True)
    try:
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        cache_file.write_text(json.dumps(fresh), encoding="utf-8")
    except OSError:
        pass
    return by_hash


def printed_index(output_dir: Path) -> dict[str, Path]:
    """Original image name -> print file, from finished print-shop reports. 1.0 PNG reports do not count."""
    idx: dict[str, Path] = {}
    if not output_dir.is_dir():
        return idx
    for r in output_dir.rglob("*_report.json"):
        try:
            d = json.loads(r.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        final = Path(str(d.get("final_path") or ""))
        if d.get("status") in ("ok", "skipped") and final.suffix.lower() in (".tif", ".tiff") and final.exists():
            idx.setdefault(up._display_stem(Path(str(d.get("source", "")))), final)
    return idx


def plan_one(path: Path, min_api_scale: float) -> dict:
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = up.main(["--plan", "--min-api-scale", str(min_api_scale), str(path)])
    text = buf.getvalue()
    if rc != 0:
        return {"error": "the planner rejected the settings in .env"}
    if "UNREACHABLE" in text:
        return {"error": "too small to reach the print size within the pass limit"}
    row = next((m for m in (ROW.search(line) for line in text.splitlines()) if m), None)
    if not row:
        return {"error": "the planner could not read this image"}
    w, h = map(int, row.group(2).split("x"))
    m = PPI.search(text)
    return {"w": w, "h": h, "calls": int(row.group(5)), "cost": float(row.group(6)),
            "ppi": float(m.group(1)) if m else None}


def check(a) -> tuple[list[dict], list[str]]:
    draft, inp = Path(a.draft), Path(a.input)
    entries = [{"file": p.name, "path": p, "reason": ""} for p in sorted(draft.iterdir())
               if p.is_file() and not p.name.startswith("_")]
    folders = [p.name for p in draft.iterdir() if p.is_dir()]
    for e in entries:
        p = e["path"]
        if p.suffix.lower() not in up.SUPPORTED_INPUT_EXT:
            e["reason"] = f"{p.suffix.lower() or 'a file without an extension'} is not a supported image type"
        elif len(up._RESULT_TAG.findall(p.stem)) >= 2:
            e["reason"] = "a 5K result upscaled a second time; its parent result has the same pixels"
        else:
            try:
                e["hash"], e["px"] = pixel_hash(p)
            except Exception:  # noqa: BLE001
                e["reason"] = "cannot be opened as an image"
    in_names = {up._display_stem(p): p.name for p in image_files(inp)}
    printed = printed_index(Path(a.output))
    for e in [e for e in entries if not e["reason"]]:
        e["stem"] = up._display_stem(e["path"])
        if e["stem"] in in_names:
            e["reason"] = f"already in input as {in_names[e['stem']]}"
        elif e["stem"] in printed and not a.include_printed:
            e["reason"] = f"already printed as {printed[e['stem']].name}"
    by_stem: dict[str, list[dict]] = {}
    for e in [e for e in entries if not e["reason"]]:
        by_stem.setdefault(e["stem"], []).append(e)
    for group in by_stem.values():
        group.sort(key=lambda e: (-e["px"], e["file"]))
        for other in group[1:]:
            other["reason"] = f"a larger version of the same image is in draft: {group[0]['file']}"
    remaining = sorted([e for e in entries if not e["reason"]], key=lambda e: (-e["px"], e["file"]))
    if remaining:
        in_hashes = input_pixel_hashes(inp, Path(a.work) / "_prepare_job_cache.json")
        seen: dict[str, str] = {}
        for e in remaining:
            if e["hash"] in in_hashes:
                e["reason"] = f"same picture as {in_hashes[e['hash']]} in input"
            elif e["hash"] in seen:
                e["reason"] = f"same picture as {seen[e['hash']]} in draft"
            else:
                seen[e["hash"]] = e["file"]
    for e in [e for e in entries if not e["reason"]]:
        e.update(plan_one(e["path"], a.min_api_scale))
        if "error" in e:
            e["reason"] = e.pop("error")
    return entries, folders


def summary(entries: list[dict], folders: list[str], a) -> tuple[list[str], list[dict], list[dict]]:
    free = [e for e in entries if not e["reason"] and e["calls"] == 0]
    paid = [e for e in entries if not e["reason"] and e["calls"] > 0]
    blocked = [e for e in entries if e["reason"]]
    lines = [f"Draft folder: {a.draft}",
             f"Checked {datetime.now():%Y-%m-%d %H:%M} with the print settings in .env, "
             f"local finishing below x{a.min_api_scale:g}", ""]

    def size(e: dict) -> str:
        if e.get("ppi"):
            return f"prints {round(e['w'] / e['ppi'] * 2.54)}x{round(e['h'] / e['ppi'] * 2.54)}cm"
        return f"{e['w']}x{e['h']} px"

    for e in free:
        lines.append(f"  READY          {e['file'][:70]:70s}  {size(e)}, no API calls")
    for e in paid:
        lines.append(f"  READY, PAID    {e['file'][:70]:70s}  {size(e)}, {e['calls']} API calls, ${e['cost']:.3f}")
    for e in blocked:
        lines.append(f"  NOT READY      {e['file'][:70]:70s}  {e['reason']}")

    def est(group: list[dict]) -> str:
        px = sum(e["w"] * e["h"] for e in group)
        minutes = (px / 1e6 * SEC_PER_MP + sum(e["calls"] for e in group) * SEC_PER_API_CALL) / 60
        return f"about {max(1, round(minutes))} min, about {px * (TIFF_BYTES_PER_PX + WORK_BYTES_PER_PX) / 1e9:.1f} GB"

    out = Path(a.output)
    free_gb = shutil.disk_usage(out if out.exists() else ROOT).free / 1e9
    lines += ["", "Summary"]
    lines.append(f"  ready at no cost:  {len(free)} image(s)" + (f", {est(free)}" if free else ""))
    lines.append(f"  ready but paid:    {len(paid)} image(s)"
                 + (f", {sum(e['calls'] for e in paid)} API calls, ${sum(e['cost'] for e in paid):.3f}, {est(paid)}"
                    if paid else ""))
    lines.append(f"  not ready:         {len(blocked)} file(s), they stay in draft")
    if folders:
        lines.append(f"  folders ignored:   {', '.join(folders)}")
    lines.append(f"  free disk space:   {free_gb:.1f} GB")
    return lines, free, paid


def main(argv: list[str] | None = None) -> int:
    up.load_dotenv(ROOT / ".env")
    ap = argparse.ArgumentParser(description="Check the draft folder, then move ready images into input.")
    ap.add_argument("--draft", default=str(ROOT / "draft"))
    ap.add_argument("--input", default=up.env("UPSCALE_INPUT_DIR", str(ROOT / "input")))
    ap.add_argument("--output", default=up.env("UPSCALE_OUTPUT_DIR", str(ROOT / "output")))
    ap.add_argument("--work", default=up.env("UPSCALE_WORK_DIR", str(ROOT / "work")))
    ap.add_argument("--min-api-scale", type=float, default=2.0)
    ap.add_argument("--start", action="store_true", help="move the ready images into input")
    ap.add_argument("--allow-cost", action="store_true", help="with --start: also move images that need paid API passes")
    ap.add_argument("--include-printed", action="store_true", help="also accept images that were already printed")
    a = ap.parse_args(argv)
    logging.disable(logging.CRITICAL)
    draft = Path(a.draft)
    draft.mkdir(parents=True, exist_ok=True)
    if not any(p.is_file() and not p.name.startswith("_") for p in draft.iterdir()):
        print(f"The draft folder is empty: {draft}")
        print(f"Put the images for the next job there, then run {PS1} again.")
        return 0
    entries, folders = check(a)
    lines, free, paid = summary(entries, folders, a)
    (draft / "_job_preview.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    if not a.start:
        print("")
        if free:
            tail = f" Add -AllowCost to include the {len(paid)} paid image(s)." if paid else ""
            print(f"Next: {PS1} -Start moves the {len(free)} no-cost image(s) into input.{tail}")
        elif paid:
            print(f"Only paid images are ready. {PS1} -Start -AllowCost moves the {len(paid)} paid image(s) into input.")
        else:
            print("Nothing is ready to move.")
        return 0
    move = free + (paid if a.allow_cost else [])
    if not move:
        print("\nNothing moved: no ready image" + (" at no cost. Add -AllowCost to move the paid ones." if paid else "."))
        return 0
    inp = Path(a.input)
    log = draft / "_moved_to_input.csv"
    new_log = not log.exists()
    moved = 0
    with open(log, "a", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        if new_log:
            w.writerow(["moved_at", "moved_from", "moved_to"])
        for e in move:
            dst = inp / e["file"]
            if dst.exists():
                print(f"  kept in draft, a file with this name is already in input: {e['file']}")
                continue
            e["path"].rename(dst)
            w.writerow([f"{datetime.now():%Y-%m-%d %H:%M:%S}", str(e["path"]), str(dst)])
            moved += 1
    print(f"\nMoved {moved} image(s) into {inp}. Moves are logged in {log.name}.")
    if paid and not a.allow_cost:
        print(f"{len(paid)} paid image(s) stayed in draft. Add -AllowCost to move them.")
    print("Next: run the batch commands in README.md, section Preparing and running a job.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
