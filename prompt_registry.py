import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional


@dataclass
class PromptVersion:
    name: str
    version: str
    prompt: str
    metadata: Dict[str, Any]
    score: float = 0.0
    status: str = "draft"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "version": self.version,
            "prompt": self.prompt,
            "metadata": self.metadata,
            "score": self.score,
            "status": self.status,
        }


class PromptRegistry:
    """A simple prompt registry with versioning, eval scoring, and production promotion."""

    def __init__(self, path: Optional[str] = None):
        self.path = Path(path or "prompt_registry.json")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.path.write_text("{}", encoding="utf-8")

    def _load(self) -> Dict[str, Any]:
        try:
            return json.loads(self.path.read_text(encoding="utf-8") or "{}")
        except json.JSONDecodeError:
            self.path.write_text("{}", encoding="utf-8")
            return {}

    def _save(self, registry: Dict[str, Any]) -> None:
        self.path.write_text(json.dumps(registry, indent=2), encoding="utf-8")

    def _next_version(self, name: str) -> str:
        registry = self._load()
        versions = registry.get(name, {}).get("versions", [])
        if not versions:
            return "v1"
        last = versions[-1]["version"]
        try:
            num = int(last.lstrip("v")) + 1
        except ValueError:
            return "v1"
        return f"v{num}"

    def evaluate_prompt(self, prompt: str, context: Optional[Dict[str, Any]] = None) -> float:
        context = context or {}
        text = (prompt or "").lower()
        score = 0.0

        if "hook" in text or "stop-the-scroll" in text:
            score += 30
        if "cta" in text or "follow for more" in text:
            score += 20
        if "9:16" in text:
            score += 15
        if "startup" in text or "founders" in text:
            score += 15
        if "premium" in text or "cinematic" in text:
            score += 10
        if "clarity" in text or "payoff" in text:
            score += 10
        if context.get("topic") and context["topic"].lower() in text:
            score += 10
        if context.get("audience") and context["audience"].lower() in text:
            score += 10
        if context.get("angle") and context["angle"].lower() in text:
            score += 10

        return round(score, 2)

    def register_prompt(self, name: str, prompt: str, metadata: Optional[Dict[str, Any]] = None, score: Optional[float] = None) -> Dict[str, Any]:
        registry = self._load()
        metadata = metadata or {}
        version = self._next_version(name)
        version_score = score if score is not None else self.evaluate_prompt(prompt, metadata)
        entry = PromptVersion(name=name, version=version, prompt=prompt, metadata=metadata, score=version_score, status="draft")

        if name not in registry:
            registry[name] = {"versions": [], "prod": None}
        registry[name]["versions"].append(entry.to_dict())
        self._save(registry)
        return entry.to_dict()

    def list_versions(self, name: str) -> List[Dict[str, Any]]:
        return self._load().get(name, {}).get("versions", [])

    def get_prod(self, name: str) -> Optional[Dict[str, Any]]:
        registry = self._load()
        return registry.get(name, {}).get("prod")

    def promote_to_prod(self, name: str, version: Optional[str] = None) -> Dict[str, Any]:
        registry = self._load()
        versions = registry.get(name, {}).get("versions", [])
        if not versions:
            raise ValueError(f"No prompt versions exist for {name}.")

        target = next((item for item in versions if item["version"] == version), None) if version else max(versions, key=lambda item: item["score"])
        if target is None:
            raise ValueError(f"Version {version} not found for {name}.")

        target["status"] = "prod"
        registry[name]["prod"] = target
        for item in versions:
            if item["version"] != target["version"]:
                item["status"] = "draft"
        self._save(registry)
        return target

    def clear(self) -> None:
        self.path.write_text("{}", encoding="utf-8")


if __name__ == "__main__":
    registry = PromptRegistry()
    prompt = "Create a 45-second viral short-form video for startup founders with a sharp hook and powerful CTA."
    entry = registry.register_prompt("viral_prompt", prompt, {"topic": "AI for founders", "audience": "startup founders", "angle": "counterintuitive business leverage"})
    print(json.dumps(entry, indent=2))
    print(json.dumps(registry.promote_to_prod("viral_prompt"), indent=2))
