import json
import os
from typing import Any, Dict, Optional
from urllib import error, request


class MidjourneyClient:
    """HTTP renderer client with provider adapters for BFL and Runway."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        endpoint: Optional[str] = None,
        timeout: int = 60,
        provider: Optional[str] = None,
    ):
        self.provider = self._resolve_provider(provider=provider, endpoint=endpoint)
        self.api_key = api_key or self._resolve_api_key(self.provider)
        self.endpoint = (endpoint or self._resolve_endpoint(self.provider)).rstrip("/")
        self.timeout = timeout

    @staticmethod
    def _resolve_provider(provider: Optional[str], endpoint: Optional[str]) -> str:
        explicit = str(provider or os.getenv("RENDERER_PROVIDER") or "").strip().lower()
        if explicit in {"runway", "bfl", "midjourney", "generic"}:
            return explicit
        candidate = str(
            endpoint
            or os.getenv("RUNWAY_ENDPOINT")
            or os.getenv("RENDERER_ENDPOINT")
            or os.getenv("MIDJOURNEY_ENDPOINT")
            or os.getenv("BFL_ENDPOINT")
            or ""
        ).lower()
        if (
            "runwayml.com" in candidate
            or "runway" in candidate
            or "/v1/text_to_video" in candidate
            or "/v1/image_to_video" in candidate
            or "/v1/tasks" in candidate
        ):
            return "runway"
        if "api.bfl.ai" in candidate or "flux-3-video" in candidate:
            return "bfl"

        runway_key = bool(str(os.getenv("RUNWAY_API_KEY") or "").strip())
        runway_secret = bool(str(os.getenv("RUNWAYML_API_SECRET") or "").strip())
        runway_hint = bool(str(os.getenv("RUNWAY_MODEL") or "").strip())
        midjourney_key = bool(str(os.getenv("MIDJOURNEY_API_KEY") or "").strip())
        bfl_key = bool(str(os.getenv("BFL_API_KEY") or "").strip())

        # If only Runway credentials/hints are configured, prefer Runway as the default creator backend.
        if (runway_key or runway_secret or runway_hint) and not (midjourney_key or bfl_key):
            return "runway"
        if bfl_key and not midjourney_key:
            return "bfl"
        return "midjourney"

    @staticmethod
    def _resolve_api_key(provider: str) -> Optional[str]:
        if provider == "runway":
            return (
                os.getenv("RUNWAYML_API_SECRET")
                or os.getenv("RUNWAY_API_KEY")
                or os.getenv("RENDERER_API_KEY")
                or os.getenv("MIDJOURNEY_API_KEY")
                or os.getenv("BFL_API_KEY")
            )
        return (
            os.getenv("RUNWAYML_API_SECRET")
            or os.getenv("MIDJOURNEY_API_KEY")
            or os.getenv("BFL_API_KEY")
            or os.getenv("RENDERER_API_KEY")
            or os.getenv("RUNWAY_API_KEY")
        )

    @staticmethod
    def _resolve_endpoint(provider: str) -> str:
        if provider == "runway":
            renderer_endpoint = os.getenv("RENDERER_ENDPOINT")
            renderer_lower = str(renderer_endpoint or "").lower()
            return (
                os.getenv("RUNWAY_ENDPOINT")
                or (
                    renderer_endpoint
                    if (
                        "runway" in renderer_lower
                        or "/v1/text_to_video" in renderer_lower
                        or "/v1/image_to_video" in renderer_lower
                        or "/v1/tasks" in renderer_lower
                    )
                    else None
                )
                or "https://api.dev.runwayml.com/v1/text_to_video"
            )
        return (
            os.getenv("MIDJOURNEY_ENDPOINT")
            or os.getenv("BFL_ENDPOINT")
            or os.getenv("RENDERER_ENDPOINT")
            or "https://api.bfl.ai/v1/flux-3-video"
        )

    def _headers(self, *, polling: bool = False) -> Dict[str, str]:
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if self.api_key and self.provider == "runway":
            headers["Authorization"] = f"Bearer {self.api_key}"
            headers["X-Runway-Version"] = os.getenv("RUNWAY_API_VERSION") or "2024-11-06"
        elif self.api_key:
            headers["x-key"] = self.api_key
        return headers

    def _request(
        self,
        method: str,
        url: Optional[str] = None,
        payload: Optional[Dict[str, Any]] = None,
        extra_headers: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        if not self.api_key:
            raise ValueError(
                "MIDJOURNEY_API_KEY, BFL_API_KEY, RUNWAY_API_KEY, or RENDERER_API_KEY is required to call the generation API."
            )

        target_url = (url or self.endpoint).rstrip("/")
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = self._headers(polling=method.upper() == "GET")
        if extra_headers:
            headers.update(extra_headers)
        req = request.Request(target_url, data=body, headers=headers, method=method)
        try:
            with request.urlopen(req, timeout=self.timeout) as response:
                raw = response.read()
        except error.HTTPError as exc:
            body_text = exc.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"Renderer request failed for {method.upper()} {target_url}: {body_text}") from exc

        if not raw:
            return {}
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {"raw": raw.decode("utf-8", errors="ignore")}

        if isinstance(parsed, dict) and "data" in parsed and isinstance(parsed["data"], dict):
            return parsed["data"]
        return parsed

    @staticmethod
    def _runway_ratio(aspect_ratio: str) -> str:
        normalized = str(aspect_ratio or "").strip()
        mapping = {
            "9:16": "720:1280",
            "16:9": "1280:720",
            "1:1": "1024:1024",
            "4:5": "960:1200",
            "3:4": "960:1280",
        }
        return mapping.get(normalized, normalized)

    def _runway_image_mode(self) -> bool:
        endpoint = str(self.endpoint or "").lower()
        return "text_to_image" in endpoint or "image_to_image" in endpoint

    def _runway_payload(self, prompt: str, kwargs: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"promptText": prompt}
        model = kwargs.pop("model", None) or os.getenv("RUNWAY_MODEL")
        if model:
            payload["model"] = model

        duration_value = kwargs.pop("duration", kwargs.pop("duration_sec", None))
        if duration_value is not None and not self._runway_image_mode():
            try:
                payload["duration"] = max(1, int(duration_value))
            except (TypeError, ValueError):
                pass

        ratio_value = kwargs.pop("ratio", kwargs.pop("aspect_ratio", None))
        if ratio_value:
            ratio_text = str(ratio_value)
            payload["ratio"] = ratio_text if self._runway_image_mode() else self._runway_ratio(ratio_text)

        for source_key, target_key in (("image_url", "imageUri"), ("image_uri", "imageUri"), ("reference_image", "imageUri")):
            source_value = kwargs.pop(source_key, None)
            if source_value and target_key not in payload:
                payload[target_key] = source_value

        for key, value in kwargs.items():
            if value is not None:
                payload[key] = value
        return payload

    def _runway_task_url(self, task_id: str) -> str:
        if "/v1/" in self.endpoint:
            base = self.endpoint.split("/v1/", 1)[0]
            return f"{base}/v1/tasks/{task_id}"
        return f"{self.endpoint}/v1/tasks/{task_id}"

    def generate(self, prompt: str, **kwargs: Any) -> Dict[str, Any]:
        if not prompt:
            raise ValueError("prompt is required.")

        idempotency_key = kwargs.pop("idempotency_key", None)
        if self.provider == "runway":
            if self.endpoint.endswith("/mcp"):
                raise ValueError(
                    "RUNWAY_ENDPOINT points to the MCP server, not the generation API. "
                    "Use a Runway API endpoint such as https://api.dev.runwayml.com/v1/text_to_video."
                )
            payload = self._runway_payload(prompt, dict(kwargs))
            headers = {"Idempotency-Key": str(idempotency_key)} if idempotency_key else None
            return self._request("POST", self.endpoint, payload, extra_headers=headers)

        payload = {"prompt": prompt, **kwargs}
        if idempotency_key:
            payload["idempotency_key"] = idempotency_key
        payload.setdefault("mode", "t2v")
        if "api.bfl.ai" in self.endpoint and self.endpoint.endswith("/flux-3-video"):
            payload.pop("duration_sec", None)
            payload.pop("model", None)
        return self._request("POST", self.endpoint, payload)

    def poll(self, polling_url: str) -> Dict[str, Any]:
        if not polling_url:
            raise ValueError("polling_url is required.")
        if self.provider == "runway" and not str(polling_url).startswith(("http://", "https://")):
            return self._request("GET", self._runway_task_url(str(polling_url)))
        return self._request("GET", polling_url)

    def get_job(self, job_id: str) -> Dict[str, Any]:
        if not job_id:
            raise ValueError("job_id is required.")
        if self.provider == "runway":
            return self._request("GET", self._runway_task_url(job_id))
        return self._request("GET", f"{self.endpoint}/{job_id}")

    def wait_for_completion(self, polling_url: str, poll_interval: float = 5.0, max_attempts: int = 20) -> Dict[str, Any]:
        for _ in range(max_attempts):
            result = self.poll(polling_url)
            status = str(result.get("status") or result.get("state") or "").lower()
            if status in {"success", "completed", "finished", "failed", "error", "ready", "succeeded"}:
                return result
            if poll_interval:
                import time
                time.sleep(poll_interval)
        return result
