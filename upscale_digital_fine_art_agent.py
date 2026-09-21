#!/usr/bin/env python3
"""Upscale Digital Fine Art workflow entrypoint.

This script executes the print-focused upscaling pipeline for a single source artwork,
enforcing the 300 DPI target matrix and returning a JSON result payload.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
UPSCALED_ROOT = ROOT / "upscaled"
UPSCALED_ENV = UPSCALED_ROOT / ".env"

UPSCALE_TARGET_MATRIX = {
    "2A0": {"mm": (1189, 1682), "portrait_px": (14043, 19866), "landscape_px": (19866, 14043)},
    "A0": {"mm": (841, 1189), "portrait_px": (9933, 14043), "landscape_px": (14043, 9933)},
    "A1": {"mm": (594, 841), "portrait_px": (7016, 9933), "landscape_px": (9933, 7016)},
    "A2": {"mm": (420, 594), "portrait_px": (4961, 7016), "landscape_px": (7016, 4961)},
    "A3": {"mm": (297, 420), "portrait_px": (3508, 4961), "landscape_px": (4961, 3508)},
    "A4": {"mm": (210, 297), "portrait_px": (2480, 3508), "landscape_px": (3508, 2480)},
    "1:1 MAX": {"mm": (1500, 1500), "portrait_px": (17717, 17717), "landscape_px": (17717, 17717)},
}
UPSCALE_TARGET_FORMATS = tuple(UPSCALE_TARGET_MATRIX.keys())
UPSCALE_ORIENTATIONS = {"auto", "portrait", "landscape", "square"}
UPSCALE_ASPECT_MODES = {"preserve", "crop", "extend", "full_bleed"}


def _coerce_target_format(value: str) -> str:
    raw = str(value or "2A0").strip().upper().replace(" ", "")
    aliases = {
        "2A0": "2A0",
        "A0": "A0",
        "A1": "A1",
        "A2": "A2",
        "A3": "A3",
        "A4": "A4",
        "1:1": "1:1 MAX",
        "1X1": "1:1 MAX",
        "1:1MAX": "1:1 MAX",
        "SQUARE": "1:1 MAX",
        "1_1_MAX": "1:1 MAX",
    }
    normalized = aliases.get(raw)
    if normalized not in UPSCALE_TARGET_MATRIX:
        raise ValueError(f"target_format must be one of: {', '.join(UPSCALE_TARGET_FORMATS)}.")
    return normalized


def _coerce_orientation(value: str) -> str:
    normalized = str(value or "auto").strip().lower().replace("-", "_")
    if normalized not in UPSCALE_ORIENTATIONS:
        raise ValueError("orientation must be auto, portrait, landscape, or square.")
    return normalized


def _coerce_aspect_mode(value: str) -> str:
    normalized = str(value or "preserve").strip().lower().replace("-", "_")
    aliases = {"fullbleed": "full_bleed"}
    normalized = aliases.get(normalized, normalized)
    if normalized not in UPSCALE_ASPECT_MODES:
        raise ValueError("aspect_mode must be preserve, crop, extend, or full_bleed.")
    return normalized


def _read_env_value(name: str) -> str:
    direct = os.environ.get(name, "").strip()
    if direct:
        return direct
    if not UPSCALED_ENV.is_file():
        return ""
    try:
        for line in UPSCALED_ENV.read_text(encoding="utf-8").splitlines():
            raw = line.strip()
            if not raw or raw.startswith("#") or "=" not in raw:
                continue
            key, value = raw.split("=", 1)
            if key.strip() != name:
                continue
            cleaned = value.strip().strip('"').strip("'")
            if " #" in cleaned:
                cleaned = cleaned.split(" #", 1)[0].rstrip()
            return cleaned
    except OSError:
        return ""
    return ""


def _resolve_output_dir() -> Path:
    configured = _read_env_value("UPSCALE_OUTPUT_DIR")
    if configured:
        path = Path(configured)
        return path if path.is_absolute() else UPSCALED_ROOT / path
    return UPSCALED_ROOT / "output"


def _resolve_work_dir(run_id: str) -> Path:
    configured = _read_env_value("UPSCALE_WORK_DIR")
    if configured:
        base = Path(configured)
        if not base.is_absolute():
            base = UPSCALED_ROOT / base
    else:
        base = UPSCALED_ROOT / "work"
    return base / f"dashboard_{run_id}"


def _resolve_python() -> Path:
    preferred = UPSCALED_ROOT / ".venv" / "Scripts" / "python.exe"
    if preferred.is_file():
        return preferred
    return Path(sys.executable)


def _guess_source_orientation(source: Path) -> str:
    try:
        from PIL import Image

        with Image.open(source) as image:
            width, height = image.size
    except Exception:
        return "portrait"
    if width == height:
        return "square"
    return "landscape" if width > height else "portrait"


def _resolve_orientation(source: Path, requested: str, target_format: str) -> str:
    if requested != "auto":
        if requested == "square" and target_format != "1:1 MAX":
            raise ValueError("orientation=square is only supported with target_format=1:1 MAX.")
        return requested
    if target_format == "1:1 MAX":
        return "square"
    guessed = _guess_source_orientation(source)
    return guessed if guessed in {"portrait", "landscape"} else "portrait"


def _target_profile(target_format: str, orientation: str) -> tuple[tuple[int, int], str]:
    spec = UPSCALE_TARGET_MATRIX[target_format]
    mm_w, mm_h = spec["mm"]
    short_mm, long_mm = (min(mm_w, mm_h), max(mm_w, mm_h))

    if orientation == "landscape":
        px_w, px_h = spec["landscape_px"]
        print_size = f"{long_mm / 10:.1f}x{short_mm / 10:.1f}cm"
    elif orientation == "square":
        px_w, px_h = spec["portrait_px"]
        edge_cm = short_mm / 10
        print_size = f"{edge_cm:.1f}x{edge_cm:.1f}cm"
    else:
        px_w, px_h = spec["portrait_px"]
        print_size = f"{short_mm / 10:.1f}x{long_mm / 10:.1f}cm"

    return (int(px_w), int(px_h)), print_size


def _fit_and_bleed(aspect_mode: str) -> tuple[str, float]:
    if aspect_mode == "crop":
        return "crop", 0.0
    if aspect_mode == "extend":
        return "pad", 0.0
    if aspect_mode == "full_bleed":
        return "crop", 3.0
    return "none", 0.0


def _load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _convert_tiff_to_png(python_exe: Path, tiff_path: Path, png_path: Path) -> tuple[bool, str]:
    if not tiff_path.is_file():
        return False, "TIFF output was not generated."
    if png_path.is_file():
        return True, ""

    code = (
        "from PIL import Image;"
        "import sys;"
        "im = Image.open(sys.argv[1]);"
        "im.save(sys.argv[2], format='PNG')"
    )
    process = subprocess.run(
        [str(python_exe), "-c", code, str(tiff_path), str(png_path)],
        cwd=str(ROOT),
        env=os.environ.copy(),
        capture_output=True,
        text=True,
    )
    if process.returncode != 0:
        detail = (process.stderr or process.stdout or "PNG conversion failed.").strip()
        return False, detail
    return True, ""


def run_upscale(
    source: Path,
    target_format: str,
    orientation: str,
    aspect_mode: str,
    target_dpi: int,
    label: str,
    run_id: str,
) -> dict:
    if not source.is_file():
        raise FileNotFoundError(f"Source artwork not found: {source}")

    resolved_orientation = _resolve_orientation(source, orientation, target_format)
    target_px, print_size = _target_profile(target_format, resolved_orientation)
    fit_mode, bleed_mm = _fit_and_bleed(aspect_mode)

    output_dir = _resolve_output_dir()
    work_dir = _resolve_work_dir(run_id)
    output_dir.mkdir(parents=True, exist_ok=True)
    work_dir.mkdir(parents=True, exist_ok=True)

    python_exe = _resolve_python()
    pipeline = UPSCALED_ROOT / "upscale_pipeline.py"
    if not pipeline.is_file():
        raise FileNotFoundError(f"Upscale pipeline entrypoint not found: {pipeline}")

    long_edge = max(target_px)
    command = [
        str(python_exe),
        str(pipeline),
        str(source),
        "--out",
        str(output_dir),
        "--work",
        str(work_dir),
        "--target",
        str(long_edge),
        "--preset",
        "printshop",
        "--format",
        "tiff",
        "--print-size",
        print_size,
        "--print-ppi",
        str(target_dpi),
        "--fit",
        fit_mode,
        "--print-fix",
        "--print-fix-substrate",
        "canvas",
        "--print-quality-policy",
        "warn",
    ]
    if bleed_mm > 0:
        command.extend(["--bleed-mm", f"{bleed_mm:.1f}"])

    process = subprocess.run(
        command,
        cwd=str(ROOT),
        env=os.environ.copy(),
        capture_output=True,
        text=True,
    )

    report_path = output_dir / f"{source.stem}_report.json"
    report = _load_json(report_path) if report_path.is_file() else None

    batch_status_path = output_dir / "batch_status.json"
    batch_status = _load_json(batch_status_path) if batch_status_path.is_file() else None

    image_row = None
    if isinstance(batch_status, dict) and isinstance(batch_status.get("images"), list):
        for row in batch_status["images"]:
            if isinstance(row, dict) and row.get("name") == source.name:
                image_row = row
                break
        if image_row is None and batch_status["images"]:
            first = batch_status["images"][0]
            if isinstance(first, dict):
                image_row = first

    final_name = str((image_row or {}).get("final") or "").strip()
    final_tiff = output_dir / final_name if final_name else None
    png_path = final_tiff.with_suffix(".png") if final_tiff else None

    png_created = False
    png_error = ""
    if final_tiff and png_path:
        png_created, png_error = _convert_tiff_to_png(python_exe, final_tiff, png_path)

    errors: list[str] = []
    if process.returncode != 0:
        detail = (process.stderr or process.stdout or "Upscale pipeline exited with a non-zero code.").strip()
        errors.append(detail)
    if isinstance(report, dict) and report.get("status") == "failed" and report.get("error"):
        errors.append(str(report.get("error")))
    if image_row and image_row.get("status") == "failed" and image_row.get("error"):
        errors.append(str(image_row.get("error")))
    if png_error:
        errors.append(f"PNG generation failed: {png_error}")

    # Deduplicate while preserving order.
    deduped_errors = []
    seen = set()
    for item in errors:
        key = item.strip()
        if not key or key in seen:
            continue
        deduped_errors.append(key)
        seen.add(key)

    status = "failed" if deduped_errors else "completed"

    return {
        "status": status,
        "workflow": "upscale_digital_fine_art",
        "label": label,
        "run_id": run_id,
        "source": str(source),
        "target_format": target_format,
        "orientation": resolved_orientation,
        "aspect_mode": aspect_mode,
        "target_dpi": target_dpi,
        "target_dimensions_px": {
            "width": target_px[0],
            "height": target_px[1],
        },
        "print_size_cm": print_size.replace("cm", ""),
        "master_output": {
            "tiff": str(final_tiff) if final_tiff and final_tiff.is_file() else None,
            "png": str(png_path) if png_created and png_path and png_path.is_file() else None,
            "report": str(report_path) if report_path.is_file() else None,
            "batch_status": str(batch_status_path) if batch_status_path.is_file() else None,
        },
        "print_quality": (image_row or {}).get("print_quality") if isinstance(image_row, dict) else None,
        "quality_flags": (image_row or {}).get("quality_flags") if isinstance(image_row, dict) else [],
        "pipeline": {
            "command": command,
            "returncode": process.returncode,
            "stdout_tail": "\n".join((process.stdout or "").splitlines()[-20:]),
            "stderr_tail": "\n".join((process.stderr or "").splitlines()[-20:]),
        },
        "errors": deduped_errors,
        "completed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Upscale Digital Fine Art workflow runner")
    parser.add_argument("--source", required=True, help="Path to the source artwork")
    parser.add_argument("--target-format", default="2A0", help="Print target format (2A0, A0, A1, A2, A3, A4, 1:1 MAX)")
    parser.add_argument("--orientation", default="auto", help="auto, portrait, landscape, square")
    parser.add_argument("--aspect-mode", default="preserve", help="preserve, crop, extend, full_bleed")
    parser.add_argument("--target-dpi", type=int, default=300, help="Target print DPI (must be 300)")
    parser.add_argument("--label", default="", help="Optional delivery label")
    parser.add_argument("--run-id", default="", help="Optional dashboard run id")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        target_dpi = int(args.target_dpi)
        if target_dpi != 300:
            raise ValueError("target_dpi must be exactly 300 for Upscale Digital Fine Art.")

        target_format = _coerce_target_format(args.target_format)
        orientation = _coerce_orientation(args.orientation)
        aspect_mode = _coerce_aspect_mode(args.aspect_mode)

        source = Path(args.source).expanduser()
        if not source.is_absolute():
            source = (Path.cwd() / source).resolve()

        run_id = str(args.run_id or "").strip() or f"upscale-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
        label = str(args.label or "").strip()

        result = run_upscale(
            source=source,
            target_format=target_format,
            orientation=orientation,
            aspect_mode=aspect_mode,
            target_dpi=target_dpi,
            label=label,
            run_id=run_id,
        )
    except Exception as exc:  # noqa: BLE001
        result = {
            "status": "failed",
            "workflow": "upscale_digital_fine_art",
            "errors": [str(exc)],
            "completed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }

    print(json.dumps(result, indent=2))
    return 1 if result.get("status") == "failed" else 0


if __name__ == "__main__":
    raise SystemExit(main())
