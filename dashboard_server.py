import base64
import json
import mimetypes
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, unquote, urlparse

ROOT = Path(__file__).resolve().parent
STATUS_FILE = ROOT / "dashboard_state.json"
RUN_AUDIT_FILE = ROOT / "dashboard_run_audit.jsonl"
INDEX_FILE = ROOT / "dashboard" / "virtual-office.html"
OFFLINE_READY_FILE = ROOT / "dashboard" / "offline-ready.html"
OFFLINE_RUNTIME_STATUS_FILE = ROOT / "dashboard" / "offline_runtime_status.json"
UPLOAD_DIR = ROOT / "dashboard_uploads"
MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024
MAX_ATTACHMENTS_PER_RUN = 6
RUN_QUEUE = queue.Queue()
STATE_LOCK = threading.Lock()
AUDIT_LOCK = threading.Lock()
WORKFLOW_CAMPAIGN = "fine_art_creation"
WORKFLOW_PRODUCTION = "production"
WORKFLOW_PREPRESS = "prepress"
WORKFLOWS = {
    WORKFLOW_CAMPAIGN,
    WORKFLOW_PRODUCTION,
    WORKFLOW_PREPRESS,
}
API_PREFIX = "/api/v1"
ROUTE_DASHBOARD = "/"
ROUTE_DASHBOARD_INDEX = "/index.html"
ROUTE_OFFLINE_DASHBOARD = "/offline-ready.html"
ROUTE_OFFLINE_ALIAS = "/offline"
ROUTE_ROUTES = f"{API_PREFIX}/routes"
ROUTE_STATUS = f"{API_PREFIX}/status"
ROUTE_OFFLINE_HEALTH = f"{API_PREFIX}/offline-health"
ROUTE_RUNS = f"{API_PREFIX}/runs"
ROUTE_APPROVALS = f"{API_PREFIX}/approvals"
ROUTE_ATTACHMENTS = f"{API_PREFIX}/attachments"
ROUTE_PRINT_ARTIFACTS = f"{API_PREFIX}/artifacts/print"
LEGACY_ROUTE_ROUTES = "/routes"
LEGACY_ROUTE_STATUS = "/status"
LEGACY_ROUTE_OFFLINE_HEALTH = "/offline-health"
LEGACY_ROUTE_RUNS = "/run"
LEGACY_ROUTE_APPROVALS = "/approval"
LEGACY_ROUTE_ATTACHMENTS = "/attachments"
LEGACY_ROUTE_PRINT_ARTIFACTS = "/print-artifact"

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
CREATION_SIZE_FAMILIES = {"a_series", "square_1_1"}
CREATION_A_SERIES_SIZES = {"A4", "A3", "A2", "A1", "A0", "2A0"}
CREATION_SQUARE_SIZES_CM = {30, 50, 80, 100, 120, 150}
CREATION_ORIENTATIONS = {"portrait", "landscape", "vertical"}


def default_state() -> dict:
    return {
        "status": "idle",
        "message": "Dashboard ready",
        "last_run": None,
        "result": {},
        "returncode": None,
        "run_id": None,
        "queue_depth": 0,
        "workflow": WORKFLOW_CAMPAIGN,
        "stages": {},
        "attachments": [],
        "links": [],
        "quality_gate": None,
        "approval_pending": None,
        "metrics": {
            "runs_total": 0,
            "runs_completed": 0,
            "runs_failed": 0,
            "render_retries": 0,
            "last_duration_seconds": None,
        },
    }


def normalize_workflow(value) -> str:
    workflow = str(value or WORKFLOW_CAMPAIGN).strip().lower().replace("-", "_")
    aliases = {
        "default": WORKFLOW_CAMPAIGN,
        "prompt": WORKFLOW_CAMPAIGN,
        "prompts": WORKFLOW_CAMPAIGN,
        "campaign": WORKFLOW_CAMPAIGN,
        "fine_art": WORKFLOW_CAMPAIGN,
        "art": WORKFLOW_CAMPAIGN,
        "upscale": WORKFLOW_PRODUCTION,
        "upscale_digital_fine_art": WORKFLOW_PRODUCTION,
        "pre_press": WORKFLOW_PREPRESS,
    }
    workflow = aliases.get(workflow, workflow)
    if workflow not in WORKFLOWS:
        raise ValueError(f"Workflow must be one of: {', '.join(sorted(WORKFLOWS))}.")
    return workflow


def workflow_stages(workflow: str, status: str, message: str, **details) -> dict:
    updated_utc = datetime.now(timezone.utc).isoformat(timespec="seconds")
    stage = {"status": status, "message": message, "updated_utc": updated_utc}
    stage.update({key: json_safe(value) for key, value in details.items()})
    return {
        "orchestrator": {"status": status, "message": message, "updated_utc": updated_utc},
        workflow: stage,
    }


def route_suffix(path: str, *prefixes: str) -> str | None:
    for prefix in prefixes:
        marker = f"{prefix}/"
        if path.startswith(marker):
            return path[len(marker) :]
    return None


