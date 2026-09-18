"""Production LangGraph workflow for deterministic viral prompt production.

The graph keeps orchestration decisions in nodes and edges. External actions are
isolated behind typed tools and an idempotent action boundary.
"""

from __future__ import annotations

import hashlib
import json
import operator
import threading
import time
from pathlib import Path
from typing import Annotated, Any, Dict, List, Optional, TypedDict

from langchain_core.messages import AnyMessage
from langchain_core.tools import tool
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.types import Command, Send, interrupt

from midjourney import MidjourneyClient
from prompt_registry import PromptRegistry


CHECKPOINTER = MemorySaver()


class PromptTask(TypedDict):
    niche: str
    trigger: str
    index: int


class PromptCandidate(TypedDict):
    title: str
    prompt: str
    angle: str
    niche: str
    trigger: str
    score: float


class ProductionState(TypedDict, total=False):
    # Reducers make concurrent worker updates deterministic at graph merge points.
    messages: Annotated[List[AnyMessage], add_messages]
    topic: str
    audience: str
    angle: str
    cta: str
    count: int
    render_enabled: bool
    require_approval: bool
    max_retries: int
    retry_delay_seconds: float
    tasks: List[PromptTask]
    current_task: PromptTask
    candidates: Annotated[List[PromptCandidate], operator.add]
    ranked_candidates: List[PromptCandidate]
    winner: PromptCandidate
    release: Dict[str, Any]
    render_job: Dict[str, Any]
    approval: Dict[str, Any]
    errors: Annotated[List[str], operator.add]
    status: str
    idempotency_key: str


