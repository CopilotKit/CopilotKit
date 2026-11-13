"""
Backlog analysis tool.

Emits step-by-step progress via copilotkit_emit_state so the frontend can
render a "thinking" timeline. The frontend subscribes to agent.state.analysis
and animates step transitions.
"""

import asyncio
from typing import Any, cast

from langchain.tools import ToolRuntime, tool

from copilotkit.langgraph import copilotkit_emit_state  # type: ignore


@tool
async def analyze_backlog(focus: str, runtime: ToolRuntime) -> str:
    """
    Deeply analyze the current backlog. `focus` is a short string describing
    what the user wants ("what should we cut?", "what's blocking ship?",
    "prioritize for next sprint").

    Streams step-by-step progress to the frontend via shared state. The
    frontend renders an animated timeline alongside the chat.

    Use this when the user asks an open-ended analytical question about the
    board. For simple queries (list / move / edit), use the direct tools
    instead — analyze_backlog is meant to look visibly thoughtful.
    """
    state = runtime.state if runtime.state else {}
    issues = state.get("issues", [])
    config = cast(Any, runtime).config if hasattr(runtime, "config") else {}

    # Step 1 — reading
    await copilotkit_emit_state(
        config,
        {
            "analysis": {
                "step": "reading",
                "label": "Reading issues",
                "count": len(issues),
                "focus": focus,
            }
        },
    )
    await asyncio.sleep(0.8)

    # Step 2 — categorize by status
    by_status: dict[str, int] = {}
    for issue in issues:
        s = issue.get("status", "Backlog")
        by_status[s] = by_status.get(s, 0) + 1
    await copilotkit_emit_state(
        config,
        {
            "analysis": {
                "step": "categorizing",
                "label": "Categorizing by status",
                "by_status": by_status,
            }
        },
    )
    await asyncio.sleep(0.8)

    # Step 3 — identify blockers
    urgent = [i for i in issues if i.get("priority") == "Urgent"]
    high = [i for i in issues if i.get("priority") == "High"]
    await copilotkit_emit_state(
        config,
        {
            "analysis": {
                "step": "identifying_blockers",
                "label": "Identifying blockers",
                "urgent_count": len(urgent),
                "high_count": len(high),
                "urgent_ids": [i.get("id") for i in urgent[:5]],
            }
        },
    )
    await asyncio.sleep(0.8)

    # Step 4 — drafting plan
    await copilotkit_emit_state(
        config,
        {
            "analysis": {
                "step": "drafting_plan",
                "label": "Drafting recommendation",
            }
        },
    )
    await asyncio.sleep(0.6)

    summary_lines = []
    if urgent:
        summary_lines.append(
            f"{len(urgent)} urgent: " + ", ".join(i.get("id", "?") for i in urgent[:5])
        )
    if high:
        summary_lines.append(
            f"{len(high)} high: " + ", ".join(i.get("id", "?") for i in high[:5])
        )
    summary_lines.append(
        "Status distribution: "
        + ", ".join(f"{k}={v}" for k, v in by_status.items())
    )
    plan = "\n".join(summary_lines)

    await copilotkit_emit_state(
        config,
        {
            "analysis": {
                "step": "done",
                "label": "Done",
                "plan": plan,
                "by_status": by_status,
                "urgent_count": len(urgent),
                "high_count": len(high),
            }
        },
    )

    return plan
