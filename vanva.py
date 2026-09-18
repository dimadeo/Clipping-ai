import json
import os
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import requests


class VanvaClient:
    """Minimal Vanva API client for generating videos from text prompts."""

    def __init__(self, api_key: Optional[str] = None, base_url: Optional[str] = None, timeout: int = 60):
        self.api_key = api_key or os.getenv("VANVA_API_KEY")
        self.base_url = (base_url or os.getenv("VANVA_BASE_URL") or "https://api.vanva.ai").rstrip("/")
        self.timeout = timeout

    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def _request_json(self, method: str, path: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        url = f"{self.base_url}{path}"
        response = requests.request(method=method, url=url, headers=self._headers(), json=payload, timeout=self.timeout)
        try:
            response.raise_for_status()
        except requests.HTTPError as exc:
            body = response.text
            raise RuntimeError(f"Vanva API request failed for {method.upper()} {url}: {body}") from exc

        payload_data = response.json()
        if isinstance(payload_data, dict) and "data" in payload_data and isinstance(payload_data["data"], dict):
            return payload_data["data"]
        if isinstance(payload_data, dict) and "result" in payload_data and isinstance(payload_data["result"], dict):
            return payload_data["result"]
        return payload_data

    def generate_video(
        self,
        prompt: str,
        duration: int = 8,
        model: Optional[str] = None,
        aspect_ratio: str = "16:9",
        negative_prompt: Optional[str] = None,
        output_dir: Optional[str] = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        if not prompt or not str(prompt).strip():
            raise ValueError("A non-empty prompt is required to generate a Vanva video.")

        payload = {
            "prompt": prompt,
            "duration": duration,
            "aspect_ratio": aspect_ratio,
            **kwargs,
        }
        if model:
            payload["model"] = model
        if negative_prompt:
            payload["negative_prompt"] = negative_prompt
        if output_dir:
            payload["output_dir"] = output_dir

        endpoints = [
            "/v1/generate",
            "/v1/video/generate",
            "/v1/video/generation",
            "/v1/jobs",
        ]

        last_error: Optional[Exception] = None
        for endpoint in endpoints:
            try:
                response = self._request_json("POST", endpoint, payload)
                if isinstance(response, dict):
                    normalized = dict(response)
                    if "id" in normalized or "video_url" in normalized or "status" in normalized or "output" in normalized:
                        return normalized
                return {"status": "ok", "endpoint": endpoint, "payload": response}
            except Exception as exc:  # pragma: no cover - fallback for unknown API layout
                last_error = exc
                continue

        if last_error:
            raise last_error
        raise RuntimeError("Vanva video generation endpoint could not be reached.")

    def get_job_status(self, job_id: str) -> Dict[str, Any]:
        if not job_id:
            raise ValueError("A job_id is required to query Vanva status.")

        for endpoint in [f"/v1/jobs/{job_id}", f"/v1/video/jobs/{job_id}"]:
            try:
                response = self._request_json("GET", endpoint)
                if isinstance(response, dict):
                    return response
            except Exception:
                continue

        raise RuntimeError(f"Could not retrieve Vanva status for job {job_id}.")

    def download_video(self, video_url: str, destination: Optional[str] = None) -> Path:
        if not video_url:
            raise ValueError("A valid Vanva video URL is required.")

        response = requests.get(video_url, timeout=self.timeout, allow_redirects=True)
        response.raise_for_status()

        target = Path(destination) if destination else Path("vanva_video.mp4")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(response.content)
        return target


class VanvaVideoGenerator:
    """Convenience wrapper for creating a local MP4 from a prompt with an optional download step."""

    def __init__(self, api_key: Optional[str] = None, base_url: Optional[str] = None, timeout: int = 60):
        self.client = VanvaClient(api_key=api_key, base_url=base_url, timeout=timeout)

    def create(
        self,
        prompt: str,
        duration: int = 8,
        output_dir: Optional[str] = None,
        download: bool = False,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        result = self.client.generate_video(prompt=prompt, duration=duration, output_dir=output_dir, **kwargs)

        if download:
            video_url = result.get("video_url") or result.get("url") or result.get("output")
            if isinstance(video_url, str) and video_url.startswith("http"):
                path = self.client.download_video(video_url, destination=str(Path(output_dir or ".") / "vanva_output.mp4"))
                result["local_path"] = str(path)
        return result
