"""Local LangGraph orchestration for the clipping and localization pipeline."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, TypedDict

from langgraph.graph import END, START, StateGraph

from clipping import (
    CampaignConfig,
    DEFAULT_EXTRACTION_PROMPT,
    MasterClippingPipeline,
    SYSTEM_PROMPT,
    VIRAL_CLIP_AGENT_COMMAND,
)


class WorkflowState(TypedDict, total=False):
    source: str
    campaign: str
    output_dir: str
    languages: List[str]
    platforms: List[str]
    prompt: str
    cookies_from_browser: Optional[str]
    js_runtime: Optional[str]
    plan: Dict[str, Any]
    exported_files: List[str]
    report: Dict[str, Any]
    error: str


def plan_agent(state: WorkflowState) -> WorkflowState:
    languages = state.get("languages") or ["en", "de", "fr", "pt", "es", "ja", "ar"]
    platforms = state.get("platforms") or [
        "TikTok", "Instagram Reels", "YouTube Shorts", "Facebook Reels", "Bilibili"
    ]
    return {
        **state,
        "languages": languages,
        "platforms": platforms,
        "prompt": state.get("prompt") or DEFAULT_EXTRACTION_PROMPT,
        "plan": {
            "agents": ["viral_clip_strategist", "planner", "clipper", "localizer", "reporter"],
            "agent_command": VIRAL_CLIP_AGENT_COMMAND,
            "system_prompt": SYSTEM_PROMPT,
            "source": state["source"],
            "languages": languages,
            "platforms": platforms,
            "free_tier_only": True,
        },
    }


def clipping_agent(state: WorkflowState) -> WorkflowState:
    config = CampaignConfig(
        campaign_name=state.get("campaign", "DefaultCampaign"),
        output_dir=Path(state.get("output_dir", "./output_clips")),
        target_languages=state["languages"],
        target_platforms=state["platforms"],
        subtitle_enabled=True,
        dubbing_enabled=True,
    )
    pipeline = MasterClippingPipeline(config)
    exported = pipeline.run(
        state["source"],
        prompt=state["prompt"],
        cookies_from_browser=state.get("cookies_from_browser"),
        js_runtime=state.get("js_runtime"),
    )
    return {**state, "exported_files": [str(path) for path in exported]}


def report_agent(state: WorkflowState) -> WorkflowState:
    report = {
        "status": "completed" if state.get("exported_files") else "no_exports",
        "source": state.get("source"),
        "exported_files": state.get("exported_files", []),
        "languages": state.get("languages", []),
        "platforms": state.get("platforms", []),
        "plan": state.get("plan", {}),
    }
    output_dir = Path(state.get("output_dir", "./output_clips"))
    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / "agent_workflow_report.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return {**state, "report": {**report, "path": str(report_path)}}


def build_workflow():
    graph = StateGraph(WorkflowState)
    graph.add_node("planner", plan_agent)
    graph.add_node("clipper", clipping_agent)
    graph.add_node("reporter", report_agent)
    graph.add_edge(START, "planner")
    graph.add_edge("planner", "clipper")
    graph.add_edge("clipper", "reporter")
    graph.add_edge("reporter", END)
    return graph.compile()


def run_agent_workflow(
    source: str,
    campaign: str = "DefaultCampaign",
    output_dir: str = "./output_clips",
    languages: Optional[List[str]] = None,
    platforms: Optional[List[str]] = None,
    cookies_from_browser: Optional[str] = None,
    js_runtime: Optional[str] = None,
) -> WorkflowState:
    workflow = build_workflow()
    return workflow.invoke({
        "source": source,
        "campaign": campaign,
        "output_dir": output_dir,
        "languages": languages or [],
        "platforms": platforms or [],
        "cookies_from_browser": cookies_from_browser,
        "js_runtime": js_runtime,
    })


def main() -> None:
    parser = argparse.ArgumentParser(description="LangGraph agent orchestrator for the clipping system")
    parser.add_argument("--url", required=True, help="Video URL or local source file")
    parser.add_argument("--campaign", default="DefaultCampaign")
    parser.add_argument("--outdir", default="./output_clips")
    parser.add_argument("--languages", default="en,de,fr,pt,es,ja,ar")
    parser.add_argument("--platforms", default="TikTok,Instagram Reels,YouTube Shorts,Facebook Reels,Bilibili")
    parser.add_argument("--cookies-from-browser")
    parser.add_argument("--js-runtime")
    args = parser.parse_args()
    result = run_agent_workflow(
        source=args.url,
        campaign=args.campaign,
        output_dir=args.outdir,
        languages=[item.strip() for item in args.languages.split(",") if item.strip()],
        platforms=[item.strip() for item in args.platforms.split(",") if item.strip()],
        cookies_from_browser=args.cookies_from_browser,
        js_runtime=args.js_runtime,
    )
    print(json.dumps(result.get("report", result), indent=2))


if __name__ == "__main__":
    main()