def route_manifest_payload() -> dict:
    return {
        "version": "v1",
        "base_path": API_PREFIX,
        "legacy_alias_policy": "Legacy aliases are kept for compatibility but canonical /api/v1 routes are preferred.",
        "routes": [
            {
                "name": "dashboard",
                "method": "GET",
                "path": ROUTE_DASHBOARD,
                "aliases": [ROUTE_DASHBOARD_INDEX],
                "group": "ui",
                "description": "Serves the main virtual-office dashboard page.",
            },
            {
                "name": "offline_dashboard",
                "method": "GET",
                "path": ROUTE_OFFLINE_DASHBOARD,
                "aliases": [ROUTE_OFFLINE_ALIAS],
                "group": "ui",
                "description": "Serves the offline readiness dashboard page.",
            },
            {
                "name": "routes",
                "method": "GET",
                "path": ROUTE_ROUTES,
                "aliases": [LEGACY_ROUTE_ROUTES],
                "group": "api",
                "description": "Returns the API route manifest and workflow payload contract.",
            },
            {
                "name": "status",
                "method": "GET",
                "path": ROUTE_STATUS,
                "aliases": [LEGACY_ROUTE_STATUS],
                "group": "api",
                "description": "Returns current orchestrator state, review sections, and final result links.",
            },
            {
                "name": "offline_health",
                "method": "GET",
                "path": ROUTE_OFFLINE_HEALTH,
                "aliases": [LEGACY_ROUTE_OFFLINE_HEALTH],
                "group": "api",
                "description": "Returns local offline readiness checks, runtime report, and key file status.",
            },
            {
                "name": "runs",
                "method": "POST",
                "path": ROUTE_RUNS,
                "aliases": [LEGACY_ROUTE_RUNS],
                "group": "api",
                "description": "Queues a fine-art creation, upscale digital fine-art, or prepress workflow run.",
            },
            {
                "name": "approvals",
                "method": "POST",
                "path": ROUTE_APPROVALS,
                "aliases": [LEGACY_ROUTE_APPROVALS],
                "group": "api",
                "description": "Applies an approval decision for workflows that explicitly pause for human review.",
            },
            {
                "name": "attachments",
                "method": "POST",
                "path": ROUTE_ATTACHMENTS,
                "aliases": [LEGACY_ROUTE_ATTACHMENTS],
                "group": "api",
                "description": "Uploads one base64 attachment (max 8 MB) and returns attachment metadata.",
            },
            {
                "name": "attachment_download",
                "method": "GET",
                "path": f"{ROUTE_ATTACHMENTS}/{{id}}",
                "aliases": [f"{LEGACY_ROUTE_ATTACHMENTS}/{{id}}"],
                "group": "api",
                "description": "Fetches a previously uploaded attachment by attachment id.",
            },
            {
                "name": "print_artifacts",
                "method": "GET",
                "path": f"{ROUTE_PRINT_ARTIFACTS}/{{name}}",
                "aliases": [f"{LEGACY_ROUTE_PRINT_ARTIFACTS}/{{name}}"],
                "group": "api",
                "description": "Streams a reviewed print artifact file from the Upscaled output set.",
            },
        ],
        "workflow_values": sorted(WORKFLOWS),
        "upscale_target_formats": list(UPSCALE_TARGET_FORMATS),
        "upscale_orientation_values": sorted(UPSCALE_ORIENTATIONS),
        "upscale_aspect_mode_values": sorted(UPSCALE_ASPECT_MODES),
        "creation_size_families": sorted(CREATION_SIZE_FAMILIES),
        "creation_a_series_sizes": sorted(CREATION_A_SERIES_SIZES),
        "creation_square_sizes_cm": sorted(CREATION_SQUARE_SIZES_CM),
        "creation_orientation_values": sorted(CREATION_ORIENTATIONS),
        "run_contract": {
            "version": "2026-09-21",
            "common": {
                "fields": ["workflow", "attachments", "links", "max_retries", "retry_delay_seconds", "require_approval"],
            },
            "fine_art_creation": {
                "required": ["subject"],
                "optional": [
                    "topic",
                    "ratio",
                    "intended_environment",
                    "prompt_creator_command",
                    "creation_prompt_override",
                    "render",
                    "art_dna_mode",
                    "creative_freedom",
                    "originality_priority",
                    "similarity_tolerance",
                    "commercial_cliche_tolerance",
                    "predictability_tolerance",
                    "artistic_ambition",
                    "creation_size_family",
                    "creation_orientations",
                    "creation_a_series_size",
                    "creation_square_size_cm",
                ],
                "note": "topic is accepted as a compatibility alias for subject.",
            },
            "production": {
                "required": ["target_format"],
                "optional": [
                    "topic",
                    "source_attachment_id",
                    "orientation",
                    "aspect_mode",
                    "target_dpi",
                    "print_quality",
                ],
                "note": "Upscale Digital Fine Art workflow consumes an attached artwork and outputs print-ready masters.",
            },
            "prepress": {
                "required": ["prepress_mode"],
                "optional": ["confirm_external_actions", "quality_gate_override_reason"],
                "quality_gate": "mode=run requires passing print-quality review or an explicit override reason",
            },
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


def json_safe(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [json_safe(item) for item in value]
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        return json_safe(model_dump())
    return str(value)


def shorten(value, limit: int = 280) -> str:
    text = str(value or "").strip()
    return text if len(text) <= limit else f"{text[: limit - 3].rstrip()}..."


def safe_filename(value) -> str:
    name = Path(str(value or "attachment")).name
    name = re.sub(r"[^A-Za-z0-9._ -]", "_", name).strip(". ")
    return name[:120] or "attachment"


def attachment_path(attachment_id: str):
    name = Path(unquote(str(attachment_id or ""))).name
    if not name or name != attachment_id:
        return None
    candidate = (UPLOAD_DIR / name).resolve()
    try:
        candidate.relative_to(UPLOAD_DIR.resolve())
    except ValueError:
        return None
    return candidate if candidate.is_file() else None


def attachment_metadata(path: Path, original_name: str, content_type: str = "") -> dict:
    suffix = path.suffix.lower()
    image_suffixes = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}
    guessed_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    is_image = suffix in image_suffixes
    return {
        "id": path.name,
        "name": safe_filename(original_name),
        "size": path.stat().st_size,
        "content_type": content_type if is_image and content_type.startswith("image/") else guessed_type,
        "kind": "image" if is_image else "file",
        "url": f"{ROUTE_ATTACHMENTS}/{quote(path.name)}",
    }


def save_attachment(payload: dict) -> dict:
    encoded = payload.get("data")
    if not isinstance(encoded, str) or not encoded:
        raise ValueError("Attachment data is required.")
    if encoded.startswith("data:"):
        if "," not in encoded:
            raise ValueError("Attachment data is malformed.")
        encoded = encoded.split(",", 1)[1]
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError) as exc:
        raise ValueError("Attachment data is not valid base64.") from exc
    if not raw:
        raise ValueError("Attachment is empty.")
    if len(raw) > MAX_ATTACHMENT_BYTES:
        raise ValueError("Attachments must be 8 MB or smaller.")

    original_name = safe_filename(payload.get("name"))
    suffix = Path(original_name).suffix.lower()
    safe_suffix = suffix if re.fullmatch(r"\.[A-Za-z0-9]{1,10}", suffix or "") else ".bin"
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    path = UPLOAD_DIR / f"{uuid.uuid4().hex}{safe_suffix}"
    path.write_bytes(raw)
    return attachment_metadata(path, original_name, str(payload.get("content_type") or ""))


def normalize_attachments(value) -> list[dict]:
    normalized = []
    for item in value if isinstance(value, list) else []:
        if not isinstance(item, dict):
            continue
        path = attachment_path(str(item.get("id") or ""))
        if path is None:
            continue
        normalized.append(attachment_metadata(path, str(item.get("name") or path.name), str(item.get("content_type") or "")))
        if len(normalized) >= MAX_ATTACHMENTS_PER_RUN:
            break
    return normalized


def normalize_links(value) -> list[dict]:
    normalized = []
    for item in value if isinstance(value, list) else []:
        raw_url = item.get("url") if isinstance(item, dict) else item
        if not isinstance(raw_url, str):
            continue
        parsed = urlparse(raw_url.strip())
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            continue
        url = parsed.geturl()
        if len(url) > 2048:
            continue
        normalized.append({"url": url, "label": shorten(item.get("label") if isinstance(item, dict) else parsed.netloc, 80)})
        if len(normalized) >= MAX_ATTACHMENTS_PER_RUN:
            break
    return normalized


def coerce_bool(value, field: str, *, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and value in (0, 1):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off", ""}:
            return False
    raise ValueError(f"{field} must be a boolean.")


def coerce_int(value, field: str, *, minimum: int, maximum: int, default: int) -> int:
    raw = default if value is None else value
    try:
        parsed = int(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} must be an integer between {minimum} and {maximum}.") from exc
    if parsed < minimum or parsed > maximum:
        raise ValueError(f"{field} must be between {minimum} and {maximum}.")
    return parsed


def coerce_percentage(value, field: str, *, default: int) -> int:
    return coerce_int(value, field, minimum=0, maximum=100, default=default)


def coerce_text(value, field: str, *, required: bool = False, max_len: int = 200) -> str:
    text = str(value or "").strip()
    if not text:
        if required:
            raise ValueError(f"{field} is required.")
        return ""
    if len(text) > max_len:
        raise ValueError(f"{field} must be {max_len} characters or fewer.")
    return text


def coerce_csv(value, field: str, *, max_items: int, max_item_len: int) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        items = [item.strip() for item in value.split(",")]
    elif isinstance(value, list):
        items = [str(item).strip() for item in value]
    else:
        raise ValueError(f"{field} must be a comma-separated string or an array of strings.")
    items = [item for item in items if item]
    if len(items) > max_items:
        raise ValueError(f"{field} can include at most {max_items} entries.")
    for item in items:
        if len(item) > max_item_len:
            raise ValueError(f"Each {field} entry must be {max_item_len} characters or fewer.")
    return ",".join(items)


def normalize_upscale_target_format(value) -> str:
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
    if not normalized or normalized not in UPSCALE_TARGET_MATRIX:
        raise ValueError(f"target_format must be one of: {', '.join(UPSCALE_TARGET_FORMATS)}.")
    return normalized


def normalize_upscale_orientation(value) -> str:
    raw = str(value or "auto").strip().lower().replace("-", "_")
    aliases = {
        "auto": "auto",
        "portrait": "portrait",
        "landscape": "landscape",
        "square": "square",
    }
    normalized = aliases.get(raw)
    if normalized not in UPSCALE_ORIENTATIONS:
        raise ValueError("orientation must be auto, portrait, landscape, or square.")
    return normalized


def normalize_upscale_aspect_mode(value) -> str:
    raw = str(value or "preserve").strip().lower().replace("-", "_")
    aliases = {
        "preserve": "preserve",
        "crop": "crop",
        "extend": "extend",
        "full_bleed": "full_bleed",
        "fullbleed": "full_bleed",
    }
    normalized = aliases.get(raw)
    if normalized not in UPSCALE_ASPECT_MODES:
        raise ValueError("aspect_mode must be preserve, crop, extend, or full_bleed.")
    return normalized


def normalize_creation_size_family(value) -> str:
    raw = str(value or "a_series").strip().lower().replace("-", "_")
    aliases = {
        "a": "a_series",
        "a_series": "a_series",
        "aseries": "a_series",
        "square": "square_1_1",
        "1:1": "square_1_1",
        "1_1": "square_1_1",
        "square_1_1": "square_1_1",
    }
    normalized = aliases.get(raw, raw)
    if normalized not in CREATION_SIZE_FAMILIES:
        raise ValueError("creation_size_family must be a_series or square_1_1.")
    return normalized


def normalize_creation_orientations(value) -> list[str]:
    if value is None:
        items = ["portrait"]
    elif isinstance(value, str):
        items = [item.strip().lower() for item in value.split(",") if item.strip()]
    elif isinstance(value, list):
        items = [str(item).strip().lower() for item in value if str(item).strip()]
    else:
        raise ValueError("creation_orientations must be a comma-separated string or an array.")

    normalized: list[str] = []
    for item in items:
        if item in CREATION_ORIENTATIONS and item not in normalized:
            normalized.append(item)
    if not normalized:
        normalized = ["portrait"]
    return normalized


def normalize_creation_a_series_size(value) -> str:
    raw = str(value or "A1").strip().upper()
    if raw not in CREATION_A_SERIES_SIZES:
        raise ValueError("creation_a_series_size must be one of: A4, A3, A2, A1, A0, 2A0.")
    return raw


def normalize_creation_square_size_cm(value) -> int:
    parsed = coerce_int(value, "creation_square_size_cm", minimum=30, maximum=150, default=100)
    if parsed not in CREATION_SQUARE_SIZES_CM:
        raise ValueError("creation_square_size_cm must be one of: 30, 50, 80, 100, 120, 150.")
    return parsed


def resolve_source_attachment_id(raw_id, attachments: list[dict]) -> str:
    requested = str(raw_id or "").strip()
    ids = {str(item.get("id") or "") for item in attachments if isinstance(item, dict)}
    if requested:
        if requested not in ids:
            raise ValueError("source_attachment_id must reference an uploaded attachment id.")
        if attachment_path(requested) is None:
            raise ValueError("source_attachment_id does not reference an available local file.")
        return requested

    image_ids = [
        str(item.get("id") or "")
        for item in attachments
        if isinstance(item, dict) and item.get("kind") == "image" and attachment_path(str(item.get("id") or "")) is not None
    ]
    if image_ids:
        return image_ids[0]

    raise ValueError("Upscale Digital Fine Art workflow requires at least one uploaded image attachment.")


def generate_run_id() -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"run-{stamp}-{uuid.uuid4().hex[:10]}"


def summarize_print_review(review: dict) -> dict:
    return {
        "available": bool(review.get("available")),
        "source": review.get("source"),
        "updated_utc": review.get("updated_utc"),
        "failed": int(review.get("failed") or 0),
        "critical": int(review.get("critical") or 0),
        "caveats": int(review.get("caveats") or 0),
    }


def apply_prepress_quality_gate(payload: dict) -> dict | None:
    if payload.get("prepress_mode") != "run":
        return None
    review = summarize_print_review(get_print_review())
    blockers = []
    if not review["available"]:
        blockers.append("No print-quality review is available yet.")
    if review["failed"] > 0:
        blockers.append(f"{review['failed']} output(s) failed print review.")
    if review["critical"] > 0:
        blockers.append(f"{review['critical']} output(s) have a critical print-quality grade.")

    override_reason = coerce_text(payload.get("quality_gate_override_reason"), "quality_gate_override_reason", max_len=300)
    if blockers and not override_reason:
        raise ValueError(
            "Digital Art Print Auditor run blocked by quality gate: "
            + " ".join(blockers)
            + " Provide quality_gate_override_reason to continue."
        )
    if blockers:
        return {
            "status": "bypassed",
            "override_reason": override_reason,
            "blockers": blockers,
            "review": review,
        }
    return {
        "status": "passed",
        "override_reason": override_reason or None,
        "blockers": [],
        "review": review,
    }


def prepare_run_payload(raw_payload: dict) -> dict:
    workflow = normalize_workflow(raw_payload.get("workflow"))
    require_approval = coerce_bool(raw_payload.get("require_approval"), "require_approval", default=False)

    payload = {
        "run_id": generate_run_id(),
        "queued_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "workflow": workflow,
        "max_retries": coerce_int(raw_payload.get("max_retries"), "max_retries", minimum=0, maximum=5, default=2),
        "retry_delay_seconds": coerce_int(
            raw_payload.get("retry_delay_seconds"),
            "retry_delay_seconds",
            minimum=1,
            maximum=300,
            default=15,
        ),
        "attachments": normalize_attachments(raw_payload.get("attachments")),
        "links": normalize_links(raw_payload.get("links")),
        "require_approval": require_approval,
    }

    if workflow == WORKFLOW_CAMPAIGN:
        subject = coerce_text(raw_payload.get("subject") or raw_payload.get("topic"), "subject", required=True, max_len=220)
        ratio = coerce_text(raw_payload.get("ratio") or "4:5", "ratio", max_len=20)
        if not re.fullmatch(r"\d{1,2}:\d{1,2}", ratio):
            raise ValueError("ratio must use the W:H format, for example 4:5 or 9:16.")

        payload["subject"] = subject
        payload["topic"] = subject
        payload["ratio"] = ratio
        payload["intended_environment"] = coerce_text(
            raw_payload.get("intended_environment") or "gallery print",
            "intended_environment",
            max_len=120,
        )
        prompt_creator_command = coerce_text(
            raw_payload.get("prompt_creator_command"),
            "prompt_creator_command",
            max_len=20000,
        )
        if prompt_creator_command:
            payload["prompt_creator_command"] = prompt_creator_command
        creation_prompt_override = coerce_text(
            raw_payload.get("creation_prompt_override"),
            "creation_prompt_override",
            max_len=30000,
        )
        if creation_prompt_override:
            payload["creation_prompt_override"] = creation_prompt_override
        payload["art_dna_mode"] = coerce_text(raw_payload.get("art_dna_mode") or "AUTO", "art_dna_mode", max_len=24).upper()
        payload["creative_freedom"] = coerce_percentage(raw_payload.get("creative_freedom"), "creative_freedom", default=100)
        payload["originality_priority"] = coerce_percentage(raw_payload.get("originality_priority"), "originality_priority", default=100)
        payload["similarity_tolerance"] = coerce_percentage(raw_payload.get("similarity_tolerance"), "similarity_tolerance", default=1)
        payload["commercial_cliche_tolerance"] = coerce_percentage(
            raw_payload.get("commercial_cliche_tolerance"),
            "commercial_cliche_tolerance",
            default=0,
        )
        payload["predictability_tolerance"] = coerce_percentage(
            raw_payload.get("predictability_tolerance"),
            "predictability_tolerance",
            default=0,
        )
        payload["artistic_ambition"] = coerce_percentage(raw_payload.get("artistic_ambition"), "artistic_ambition", default=100)
        payload["creation_size_family"] = normalize_creation_size_family(raw_payload.get("creation_size_family"))
        payload["creation_orientations"] = normalize_creation_orientations(raw_payload.get("creation_orientations"))
        if payload["creation_size_family"] == "a_series":
            payload["creation_a_series_size"] = normalize_creation_a_series_size(raw_payload.get("creation_a_series_size"))
        else:
            payload["creation_square_size_cm"] = normalize_creation_square_size_cm(raw_payload.get("creation_square_size_cm"))
        payload["render"] = coerce_bool(raw_payload.get("render"), "render", default=False)

    elif workflow == WORKFLOW_PRODUCTION:
        payload["topic"] = coerce_text(raw_payload.get("topic"), "topic", max_len=180)
        payload["target_format"] = normalize_upscale_target_format(raw_payload.get("target_format"))
        payload["orientation"] = normalize_upscale_orientation(raw_payload.get("orientation"))
        payload["aspect_mode"] = normalize_upscale_aspect_mode(raw_payload.get("aspect_mode"))
        payload["target_dpi"] = coerce_int(raw_payload.get("target_dpi"), "target_dpi", minimum=300, maximum=300, default=300)
        if payload["orientation"] == "square" and payload["target_format"] != "1:1 MAX":
            raise ValueError("orientation=square is only supported with target_format=1:1 MAX.")
        payload["source_attachment_id"] = resolve_source_attachment_id(
            raw_payload.get("source_attachment_id"),
            payload["attachments"],
        )
        payload["print_quality"] = "Fine Art / Giclee"
        payload["viewing_standard"] = "Close-up gallery"
        payload["master_output"] = "TIFF + PNG"
        payload["master_bit_depth"] = "16-bit when supported"
        payload["render"] = False
        payload["require_approval"] = False

    elif workflow == WORKFLOW_PREPRESS:
        confirm = coerce_bool(raw_payload.get("confirm_external_actions"), "confirm_external_actions", default=False)
        payload["confirm_external_actions"] = confirm
        payload["prepress_mode"] = normalize_prepress_mode(raw_payload.get("prepress_mode"), confirm)
        override_reason = coerce_text(raw_payload.get("quality_gate_override_reason"), "quality_gate_override_reason", max_len=300)
        if override_reason:
            payload["quality_gate_override_reason"] = override_reason
        payload["quality_gate"] = apply_prepress_quality_gate(payload)

    return payload


def payload_audit_snapshot(payload: dict) -> dict:
    fields = (
        "run_id",
        "workflow",
        "queued_at",
        "subject",
        "topic",
        "ratio",
        "intended_environment",
        "art_dna_mode",
        "creative_freedom",
        "originality_priority",
        "similarity_tolerance",
        "commercial_cliche_tolerance",
        "predictability_tolerance",
        "artistic_ambition",
        "creation_size_family",
        "creation_orientations",
        "creation_a_series_size",
        "creation_square_size_cm",
        "target_format",
        "orientation",
        "aspect_mode",
        "target_dpi",
        "source_attachment_id",
        "print_quality",
        "viewing_standard",
        "master_output",
        "master_bit_depth",
        "audience",
        "angle",
        "cta",
        "count",
        "render",
        "loop",
        "max_iterations",
        "max_retries",
        "retry_delay_seconds",
        "require_approval",
        "production_engine",
        "prepress_mode",
        "confirm_external_actions",
        "quality_gate_override_reason",
        "quality_gate",
        "decision",
    )
    snapshot = {field: payload.get(field) for field in fields if field in payload}
    if payload.get("attachments"):
        snapshot["attachments"] = [
            {
                "id": item.get("id"),
                "name": item.get("name"),
                "kind": item.get("kind"),
                "size": item.get("size"),
            }
            for item in payload["attachments"]
            if isinstance(item, dict)
        ]
    if payload.get("links"):
        snapshot["links"] = [item.get("url") for item in payload["links"] if isinstance(item, dict)]
    if payload.get("prompt_creator_command"):
        snapshot["prompt_creator_command"] = shorten(payload["prompt_creator_command"], 500)
    if payload.get("creation_prompt_override"):
        snapshot["creation_prompt_override"] = shorten(payload["creation_prompt_override"], 500)
    return json_safe(snapshot)


def result_audit_snapshot(result: dict) -> dict:
    if not isinstance(result, dict):
        return {}
    snapshot = {
        "status": result.get("status"),
    }
    if isinstance(result.get("errors"), list) and result["errors"]:
        snapshot["errors"] = [shorten(item, 280) for item in result["errors"][:3]]
    if isinstance(result.get("winner"), dict):
        snapshot["winner"] = {
            "title": result["winner"].get("title"),
            "score": result["winner"].get("score"),
        }
    if isinstance(result.get("release"), dict):
        snapshot["release"] = {
            "status": result["release"].get("status"),
            "version": result["release"].get("version"),
        }
    if isinstance(result.get("print_review"), dict):
        snapshot["print_review"] = summarize_print_review(result["print_review"])
    if isinstance(result.get("quality_gate"), dict):
        snapshot["quality_gate"] = result["quality_gate"]
    if isinstance(result.get("rust_preflight"), dict):
        snapshot["rust_preflight"] = {
            "status": result["rust_preflight"].get("status"),
            "engine": result["rust_preflight"].get("engine"),
            "errors": result["rust_preflight"].get("errors"),
        }
    return json_safe(snapshot)


def append_run_audit(
    *,
    run_id: str | None,
    workflow: str,
    event: str,
    message: str = "",
    payload: dict | None = None,
    result: dict | None = None,
    status: str | None = None,
    returncode: int | None = None,
) -> None:
    if not run_id:
        return
    record = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "run_id": run_id,
        "workflow": workflow,
        "event": event,
    }
    if message:
        record["message"] = shorten(message, 400)
    if status:
        record["status"] = status
    if returncode is not None:
        record["returncode"] = returncode
    if payload is not None:
        record["payload"] = payload_audit_snapshot(payload)
    if result is not None:
        record["result"] = result_audit_snapshot(result)

    try:
        RUN_AUDIT_FILE.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps(json_safe(record), ensure_ascii=True)
        with AUDIT_LOCK:
            with RUN_AUDIT_FILE.open("a", encoding="utf-8") as stream:
                stream.write(line + "\n")
    except OSError:
        return


def read_json(path: Path):
    try:
        raw = path.read_text(encoding="utf-8")
        if raw.startswith("\ufeff"):
            raw = raw.lstrip("\ufeff")
        value = json.loads(raw)
    except (OSError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def configured_print_status_path():
    configured = os.environ.get("UPSCALE_OUTPUT_DIR", "").strip()
    if not configured:
        env_file = ROOT / "upscaled" / ".env"
        try:
            for line in env_file.read_text(encoding="utf-8").splitlines():
                match = re.match(r"\s*UPSCALE_OUTPUT_DIR\s*=\s*(.+?)\s*$", line)
                if match:
                    configured = match.group(1).strip().strip('"').strip("'")
                    break
        except OSError:
            pass
    if configured:
        output_dir = Path(configured)
        if not output_dir.is_absolute():
            output_dir = ROOT / "upscaled" / output_dir
    else:
        output_dir = ROOT / "upscaled" / "output"
    status_path = output_dir / "batch_status.json"
    return status_path if status_path.is_file() else None


def parse_updated_age(updated_utc) -> int | None:
    if not updated_utc:
        return None
    try:
        timestamp = datetime.fromisoformat(str(updated_utc).replace("Z", "+00:00"))
        return max(0, round((datetime.now(timezone.utc) - timestamp).total_seconds()))
    except ValueError:
        return None


def get_print_review() -> dict:
    empty = {"available": False, "message": "No Upscale batch has been reported yet.", "images": []}
    status_path = configured_print_status_path()
    status = read_json(status_path) if status_path else None
    if not status:
        return empty

    images = status.get("images") if isinstance(status.get("images"), list) else []
    review_images = []
    for image in images:
        if not isinstance(image, dict):
            continue
        final_name = Path(str(image.get("final") or "")).name
        final_path = status_path.parent / final_name if final_name else None
        review_images.append({
            "name": shorten(image.get("name"), 100),
            "status": shorten(image.get("status"), 40),
            "final": final_name or None,
            "final_url": f"{ROUTE_PRINT_ARTIFACTS}/{quote(final_name)}" if final_path and final_path.is_file() else None,
            "print_size_cm": image.get("print_size_cm"),
            "ppi": image.get("ppi"),
            "grade": image.get("grade") or (image.get("print_quality") or {}).get("grade"),
            "quality_flags": [shorten(flag, 120) for flag in image.get("quality_flags", []) if flag],
            "error": shorten(image.get("error"), 240) if image.get("error") else None,
        })
    selected = next((image for image in review_images if image["final_url"]), review_images[0] if review_images else None)
    try:
        source = str(status_path.relative_to(ROOT)).replace("\\", "/")
    except ValueError:
        source = str(status_path)
    return {
        "available": True,
        "source": source,
        "updated_utc": status.get("updated_utc"),
        "age_seconds": parse_updated_age(status.get("updated_utc")),
        "total": status.get("total", 0),
        "done": status.get("done", 0),
        "ok": status.get("ok", 0),
        "skipped": status.get("skipped", 0),
        "failed": status.get("failed", 0),
        "critical": status.get("critical", 0),
        "caveats": status.get("caveats", 0),
        "print_size": status.get("print_size"),
        "print_ppi": status.get("print_ppi"),
        "images": review_images,
        "selected": selected,
    }


def get_offline_runtime_status() -> dict:
    fallback = {
        "available": False,
        "passed": False,
        "checked_at": None,
        "command": None,
        "exit_code": None,
        "duration_seconds": None,
        "summary": "Offline checks have not been run yet.",
        "output_tail": [],
    }
    payload = read_json(OFFLINE_RUNTIME_STATUS_FILE)
    if not payload:
        return fallback
    return {
        "available": True,
        "passed": bool(payload.get("passed")),
        "checked_at": payload.get("checked_at"),
        "command": payload.get("command"),
        "exit_code": payload.get("exit_code"),
        "duration_seconds": payload.get("duration_seconds"),
        "summary": payload.get("summary") or fallback["summary"],
        "output_tail": payload.get("output_tail") if isinstance(payload.get("output_tail"), list) else [],
    }


def offline_health_payload() -> dict:
    runtime = get_offline_runtime_status()
    state = read_state()
    print_review = get_print_review()
    warnings = get_warnings(state, print_review)
    key_files = [
        ("dashboard_server", ROOT / "dashboard_server.py"),
        ("virtual_office", INDEX_FILE),
        ("offline_ready_page", OFFLINE_READY_FILE),
        ("production_orchestrator", ROOT / "production_orchestrator.py"),
        ("prepress_entry", ROOT / "upscaled" / "run_upscale.ps1"),
    ]
    file_checks = [{"name": name, "path": str(path), "ok": path.is_file()} for name, path in key_files]
    files_ok = all(item["ok"] for item in file_checks)
    tests_ok = bool(runtime.get("passed"))
    ok = files_ok and tests_ok
    summary = "System is running perfectly offline." if ok else "Offline system checks need attention."
    return {
        "ok": ok,
        "summary": summary,
        "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "runtime": runtime,
        "files": file_checks,
        "status": {
            "state": state.get("status"),
            "message": state.get("message"),
            "workflow": state.get("workflow"),
            "run_id": state.get("run_id"),
        },
        "warnings": warnings,
        "print_review": {
            "available": bool(print_review.get("available")),
            "failed": int(print_review.get("failed") or 0),
            "critical": int(print_review.get("critical") or 0),
            "caveats": int(print_review.get("caveats") or 0),
            "updated_utc": print_review.get("updated_utc"),
        },
    }


def get_creation_review(state: dict) -> dict:
    result = state.get("result") if isinstance(state.get("result"), dict) else {}
    winner = result.get("winner") if isinstance(result.get("winner"), dict) else {}
    ranked = result.get("ranked_batch") if isinstance(result.get("ranked_batch"), list) else []
    if not winner and ranked and isinstance(ranked[0], dict):
        winner = ranked[0]
    scene_map = result.get("scene_map") if isinstance(result.get("scene_map"), dict) else {}
    hook = scene_map.get("hook") if isinstance(scene_map.get("hook"), dict) else {}
    render_job = result.get("render_job") if isinstance(result.get("render_job"), dict) else {}
    render_url = find_result_url(render_job)
    attachments = state.get("attachments") if isinstance(state.get("attachments"), list) else []
    preview = next((item for item in attachments if isinstance(item, dict) and item.get("kind") == "image"), None)
    prompt = winner.get("prompt") or result.get("best_prompt") or result.get("prod_prompt")
    return {
        "available": bool(prompt or scene_map or render_job or preview),
        "title": shorten(winner.get("title") or result.get("topic") or "No creation selected", 100),
        "score": winner.get("score") or result.get("prod_score"),
        "prompt": shorten(prompt, 420),
        "hook": shorten(hook.get("text"), 180),
        "visual": shorten(hook.get("visual"), 180),
        "render_url": render_url,
        "render_job": json_safe(render_job) if render_job else None,
        "preview": preview,
    }


def find_result_url(value):
    preferred_keys = ("url", "output_url", "video_url", "image_url", "download_url", "result_url")
    if isinstance(value, dict):
        for key in preferred_keys:
            candidate = value.get(key)
            parsed = urlparse(candidate) if isinstance(candidate, str) else None
            if parsed and parsed.scheme in {"http", "https"} and parsed.netloc:
                return parsed.geturl()
        for item in value.values():
            found = find_result_url(item)
            if found:
                return found
    if isinstance(value, list):
        for item in value:
            found = find_result_url(item)
            if found:
                return found
    return None


def get_warnings(state: dict, print_review: dict) -> list[dict]:
    warnings = []
    status = str(state.get("status") or "idle")
    if status in {"retrying", "error"}:
        warnings.append({"scope": "Orchestrator", "severity": "error" if status == "error" else "warning", "message": shorten(state.get("message") or status)})
    result = state.get("result") if isinstance(state.get("result"), dict) else {}
    for message in result.get("errors", []) if isinstance(result.get("errors"), list) else []:
        warnings.append({"scope": "Upscale workflow", "severity": "error", "message": shorten(message)})
    rust_preflight = result.get("rust_preflight") if isinstance(result.get("rust_preflight"), dict) else {}
    if rust_preflight.get("status") == "failed":
        for message in rust_preflight.get("errors", [])[:2] if isinstance(rust_preflight.get("errors"), list) else []:
            warnings.append({"scope": "Rust core", "severity": "warning", "message": shorten(message)})
    if result.get("render_error"):
        warnings.append({"scope": "Renderer", "severity": "error", "message": shorten(result["render_error"])})
    if state.get("stderr"):
        lines = [line.strip() for line in str(state["stderr"]).splitlines() if line.strip()]
        if lines:
            warnings.append({"scope": "Local runner", "severity": "error", "message": shorten(lines[-1])})
    quality_gate = result.get("quality_gate") if isinstance(result.get("quality_gate"), dict) else state.get("quality_gate")
    if isinstance(quality_gate, dict) and quality_gate.get("status") == "bypassed":
        reason = shorten(quality_gate.get("override_reason") or "No override reason provided.", 180)
        warnings.append({
            "scope": "Digital Art Print Auditor quality gate",
            "severity": "warning",
            "message": f"Critical checks were bypassed: {reason}",
        })
    if print_review.get("available"):
        if int(print_review.get("failed") or 0):
            warnings.append({"scope": "Print Quality Auditor", "severity": "error", "message": f"{print_review['failed']} Upscale output(s) failed."})
        if int(print_review.get("critical") or 0):
            warnings.append({"scope": "Print Quality Auditor", "severity": "error", "message": f"{print_review['critical']} output(s) received a critical print grade."})
        if int(print_review.get("caveats") or 0):
            warnings.append({"scope": "Print Quality Auditor", "severity": "warning", "message": f"{print_review['caveats']} output(s) need print-quality review."})
        if print_review.get("done", 0) < print_review.get("total", 0) and (print_review.get("age_seconds") or 0) > 300:
            warnings.append({"scope": "Upscale pipeline", "severity": "warning", "message": f"Batch has not updated for {print_review['age_seconds']} seconds."})
        for image in print_review.get("images", []):
            if image.get("error"):
                warnings.append({"scope": f"Upscale: {image['name']}", "severity": "error", "message": image["error"]})
            for flag in image.get("quality_flags", [])[:2]:
                warnings.append({"scope": f"Print audit: {image['name']}", "severity": "warning", "message": flag})
    return warnings[:8]


def status_payload() -> dict:
    state = read_state()
    print_review = get_print_review()
    creation = get_creation_review(state)
    result_url = creation.get("render_url") or (print_review.get("selected") or {}).get("final_url")
    state["attachments"] = state.get("attachments") if isinstance(state.get("attachments"), list) else []
    state["links"] = state.get("links") if isinstance(state.get("links"), list) else []
    state["approval_pending"] = state.get("approval_pending") if isinstance(state.get("approval_pending"), dict) else None
    state["review"] = {"creation": creation, "print": print_review, "warnings": get_warnings(state, print_review)}
    state["final_result"] = {
        "available": bool(result_url or creation.get("available") or print_review.get("available")),
        "url": result_url,
        "title": creation.get("title") if creation.get("available") else (print_review.get("selected") or {}).get("name"),
    }
    return json_safe(state)


def print_artifact_path(filename: str):
    raw_name = unquote(filename)
    name = Path(raw_name).name
    if not name or name != raw_name:
        return None
    status_path = configured_print_status_path()
    status = read_json(status_path) if status_path else None
    images = status.get("images") if isinstance(status, dict) and isinstance(status.get("images"), list) else []
    allowed_names = {Path(str(image.get("final") or "")).name for image in images if isinstance(image, dict)}
    if name not in allowed_names:
        return None
    candidate = (status_path.parent / name).resolve()
    try:
        candidate.relative_to(status_path.parent.resolve())
    except ValueError:
        return None
    return candidate if candidate.is_file() else None


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
    subject = payload.get("subject") or payload.get("topic") or "FULL CREATIVE FREEDOM"
    ratio = payload.get("ratio") or "4:5"
    intended_environment = payload.get("intended_environment") or "gallery print"
    cmd = [
        sys.executable,
        str(ROOT / "fine_art_creation_agent.py"),
        "--subject",
        str(subject),
        "--ratio",
        str(ratio),
        "--intended-environment",
        str(intended_environment),
    ]
    if payload.get("art_dna_mode"):
        cmd.extend(["--art-dna-mode", str(payload["art_dna_mode"])])
    if payload.get("prompt_creator_command"):
        cmd.extend(["--prompt-creator-command", str(payload["prompt_creator_command"])])
    if payload.get("creation_prompt_override"):
        cmd.extend(["--creation-prompt-override", str(payload["creation_prompt_override"])])
    for key, flag in (
        ("creative_freedom", "--creative-freedom"),
        ("originality_priority", "--originality-priority"),
        ("similarity_tolerance", "--similarity-tolerance"),
        ("commercial_cliche_tolerance", "--commercial-cliche-tolerance"),
        ("predictability_tolerance", "--predictability-tolerance"),
        ("artistic_ambition", "--artistic-ambition"),
    ):
        if key in payload:
            cmd.extend([flag, str(int(payload[key]))])
    if payload.get("creation_size_family"):
        cmd.extend(["--creation-size-family", str(payload["creation_size_family"])])
    if payload.get("creation_a_series_size"):
        cmd.extend(["--creation-a-series-size", str(payload["creation_a_series_size"])])
    if payload.get("creation_square_size_cm") is not None:
        cmd.extend(["--creation-square-size-cm", str(int(payload["creation_square_size_cm"]))])
    if isinstance(payload.get("creation_orientations"), list) and payload["creation_orientations"]:
        cmd.extend(["--creation-orientations", ",".join(str(item) for item in payload["creation_orientations"])])
    if payload.get("render"):
        cmd.append("--render")
    return cmd


def build_upscale_production_command(payload: dict, source_path: Path) -> list[str]:
    command = [
        sys.executable,
        str(ROOT / "upscale_digital_fine_art_agent.py"),
        "--source",
        str(source_path),
        "--target-format",
        str(payload.get("target_format") or "2A0"),
        "--orientation",
        str(payload.get("orientation") or "auto"),
        "--aspect-mode",
        str(payload.get("aspect_mode") or "preserve"),
        "--target-dpi",
        str(int(payload.get("target_dpi") or 300)),
    ]
    topic = str(payload.get("topic") or "").strip()
    if topic:
        command.extend(["--label", topic])
    run_id = str(payload.get("run_id") or "").strip()
    if run_id:
        command.extend(["--run-id", run_id])
    return command


def production_result(result) -> dict:
    fields = (
        "topic", "audience", "angle", "cta", "count", "status", "winner",
        "ranked_candidates", "approval", "release", "render_job", "errors", "rust_preflight",
    )
    return json_safe({field: result.get(field) for field in fields if isinstance(result, dict) and field in result})


def run_rust_production_preflight(payload: dict) -> dict | None:
    rust_input = {
        "topic": payload.get("topic") or "AI for founders",
        "audience": payload.get("audience") or "startup founders",
        "angle": payload.get("angle") or "counterintuitive business leverage",
        "cta": payload.get("cta") or "Follow for more",
        "count": max(1, min(int(payload.get("count") or 3), 5)),
    }

    binary_name = "clip_ops_core.exe" if os.name == "nt" else "clip_ops_core"
    local_binary = ROOT / "rust_core" / "target" / "debug" / binary_name
    cargo = shutil.which("cargo")
    commands: list[list[str]] = []

    if cargo:
        commands.append([
            cargo,
            "run",
            "--manifest-path",
            str(ROOT / "rust_core" / "Cargo.toml"),
            "--quiet",
            "--",
            "--production-json",
        ])
    if local_binary.is_file():
        commands.append([str(local_binary), "--production-json"])

    if not commands:
        return None

    failures = []
    for command in commands:
        process = subprocess.run(
            command,
            cwd=str(ROOT),
            input=json.dumps(rust_input),
            capture_output=True,
            text=True,
        )
        if process.returncode != 0:
            detail = (process.stderr or process.stdout or "Rust preflight process failed.").strip()
            failures.append(shorten(detail, 260))
            continue

        parsed = parse_json_output(process.stdout)
        if not isinstance(parsed, dict) or "status" not in parsed:
            failures.append("Rust preflight did not emit the expected JSON payload.")
            continue

        if parsed.get("status") == "failed" or parsed.get("errors"):
            details = parsed.get("errors") if isinstance(parsed.get("errors"), list) else ["Rust preflight returned an error."]
            return {"status": "failed", "engine": "rust", "errors": [shorten(item, 260) for item in details[:3]], "result": json_safe(parsed)}

        has_winner = isinstance(parsed.get("winner"), dict)
        has_ranked = isinstance(parsed.get("ranked_candidates"), list)
        if not has_winner and not has_ranked:
            failures.append("Rust preflight JSON is missing winner and ranked_candidates.")
            continue

        return {
            "status": "completed",
            "engine": "rust",
            "winner": json_safe(parsed.get("winner")),
            "ranked_candidates": json_safe(parsed.get("ranked_candidates") or []),
            "idempotency_key": parsed.get("idempotency_key"),
            "result": json_safe(parsed),
        }

    return {"status": "failed", "engine": "rust", "errors": failures[:3] or ["Rust preflight is unavailable."]}


def normalize_prepress_mode(value, confirm_external_actions: bool = False) -> str:
    mode = str(value or "plan").strip().lower().replace("-", "_")
    aliases = {"dryrun": "dry_run", "execute": "run"}
    mode = aliases.get(mode, mode)
    if mode not in {"plan", "dry_run", "run"}:
        raise ValueError("Prepress mode must be plan, dry_run, or run.")
    if mode == "run" and not confirm_external_actions:
        raise ValueError("Set confirm_external_actions to run paid or external prepress actions.")
    return mode


def normalize_production_engine(value) -> str:
    engine = str(value or "auto").strip().lower().replace("-", "_")
    aliases = {"default": "auto"}
    engine = aliases.get(engine, engine)
    if engine not in {"auto", "rust", "python"}:
        raise ValueError("Production engine must be auto, rust, or python.")
    return engine


def build_prepress_command(payload: dict) -> list[str]:
    mode = normalize_prepress_mode(payload.get("prepress_mode"), bool(payload.get("confirm_external_actions")))
    script = ROOT / "upscaled" / "run_upscale.ps1"
    if not script.is_file():
        raise RuntimeError("Upscale entry point is not available.")
    shell = shutil.which("powershell.exe") or shutil.which("pwsh.exe") or shutil.which("pwsh")
    if not shell:
        raise RuntimeError("PowerShell is required to run the prepress workflow.")
    command = [
        shell,
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "RemoteSigned",
        "-File",
        str(script),
        "-Root",
        str(ROOT / "upscaled"),
    ]
    if mode == "plan":
        command.append("-Plan")
    elif mode == "dry_run":
        command.append("-DryRun")
    return command


def finish_standard_workflow_run(
    workflow: str,
    result: dict,
    duration_seconds: float,
    attachments: list[dict],
    links: list[dict],
    *,
    failed: bool,
    message: str,
    returncode: int | None = None,
    stdout: str = "",
    stderr: str = "",
    command: list[str] | None = None,
    run_id: str | None = None,
) -> None:
    state = read_state()
    active_run_id = run_id or state.get("run_id")
    metrics = state.get("metrics", default_state()["metrics"])
    metrics["last_duration_seconds"] = duration_seconds
    key = "runs_failed" if failed else "runs_completed"
    metrics[key] = metrics.get(key, 0) + 1
    status = "error" if failed else "completed"
    state.update(
        status=status,
        message=message,
        last_run="completed",
        result=json_safe(result),
        returncode=returncode,
        run_id=active_run_id,
        stdout=stdout,
        stderr=stderr,
        command=command,
        duration_seconds=duration_seconds,
        queue_depth=RUN_QUEUE.qsize(),
        workflow=workflow,
        stages=workflow_stages(workflow, status, message, duration_seconds=duration_seconds),
        attachments=attachments,
        links=links,
        quality_gate=result.get("quality_gate") if isinstance(result, dict) else None,
        approval_pending=None,
        run_started_at=None,
        metrics=metrics,
    )
    write_state(state)
    append_run_audit(
        run_id=active_run_id,
        workflow=workflow,
        event="finished",
        status=status,
        message=message,
        result=result,
        returncode=returncode,
    )


def finish_production_run(
    result,
    started_at: float,
    attachments: list[dict],
    links: list[dict],
    *,
    run_id: str | None = None,
) -> None:
    projected = production_result(result)
    failed = projected.get("status") == "failed" or bool(projected.get("errors"))
    rejected = projected.get("status") == "rejected"
    status = "error" if failed else "rejected" if rejected else "completed"
    message = "Upscale workflow failed" if failed else "Upscale review rejected" if rejected else "Upscale workflow finished"
    state = read_state()
    active_run_id = run_id or state.get("run_id")
    previous_result = state.get("result") if isinstance(state.get("result"), dict) else {}
    if "rust_preflight" in previous_result and "rust_preflight" not in projected:
        projected["rust_preflight"] = previous_result["rust_preflight"]
    metrics = state.get("metrics", default_state()["metrics"])
    metrics["last_duration_seconds"] = round(max(0, time.time() - started_at), 2)
    key = "runs_failed" if failed else "runs_completed"
    metrics[key] = metrics.get(key, 0) + 1
    state.update(
        status=status,
        message=message,
        last_run="completed",
        result=projected,
        run_id=active_run_id,
        approval_pending=None,
        run_started_at=None,
        attachments=attachments,
        links=links,
        quality_gate=None,
        duration_seconds=metrics["last_duration_seconds"],
        workflow=WORKFLOW_PRODUCTION,
        stages=workflow_stages(WORKFLOW_PRODUCTION, status, message, duration_seconds=metrics["last_duration_seconds"]),
        metrics=metrics,
    )
    write_state(state)
    append_run_audit(
        run_id=active_run_id,
        workflow=WORKFLOW_PRODUCTION,
        event="finished",
        status=status,
        message=message,
        result=projected,
    )


def run_production_job(payload: dict) -> None:
    attachments = normalize_attachments(payload.get("attachments"))
    links = normalize_links(payload.get("links"))
    run_id = payload.get("run_id")
    started = time.monotonic()
    source_id = str(payload.get("source_attachment_id") or "")
    source_path = attachment_path(source_id) if source_id else None
    command = build_upscale_production_command(payload, source_path) if source_path else None
    metrics = read_state().get("metrics", default_state()["metrics"])
    metrics["runs_total"] = metrics.get("runs_total", 0) + 1
    update_state(
        status="running",
        message="Upscale Digital Fine Art run started",
        last_run="in_progress",
        result={},
        returncode=None,
        run_id=run_id,
        command=command,
        queue_depth=RUN_QUEUE.qsize(),
        attachments=attachments,
        links=links,
        quality_gate=None,
        approval_pending=None,
        run_started_at=time.time(),
        workflow=WORKFLOW_PRODUCTION,
        stages=workflow_stages(WORKFLOW_PRODUCTION, "running", "Upscale Digital Fine Art run started"),
        metrics=metrics,
    )

    try:
        if source_path is None:
            source_id = resolve_source_attachment_id(payload.get("source_attachment_id"), attachments)
            source_path = attachment_path(source_id)
            command = build_upscale_production_command(payload, source_path) if source_path else None
            update_state(command=command)
        if command is None:
            raise RuntimeError("No source attachment is available for the upscale run.")
        process = subprocess.run(command, cwd=str(ROOT), env=os.environ.copy(), capture_output=True, text=True)
        parsed = parse_json_output(process.stdout)
        if not isinstance(parsed, dict):
            parsed = {"status": "failed", "errors": ["Upscale workflow did not return a JSON object."]}
        failed = process.returncode != 0 or parsed.get("status") == "failed" or bool(parsed.get("errors"))
        parsed.setdefault("status", "failed" if failed else "completed")
        parsed.setdefault("workflow", "upscale_digital_fine_art")
        message = "Upscale Digital Fine Art workflow failed" if failed else "Upscale Digital Fine Art workflow finished"
        returncode = process.returncode
        stdout = process.stdout
        stderr = process.stderr
    except Exception as exc:
        failed = True
        message = "Upscale Digital Fine Art workflow failed"
        parsed = {"status": "failed", "errors": [str(exc)]}
        returncode = 1
        stdout = ""
        stderr = str(exc)

    finish_standard_workflow_run(
        WORKFLOW_PRODUCTION,
        parsed,
        round(time.monotonic() - started, 2),
        attachments,
        links,
        failed=failed,
        message=message,
        returncode=returncode,
        stdout=stdout,
        stderr=stderr,
        command=command,
        run_id=run_id,
    )


def resume_pending_approval(decision: str) -> dict:
    from production_orchestrator import resume_production_workflow

    state = read_state()
    run_id = state.get("run_id")
    pending = state.get("approval_pending")
    if not isinstance(pending, dict) or not pending.get("thread_id"):
        raise ValueError("There is no production decision awaiting approval.")
    attachments = state.get("attachments") if isinstance(state.get("attachments"), list) else []
    links = state.get("links") if isinstance(state.get("links"), list) else []
    started_at = float(state.get("run_started_at") or time.time())
    update_state(
        status="running",
        message=f"Applying human decision: {decision}",
        last_run="in_progress",
        run_id=run_id,
        workflow=WORKFLOW_PRODUCTION,
        stages=workflow_stages(WORKFLOW_PRODUCTION, "running", f"Applying human decision: {decision}"),
    )
    append_run_audit(
        run_id=run_id,
        workflow=WORKFLOW_PRODUCTION,
        event="approval_decision",
        status="running",
        message=f"Human decision: {decision}",
        payload={"decision": decision},
    )
    try:
        result = resume_production_workflow(str(pending["thread_id"]), decision)
    except Exception as exc:
        finish_production_run({"status": "failed", "errors": [str(exc)]}, started_at, attachments, links, run_id=run_id)
        raise
    finish_production_run(result, started_at, attachments, links, run_id=run_id)
    return status_payload()


def run_campaign_job(payload: dict) -> None:
    attachments = normalize_attachments(payload.get("attachments"))
    links = normalize_links(payload.get("links"))
    run_id = payload.get("run_id")
    cmd = build_command(payload)
    max_retries = max(0, min(int(payload["max_retries"]), 5)) if "max_retries" in payload else 2
    retry_delay = max(1, min(int(payload["retry_delay_seconds"]), 300)) if "retry_delay_seconds" in payload else 15
    started = time.monotonic()
    metrics = read_state().get("metrics", default_state()["metrics"])
    metrics["runs_total"] = metrics.get("runs_total", 0) + 1
    update_state(
        status="running",
        message="Fine art creation run started",
        last_run="in_progress",
        returncode=None,
        run_id=run_id,
        result={},
        command=cmd,
        retry_count=0,
        queue_depth=RUN_QUEUE.qsize(),
        attachments=attachments,
        links=links,
        quality_gate=None,
        approval_pending=None,
        workflow=WORKFLOW_CAMPAIGN,
        stages=workflow_stages(WORKFLOW_CAMPAIGN, "running", "Fine art creation run started"),
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
            message=f"Fine art render failed; retrying in {retry_delay} seconds",
            retry_count=attempt + 1,
            queue_depth=RUN_QUEUE.qsize(),
            workflow=WORKFLOW_CAMPAIGN,
            stages=workflow_stages(WORKFLOW_CAMPAIGN, "retrying", f"Fine art render failed; retrying in {retry_delay} seconds"),
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
        message="Fine art creation failed" if failed else "Fine art creation finished",
        last_run="completed",
        returncode=result.returncode,
        run_id=run_id,
        result=parsed_result,
        stdout=result.stdout,
        stderr=result.stderr,
        command=cmd,
        duration_seconds=duration,
        queue_depth=RUN_QUEUE.qsize(),
        attachments=attachments,
        links=links,
        quality_gate=None,
        approval_pending=None,
        workflow=WORKFLOW_CAMPAIGN,
        stages=workflow_stages(
            WORKFLOW_CAMPAIGN,
            "error" if failed else "completed",
            "Fine art creation failed" if failed else "Fine art creation finished",
            duration_seconds=duration,
        ),
        metrics=metrics,
    )
    append_run_audit(
        run_id=run_id,
        workflow=WORKFLOW_CAMPAIGN,
        event="finished",
        status="error" if failed else "completed",
        message="Fine art creation failed" if failed else "Fine art creation finished",
        result=parsed_result,
        returncode=result.returncode,
    )


def run_prepress_job(payload: dict) -> None:
    attachments = normalize_attachments(payload.get("attachments"))
    links = normalize_links(payload.get("links"))
    run_id = payload.get("run_id")
    quality_gate = payload.get("quality_gate") if isinstance(payload.get("quality_gate"), dict) else None
    mode = normalize_prepress_mode(payload.get("prepress_mode"), bool(payload.get("confirm_external_actions")))
    started = time.monotonic()
    metrics = read_state().get("metrics", default_state()["metrics"])
    metrics["runs_total"] = metrics.get("runs_total", 0) + 1
    update_state(
        status="running",
        message=f"Digital Art Print Auditor {mode.replace('_', ' ')} started",
        last_run="in_progress",
        result={},
        returncode=None,
        run_id=run_id,
        stdout="",
        stderr="",
        command=None,
        queue_depth=RUN_QUEUE.qsize(),
        attachments=attachments,
        links=links,
        quality_gate=quality_gate,
        approval_pending=None,
        workflow=WORKFLOW_PREPRESS,
        stages=workflow_stages(WORKFLOW_PREPRESS, "running", f"Digital Art Print Auditor {mode.replace('_', ' ')} started"),
        metrics=metrics,
    )
    try:
        command = build_prepress_command(payload)
        process = subprocess.run(command, cwd=str(ROOT), env=os.environ.copy(), capture_output=True, text=True)
        failed = process.returncode != 0
        message = "Digital Art Print Auditor failed" if failed else "Digital Art Print Auditor finished"
        projected = {
            "status": "failed" if failed else "completed",
            "prepress_mode": mode,
            "print_review": get_print_review(),
            "quality_gate": quality_gate,
        }
        returncode = process.returncode
        stdout = process.stdout
        stderr = process.stderr
    except Exception as exc:
        failed = True
        message = "Digital Art Print Auditor failed"
        projected = {
            "status": "failed",
            "prepress_mode": mode,
            "errors": [str(exc)],
            "quality_gate": quality_gate,
        }
        returncode = 1
        stdout = ""
        stderr = str(exc)
        command = None
    finish_standard_workflow_run(
        WORKFLOW_PREPRESS,
        projected,
        round(time.monotonic() - started, 2),
        attachments,
        links,
        failed=failed,
        message=message,
        returncode=returncode,
        stdout=stdout,
        stderr=stderr,
        command=command,
        run_id=run_id,
    )


def run_job(payload: dict) -> None:
    workflow = normalize_workflow(payload.get("workflow"))
    run_id = payload.get("run_id")
    payload = {**payload, "workflow": workflow}
    append_run_audit(
        run_id=run_id,
        workflow=workflow,
        event="started",
        status="running",
        message="Run execution started",
        payload=payload,
    )
    if workflow == WORKFLOW_PRODUCTION:
        run_production_job(payload)
    elif workflow == WORKFLOW_PREPRESS:
        run_prepress_job(payload)
    else:
        run_campaign_job(payload)


def queue_worker() -> None:
    while True:
        payload = RUN_QUEUE.get()
        try:
            run_job(payload)
            while read_state().get("approval_pending"):
                time.sleep(0.2)
        finally:
            RUN_QUEUE.task_done()
            state = read_state()
            state["queue_depth"] = RUN_QUEUE.qsize()
            write_state(state)


threading.Thread(target=queue_worker, name="orchestrator-worker", daemon=True).start()


class DashboardHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path in {ROUTE_DASHBOARD, ROUTE_DASHBOARD_INDEX}:
            if not INDEX_FILE.exists():
                self.send_response(404)
                self.end_headers()
                self.wfile.write(b"Dashboard page not found")
                return
            html = INDEX_FILE.read_text(encoding="utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
            self.end_headers()
            self.wfile.write(html.encode("utf-8"))
            return

        if parsed.path in {ROUTE_OFFLINE_DASHBOARD, ROUTE_OFFLINE_ALIAS}:
            if not OFFLINE_READY_FILE.exists():
                self.send_response(404)
                self.end_headers()
                self.wfile.write(b"Offline dashboard page not found")
                return
            html = OFFLINE_READY_FILE.read_text(encoding="utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
            self.end_headers()
            self.wfile.write(html.encode("utf-8"))
            return

        if parsed.path in {ROUTE_ROUTES, LEGACY_ROUTE_ROUTES}:
            self.send_json(route_manifest_payload())
            return

        if parsed.path in {LEGACY_ROUTE_STATUS, ROUTE_STATUS}:
            self.send_json(status_payload())
            return

        if parsed.path in {LEGACY_ROUTE_OFFLINE_HEALTH, ROUTE_OFFLINE_HEALTH}:
            self.send_json(offline_health_payload())
            return

        attachment_id = route_suffix(parsed.path, LEGACY_ROUTE_ATTACHMENTS, ROUTE_ATTACHMENTS)
        if attachment_id is not None:
            path = attachment_path(attachment_id)
            self.send_file(path, inline=bool(path and path.suffix.lower() in {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}))
            return

        print_artifact = route_suffix(parsed.path, LEGACY_ROUTE_PRINT_ARTIFACTS, ROUTE_PRINT_ARTIFACTS)
        if print_artifact is not None:
            path = print_artifact_path(print_artifact)
            self.send_file(path, inline=True)
            return

        self.send_response(404)
        self.end_headers()
        self.wfile.write(b"Not found")

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path in {LEGACY_ROUTE_ATTACHMENTS, ROUTE_ATTACHMENTS}:
            try:
                payload = self.read_json_body(MAX_ATTACHMENT_BYTES * 2)
                attachment = save_attachment(payload)
            except ValueError as exc:
                self.send_json({"ok": False, "error": str(exc)}, status=400)
                return
            self.send_json({"ok": True, "attachment": attachment}, status=201)
            return

        if parsed.path in {LEGACY_ROUTE_APPROVALS, ROUTE_APPROVALS}:
            try:
                payload = self.read_json_body()
                decision = str(payload.get("decision") or "").strip().lower()
                if decision not in {"approve", "reject"}:
                    raise ValueError("Decision must be approve or reject.")
                result = resume_pending_approval(decision)
            except ValueError as exc:
                self.send_json({"ok": False, "error": str(exc)}, status=409)
                return
            except Exception as exc:
                self.send_json({"ok": False, "error": f"Unable to apply decision: {exc}"}, status=500)
                return
            self.send_json({"ok": True, "state": result})
            return

        if parsed.path not in {LEGACY_ROUTE_RUNS, ROUTE_RUNS}:
            self.send_error(404)
            return

        try:
            payload = self.read_json_body()
        except ValueError as exc:
            self.send_json({"ok": False, "error": str(exc)}, status=400)
            return

        state = read_state()
        if state.get("approval_pending"):
            self.send_json({"ok": False, "error": "Resolve the pending approval before starting another run."}, status=409)
            return

        try:
            payload = prepare_run_payload(payload)
        except ValueError as exc:
            self.send_json({"ok": False, "error": str(exc)}, status=400)
            return
        RUN_QUEUE.put(payload)
        append_run_audit(
            run_id=payload.get("run_id"),
            workflow=payload["workflow"],
            event="queued",
            status="queued",
            message="Run queued",
            payload=payload,
        )
        state["status"] = "queued"
        state["message"] = {
            WORKFLOW_CAMPAIGN: "Fine art creation workflow queued",
            WORKFLOW_PRODUCTION: "Upscale workflow queued",
            WORKFLOW_PREPRESS: "Digital Art Print Auditor queued",
        }[payload["workflow"]]
        state["run_id"] = payload.get("run_id")
        state["queue_depth"] = RUN_QUEUE.qsize()
        state["attachments"] = payload["attachments"]
        state["links"] = payload["links"]
        state["workflow"] = payload["workflow"]
        state["quality_gate"] = payload.get("quality_gate") if payload["workflow"] == WORKFLOW_PREPRESS else None
        state["stages"] = workflow_stages(payload["workflow"], "queued", state["message"])
        write_state(state)
        self.send_json(
            {
                "ok": True,
                "queued": True,
                "run_id": payload.get("run_id"),
                "queue_depth": RUN_QUEUE.qsize(),
                "workflow": payload["workflow"],
                "require_approval": payload["require_approval"],
                "quality_gate": payload.get("quality_gate"),
            }
        )

    def read_json_body(self, max_bytes: int = 256 * 1024) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("Content length is invalid.") from exc
        if length < 0 or length > max_bytes:
            raise ValueError("Request body is too large.")
        body = self.rfile.read(length)
        if not body:
            return {}
        try:
            payload = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("Request body must be valid JSON.") from exc
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")
        return payload

    def send_file(self, path: Path | None, *, inline: bool) -> None:
        if path is None:
            self.send_error(404, "Artifact not found")
            return
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        disposition = "inline" if inline else "attachment"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(path.stat().st_size))
        self.send_header("Content-Disposition", f'{disposition}; filename="{safe_filename(path.name)}"')
        self.end_headers()
        with path.open("rb") as stream:
            shutil.copyfileobj(stream, self.wfile)

    def send_json(self, payload: dict, status: int = 200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
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