class IdempotentRenderAction:
    """Submit a render once per key and cache the accepted job response on disk."""

    _lock = threading.Lock()

    def __init__(self, cache_path: str = "render_idempotency.json"):
        self.path = Path(cache_path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def _load(self) -> Dict[str, Any]:
        if not self.path.exists():
            return {}
        try:
            return json.loads(self.path.read_text(encoding="utf-8") or "{}")
        except json.JSONDecodeError:
            return {}

    def execute(
        self,
        prompt: str,
        idempotency_key: str,
        duration_sec: int,
        aspect_ratio: str,
        max_retries: int,
        retry_delay_seconds: float,
    ) -> Dict[str, Any]:
        with self._lock:
            cache = self._load()
            if idempotency_key in cache:
                return {**cache[idempotency_key], "cached": True}

            client = MidjourneyClient()
            last_error: Optional[Exception] = None
            for attempt in range(max(0, max_retries) + 1):
                try:
                    response = client.generate(
                        prompt=prompt,
                        duration_sec=duration_sec,
                        aspect_ratio=aspect_ratio,
                        idempotency_key=idempotency_key,
                    )
                    cache[idempotency_key] = {
                        "idempotency_key": idempotency_key,
                        "attempts": attempt + 1,
                        "response": response,
                    }
                    self.path.write_text(json.dumps(cache, indent=2), encoding="utf-8")
                    return cache[idempotency_key]
                except Exception as exc:
                    last_error = exc
                    if attempt < max_retries:
                        time.sleep(retry_delay_seconds * (2**attempt))
            raise RuntimeError(f"Render action failed after retries: {last_error}") from last_error


@tool
def validate_prompt_request(topic: str, audience: str, angle: str, cta: str) -> Dict[str, str]:
    """Validate required prompt inputs before workers spend compute or call external tools."""
    values = {"topic": topic.strip(), "audience": audience.strip(), "angle": angle.strip(), "cta": cta.strip()}
    missing = [name for name, value in values.items() if not value]
    if missing:
        raise ValueError(f"Missing required prompt fields: {', '.join(missing)}")
    return values


@tool
def create_idempotency_key(prompt: str, topic: str, audience: str, angle: str) -> str:
    """Create a stable key so retries cannot submit the same render twice."""
    material = "|".join((prompt, topic, audience, angle))
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def planner_node(state: ProductionState) -> Dict[str, Any]:
    """Parent agent validates input and delegates independent prompt scopes."""
    values = validate_prompt_request.invoke({
        "topic": state.get("topic", ""),
        "audience": state.get("audience", ""),
        "angle": state.get("angle", ""),
        "cta": state.get("cta", ""),
    })
    patterns = [
        ("AI & Tech Breakthroughs", "FOMO"),
        ("Founder & Business Strategy", "Curiosity Gap"),
        ("Psychology & Human Behavior", "Ego Validation"),
        ("Personal Finance & Wealth", "High-Utility Outrage"),
        ("Creator Economy", "FOMO"),
    ]
    count = max(1, min(int(state.get("count", 5)), len(patterns)))
    tasks = [
        {"niche": niche, "trigger": trigger, "index": index}
        for index, (niche, trigger) in enumerate(patterns[:count], start=1)
    ]
    return {
        **values,
        "count": count,
        "tasks": tasks,
        "status": "planned",
        "messages": [{"role": "system", "content": f"Delegated {len(tasks)} prompt workers."}],
    }


def fan_out_candidates(state: ProductionState) -> List[Send]:
    """Fan out one stateless worker per niche/trigger pair."""
    worker_context = {
        "topic": state["topic"],
        "audience": state["audience"],
        "angle": state["angle"],
        "cta": state["cta"],
    }
    return [Send("candidate_worker", {**worker_context, "current_task": task}) for task in state.get("tasks", [])]


def candidate_worker_node(state: ProductionState) -> Dict[str, Any]:
    """Generate one candidate; only return fields owned by this worker."""
    task = state["current_task"]
    prompt = (
        f"Create a 45-second viral short-form video in 9:16 vertical format for TikTok, Reels, and Shorts. "
        f"Topic: {state['topic']}. Audience: {state['audience']}. Angle: {state['angle']}. "
        f"Niche: {task['niche']}. Trigger: {task['trigger']}. "
        f"Open with a bold stop-the-scroll hook in the first 1-2 seconds, show a fast premium visual story, "
        f"deliver a surprising payoff, and end with a strong CTA: {state['cta']}."
    )
    candidate: PromptCandidate = {
        "title": f"{task['niche']} - {task['trigger']} - {task['index']}",
        "prompt": prompt,
        "angle": state["angle"],
        "niche": task["niche"],
        "trigger": task["trigger"],
        "score": round(9.0 + (task["index"] - 1) * 0.2, 2),
    }
    return {
        "candidates": [candidate],
        "messages": [{"role": "assistant", "content": f"Worker completed {candidate['title']}"}],
    }


def rank_node(state: ProductionState) -> Dict[str, Any]:
    """Merge fan-out results and select a deterministic winner."""
    candidates = sorted(state.get("candidates", []), key=lambda item: (-item["score"], item["title"]))
    if not candidates:
        return {"errors": ["No prompt candidates were produced."], "status": "failed"}
    winner = candidates[0]
    key = create_idempotency_key.invoke({
        "prompt": winner["prompt"],
        "topic": state["topic"],
        "audience": state["audience"],
        "angle": state["angle"],
    })
    return {
        "ranked_candidates": candidates,
        "winner": winner,
        "idempotency_key": key,
        "status": "ranked",
    }


def approval_node(state: ProductionState) -> Dict[str, Any]:
    """Pause before the production registry mutation or paid render action."""
    if not state.get("require_approval", False):
        return {"approval": {"approved": True, "source": "automatic_policy"}}
    decision = interrupt({
        "type": "production_approval",
        "message": "Approve promotion and optional render for the selected prompt.",
        "winner": state["winner"],
        "estimated_external_action": bool(state.get("render_enabled")),
    })
    approved = decision is True or decision == "approve" or (isinstance(decision, dict) and decision.get("approved") is True)
    if not approved:
        return {"approval": {"approved": False, "decision": decision}, "status": "rejected"}
    return {"approval": {"approved": True, "decision": decision}}


def release_node(state: ProductionState) -> Dict[str, Any]:
    """Promote the winner only after the approval gate has passed."""
    if not state.get("approval", {}).get("approved"):
        return {"status": "rejected"}
    registry = PromptRegistry()
    metadata = {
        "topic": state["topic"],
        "audience": state["audience"],
        "angle": state["angle"],
        "cta": state["cta"],
        "niche": state["winner"]["niche"],
        "trigger": state["winner"]["trigger"],
    }
    score = registry.evaluate_prompt(state["winner"]["prompt"], metadata)
    entry = registry.register_prompt("viral_master_prod_prompt", state["winner"]["prompt"], metadata=metadata, score=score)
    promoted = registry.promote_to_prod("viral_master_prod_prompt", version=entry["version"])
    return {"release": promoted, "status": "released"}


def render_node(state: ProductionState) -> Dict[str, Any]:
    """Execute the external render through the idempotent, retrying action boundary."""
    if not state.get("render_enabled"):
        return {"status": "completed"}
    try:
        result = IdempotentRenderAction().execute(
            prompt=state["release"]["prompt"],
            idempotency_key=state["idempotency_key"],
            duration_sec=45,
            aspect_ratio="9:16",
            max_retries=state.get("max_retries", 2),
            retry_delay_seconds=state.get("retry_delay_seconds", 2.0),
        )
        return {"render_job": result, "status": "completed"}
    except Exception as exc:
        return {"errors": [f"Render failed: {exc}"], "status": "failed"}


def route_after_approval(state: ProductionState) -> str:
    return "release" if state.get("approval", {}).get("approved") else "finish"


def route_after_release(state: ProductionState) -> str:
    return "render" if state.get("render_enabled") else "finish"


def build_production_workflow():
    """Compile the graph with a checkpointer so interrupted runs can resume."""
    graph = StateGraph(ProductionState)
    graph.add_node("planner", planner_node)
    graph.add_node("candidate_worker", candidate_worker_node)
    graph.add_node("ranker", rank_node)
    graph.add_node("approval_gate", approval_node)
    graph.add_node("release", release_node)
    graph.add_node("render", render_node)
    graph.add_node("finish", lambda state: {"status": state.get("status", "completed")})
    graph.add_edge(START, "planner")
    graph.add_conditional_edges("planner", fan_out_candidates, ["candidate_worker"])
    graph.add_edge("candidate_worker", "ranker")
    graph.add_edge("ranker", "approval_gate")
    graph.add_conditional_edges("approval_gate", route_after_approval, {"release": "release", "finish": "finish"})
    graph.add_conditional_edges("release", route_after_release, {"render": "render", "finish": "finish"})
    graph.add_edge("render", "finish")
    graph.add_edge("finish", END)
    return graph.compile(checkpointer=CHECKPOINTER)


def run_production_workflow(
    topic: str,
    audience: str,
    angle: str,
    cta: str = "Follow for more",
    count: int = 5,
    render: bool = False,
    require_approval: bool = False,
    max_retries: int = 2,
    retry_delay_seconds: float = 2.0,
    thread_id: str = "viral-production",
) -> ProductionState:
    """Run the graph; use resume_production_workflow for approval-required runs."""
    workflow = build_production_workflow()
    return workflow.invoke(
        {
            "topic": topic,
            "audience": audience,
            "angle": angle,
            "cta": cta,
            "count": count,
            "render_enabled": render,
            "require_approval": require_approval,
            "max_retries": max_retries,
            "retry_delay_seconds": retry_delay_seconds,
        },
        config={"configurable": {"thread_id": thread_id}},
    )


def resume_production_workflow(thread_id: str, decision: Any) -> ProductionState:
    """Resume an interrupted approval gate with an explicit human decision."""
    workflow = build_production_workflow()
    return workflow.invoke(Command(resume=decision), config={"configurable": {"thread_id": thread_id}})
