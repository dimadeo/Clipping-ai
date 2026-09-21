import argparse
import json
from pathlib import Path
from typing import Any, Dict, Optional

from midjourney import MidjourneyClient


def _extract_job_id(payload: Dict[str, Any]) -> Optional[str]:
    for key in ("id", "task_id", "taskId", "job_id", "jobId"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()

    data = payload.get("data")
    if isinstance(data, dict):
        for key in ("id", "task_id", "taskId", "job_id", "jobId"):
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return None


def _extract_poll_target(payload: Dict[str, Any]) -> Optional[str]:
    for key in ("polling_url", "pollingUrl", "url"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return _extract_job_id(payload)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate a Runway text-to-image job using the shared MidjourneyClient adapter."
    )
    parser.add_argument("--prompt", required=True, help="Text prompt for image generation.")
    parser.add_argument(
        "--endpoint",
        default="https://api.dev.runwayml.com/v1/text_to_image",
        help="Runway generation endpoint. Defaults to text_to_image.",
    )
    parser.add_argument(
        "--ratio",
        default="9:16",
        help="Image ratio for Runway (for example 9:16, 1:1, 16:9).",
    )
    parser.add_argument(
        "--model",
        default=None,
        help="Optional Runway model name. Falls back to RUNWAY_MODEL when omitted.",
    )
    parser.add_argument(
        "--reference-image",
        default=None,
        help="Optional image URI for image-to-image style prompts.",
    )
    parser.add_argument(
        "--idempotency-key",
        default=None,
        help="Optional idempotency key to safely retry requests.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=90,
        help="Request timeout in seconds.",
    )
    parser.add_argument(
        "--wait",
        action="store_true",
        help="Poll the task until completion when the API returns a job/task handle.",
    )
    parser.add_argument(
        "--poll-interval",
        type=float,
        default=3.0,
        help="Seconds between poll attempts when --wait is used.",
    )
    parser.add_argument(
        "--max-attempts",
        type=int,
        default=40,
        help="Maximum polling attempts when --wait is used.",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Optional file path to save the JSON result.",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    client = MidjourneyClient(provider="runway", endpoint=args.endpoint, timeout=args.timeout)
    request_kwargs: Dict[str, Any] = {
        "aspect_ratio": args.ratio,
    }

    if args.model:
        request_kwargs["model"] = args.model
    if args.reference_image:
        request_kwargs["image_uri"] = args.reference_image
    if args.idempotency_key:
        request_kwargs["idempotency_key"] = args.idempotency_key

    try:
        initial = client.generate(prompt=args.prompt, **request_kwargs)
    except Exception as exc:  # pragma: no cover - simple CLI error path
        print(f"Runway request failed: {exc}")
        return 1

    result: Dict[str, Any] = {
        "provider": "runway",
        "endpoint": args.endpoint,
        "initial": initial,
    }

    if args.wait:
        poll_target = _extract_poll_target(initial)
        if poll_target:
            try:
                result["final"] = client.wait_for_completion(
                    poll_target,
                    poll_interval=max(0.0, args.poll_interval),
                    max_attempts=max(1, args.max_attempts),
                )
            except Exception as exc:  # pragma: no cover - simple CLI error path
                result["poll_error"] = str(exc)
        else:
            result["poll_warning"] = "No polling target found in initial response."

    output = json.dumps(result, indent=2, ensure_ascii=True)
    print(output)

    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(output, encoding="utf-8")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
