import argparse
import json
import os
from pathlib import Path
from typing import Any, Dict, List

from runwayml import RunwayML, TaskFailedError


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate an image with the official Runway Python SDK."
    )
    parser.add_argument("--prompt", required=True, help="Text prompt for image generation.")
    parser.add_argument(
        "--model",
        default="gen4_image",
        help="Runway model identifier (default: gen4_image).",
    )
    parser.add_argument(
        "--ratio",
        default="1920:1080",
        help="Model-specific ratio value (default: 1920:1080).",
    )
    parser.add_argument(
        "--reference-image",
        action="append",
        default=[],
        help=(
            "Optional reference image in the form URI or URI=TAG. "
            "Pass multiple times for multiple references."
        ),
    )
    parser.add_argument(
        "--no-wait",
        action="store_true",
        help="Return immediately after task creation instead of waiting for completion.",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Optional file path to save JSON output.",
    )
    return parser


def parse_reference_images(values: List[str]) -> List[Dict[str, str]]:
    references: List[Dict[str, str]] = []
    for raw in values:
        value = raw.strip()
        if not value:
            continue

        # Support URI=tag format while allowing plain URIs.
        if "=" in value:
            uri, tag = value.split("=", 1)
            uri = uri.strip()
            tag = tag.strip()
            if uri and tag:
                references.append({"uri": uri, "tag": tag})
                continue

        references.append({"uri": value})

    return references


def save_output(path: str, payload: Dict[str, Any]) -> None:
    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if not os.getenv("RUNWAYML_API_SECRET"):
        print("RUNWAYML_API_SECRET is not set.")
        print("Set it in PowerShell: $env:RUNWAYML_API_SECRET = \"<your_api_secret>\"")
        return 2

    client = RunwayML()
    reference_images = parse_reference_images(args.reference_image)
    create_payload: Dict[str, Any] = {
        "model": args.model,
        "prompt_text": args.prompt,
        "ratio": args.ratio,
    }
    if reference_images:
        create_payload["reference_images"] = reference_images

    try:
        task = client.text_to_image.create(**create_payload)
    except Exception as exc:
        print(f"Runway task creation failed: {exc}")
        return 1

    result: Dict[str, Any] = {
        "provider": "runway",
        "transport": "runwayml-python-sdk",
        "task_id": getattr(task, "id", None),
        "request": create_payload,
    }

    if args.no_wait:
        print(json.dumps(result, indent=2, ensure_ascii=True))
        if args.output:
            save_output(args.output, result)
        return 0

    try:
        completed = task.wait_for_task_output()
        result["status"] = getattr(completed, "status", "SUCCEEDED")
        result["output"] = getattr(completed, "output", None)
        result["task"] = completed.dict() if hasattr(completed, "dict") else str(completed)
    except TaskFailedError as exc:
        details = getattr(exc, "task_details", None)
        result["status"] = "FAILED"
        result["failure"] = details if details is not None else str(exc)
        print(json.dumps(result, indent=2, ensure_ascii=True))
        if args.output:
            save_output(args.output, result)
        return 1
    except Exception as exc:
        result["status"] = "ERROR"
        result["failure"] = str(exc)
        print(json.dumps(result, indent=2, ensure_ascii=True))
        if args.output:
            save_output(args.output, result)
        return 1

    print(json.dumps(result, indent=2, ensure_ascii=True))
    if args.output:
        save_output(args.output, result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())