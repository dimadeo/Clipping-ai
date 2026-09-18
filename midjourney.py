import json
import os
from typing import Any, Dict, Optional
from urllib import request, error


class MidjourneyClient:
    """Minimal Midjourney-compatible HTTP renderer client for video/image generation."""

    def __init__(self, api_key: Optional[str] = None, endpoint: Optional[str] = None, timeout: int = 60):
        self.api_key = (
            api_key
            or os.getenv("MIDJOURNEY_API_KEY")
            or os.getenv("BFL_API_KEY")
            or os.getenv("RENDERER_API_KEY")
        )
        self.endpoint = (
            endpoint
            or os.getenv("MIDJOURNEY_ENDPOINT")
            or os.getenv("BFL_ENDPOINT")
            or os.getenv("RENDERER_ENDPOINT")
            or "https://api.bfl.ai/v1/flux-3-video"
        ).rstrip("/")
        self.timeout = timeout

    def _headers(self, *, polling: bool = False) -> Dict[str, str]:
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if self.api_key:
            headers["x-key"] = self.api_key
        if not polling and "Authorization" in headers:
            headers.pop("Authorization", None)
        return headers

    def _request(self, method: str, url: Optional[str] = None, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        if not self.api_key:
            raise ValueError("MIDJOURNEY_API_KEY or RENDERER_API_KEY is required to call the generation API.")

        target_url = (url or self.endpoint).rstrip("/")
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        req = request.Request(target_url, data=body, headers=self._headers(polling=method.upper() == "GET"), method=method)
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

    def generate(self, prompt: str, **kwargs: Any) -> Dict[str, Any]:
        if not prompt:
            raise ValueError("prompt is required.")

        payload = {"prompt": prompt, **kwargs}
        payload.setdefault("mode", "t2v")
        if "api.bfl.ai" in self.endpoint and self.endpoint.endswith("/flux-3-video"):
            payload.pop("duration_sec", None)
            payload.pop("model", None)
        return self._request("POST", self.endpoint, payload)

    def poll(self, polling_url: str) -> Dict[str, Any]:
        if not polling_url:
            raise ValueError("polling_url is required.")
        return self._request("GET", polling_url)

    def get_job(self, job_id: str) -> Dict[str, Any]:
        if not job_id:
            raise ValueError("job_id is required.")
        return self._request("GET", f"{self.endpoint}/{job_id}")

    def wait_for_completion(self, polling_url: str, poll_interval: float = 5.0, max_attempts: int = 20) -> Dict[str, Any]:
        for _ in range(max_attempts):
            result = self.poll(polling_url)
            status = str(result.get("status") or result.get("state") or "").lower()
            if status in {"success", "completed", "finished", "failed", "error", "ready"}:
                return result
            if poll_interval:
                import time
                time.sleep(poll_interval)
        return result
