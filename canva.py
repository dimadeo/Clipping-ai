import json
import os
from typing import Any, Dict, Optional
from urllib import request, error


class CanvaClient:
    """Minimal Canva REST API client for creating design assets from templates."""

    def __init__(self, access_token: Optional[str] = None, base_url: Optional[str] = None, timeout: int = 60):
        self.access_token = access_token or os.getenv("CANVA_ACCESS_TOKEN")
        self.base_url = (base_url or os.getenv("CANVA_BASE_URL") or "https://api.canva.com/rest/v1").rstrip("/")
        self.timeout = timeout

    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if self.access_token:
            headers["Authorization"] = f"Bearer {self.access_token}"
        return headers

    def _request(self, method: str, path: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        if not self.access_token:
            raise ValueError("CANVA_ACCESS_TOKEN is required to call Canva APIs.")

        url = f"{self.base_url}{path}"
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        req = request.Request(url, data=body, headers=self._headers(), method=method)
        try:
            with request.urlopen(req, timeout=self.timeout) as response:
                raw = response.read()
        except error.HTTPError as exc:
            body_text = exc.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"Canva API request failed for {method.upper()} {url}: {body_text}") from exc

        if not raw:
            return {}
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {"raw": raw.decode("utf-8", errors="ignore")}

        if isinstance(parsed, dict) and "data" in parsed and isinstance(parsed["data"], dict):
            return parsed["data"]
        return parsed

    def create_design(
        self,
        template_id: Optional[str] = None,
        title: str = "Untitled design",
        page_count: int = 1,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        template_id = template_id or os.getenv("CANVA_TEMPLATE_ID")
        if not template_id:
            raise ValueError("template_id is required. Set CANVA_TEMPLATE_ID or pass template_id explicitly.")

        payload = {
            "template_id": template_id,
            "title": title,
            "page_count": page_count,
            **kwargs,
        }
        return self._request("POST", "/designs", payload)

    def get_design(self, design_id: str) -> Dict[str, Any]:
        if not design_id:
            raise ValueError("design_id is required.")
        return self._request("GET", f"/designs/{design_id}")

    def export_design(self, design_id: str, format: str = "pdf") -> Dict[str, Any]:
        if not design_id:
            raise ValueError("design_id is required.")
        return self._request("POST", f"/designs/{design_id}/exports", {"format": format})
