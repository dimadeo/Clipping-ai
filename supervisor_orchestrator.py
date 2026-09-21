"""Tool-calling supervisor graph for optional LLM-driven orchestration."""

from __future__ import annotations

import json
import os
from typing import Annotated, Literal, TypedDict
from urllib.parse import quote_plus
from urllib.request import Request, urlopen

from dotenv import load_dotenv
from langchain_anthropic import ChatAnthropic
from langchain_openai import ChatOpenAI
from langchain_core.messages import BaseMessage
from langchain_core.tools import tool
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode


load_dotenv()


class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    current_worker: str


@tool
def web_search(query: str) -> str:
    """Search DuckDuckGo for fresh public web results matching a concise query."""
    normalized_query = query.strip()
    if not normalized_query:
        raise ValueError("query must not be empty")

    url = f"https://api.duckduckgo.com/?q={quote_plus(normalized_query)}&format=json&no_html=1"
    request = Request(url, headers={"User-Agent": "FineArtOps/1.0"})
    with urlopen(request, timeout=10) as response:
        payload = json.loads(response.read().decode("utf-8"))

    results = []
    if payload.get("AbstractText"):
        results.append(payload["AbstractText"])
    for item in payload.get("RelatedTopics", [])[:5]:
        if isinstance(item, dict) and item.get("Text"):
            results.append(item["Text"])
    return "\n".join(results) or "No results found."


def supervisor_node(state: AgentState):
    """Ask the model to answer or request one of the declared tools."""
    configured_provider = os.getenv("LLM_PROVIDER", "").strip().lower()
    provider = configured_provider or (
        "openai" if os.getenv("OPENAI_API_KEY") else "anthropic"
    )
    if provider == "openai":
        model = ChatOpenAI(
            model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            temperature=0,
        )
    elif provider == "anthropic":
        model = ChatAnthropic(
            model=os.getenv("ANTHROPIC_MODEL", "claude-3-7-sonnet-latest"),
            temperature=0,
        )
    else:
        raise ValueError(
            f"Unsupported LLM_PROVIDER={provider!r}; use 'openai' or 'anthropic'."
        )
    response = model.bind_tools([web_search]).invoke(state["messages"])
    return {
        "messages": [response],
        "current_worker": "supervisor",
    }


def router_edge(state: AgentState) -> Literal["tools", "__end__"]:
    """Route tool calls to ToolNode; finish when the model returns a final answer."""
    last_message = state["messages"][-1]
    return "tools" if getattr(last_message, "tool_calls", None) else "__end__"


_CHECKPOINTER = MemorySaver()
_TOOLS = [web_search]


def build_supervisor_graph():
    """Compile the supervisor graph with resumable in-memory checkpoints."""
    builder = StateGraph(AgentState)
    builder.add_node("supervisor", supervisor_node)
    builder.add_node("tools", ToolNode(_TOOLS))
    builder.add_edge(START, "supervisor")
    builder.add_conditional_edges(
        "supervisor",
        router_edge,
        {"tools": "tools", "__end__": END},
    )
    builder.add_edge("tools", "supervisor")
    return builder.compile(checkpointer=_CHECKPOINTER)


def run_supervisor(messages: list[BaseMessage], thread_id: str = "supervisor-default") -> AgentState:
    """Run the supervisor and its tools using a stable conversation thread."""
    graph = build_supervisor_graph()
    return graph.invoke(
        {"messages": messages, "current_worker": "supervisor"},
        config={"configurable": {"thread_id": thread_id}},
    )
