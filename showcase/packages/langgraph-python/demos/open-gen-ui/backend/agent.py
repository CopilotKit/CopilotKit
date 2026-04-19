"""LangGraph agent for the Open-Ended Generative UI demo.

The CopilotKit frontend wires up the built-in
`OpenGenerativeUIActivityRenderer` which subscribes to `activity` messages
of type `"open-generative-ui"`. Those activity events are produced by the
runtime's `OpenGenerativeUIMiddleware` whenever it sees a streaming tool
call named `generateSandboxedUi` — the middleware converts the tool-call
argument stream into `ACTIVITY_SNAPSHOT` / `ACTIVITY_DELTA` events.

For this demo we do NOT rely on a secondary LLM to author the UI. The
graph dispatches ONE `copilotkit_manually_emit_tool_call` custom event
carrying a tiny hand-authored bundle (html + css). The CopilotKit
LangGraph adapter turns that into the expected AG-UI
TOOL_CALL_START / _ARGS / _END sequence, and the runtime middleware
converts it into `open-generative-ui` activity events.

This keeps the demo deterministic and visibly working without depending
on model capability or prompt engineering.
"""

from __future__ import annotations

import json
import uuid
from typing import Any, List

from langchain_core.callbacks.manager import adispatch_custom_event
from langchain_core.messages import AIMessage, BaseMessage, ToolMessage
from langgraph.graph import END, START, MessagesState, StateGraph

TOOL_NAME = "generateSandboxedUi"


def _build_bundle(user_prompt: str) -> dict[str, Any]:
    """A tiny hand-authored UI bundle.

    Uses the parameter shape the runtime middleware parses out of the
    `generateSandboxedUi` tool call: { initialHeight, css, html,
    placeholderMessages }.
    """
    prompt_preview = (user_prompt or "your request").strip().replace("\n", " ")
    if len(prompt_preview) > 120:
        prompt_preview = prompt_preview[:117] + "..."

    css = (
        ".ck-card{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',"
        "Roboto,sans-serif;background:linear-gradient(135deg,#6366f1,#8b5cf6);"
        "color:#fff;padding:20px 24px;border-radius:12px;"
        "box-shadow:0 10px 30px rgba(99,102,241,.3)}"
        ".ck-card h1{margin:0 0 8px 0;font-size:22px;font-weight:700}"
        ".ck-card p{margin:0;font-size:14px;opacity:.92;line-height:1.5}"
        ".ck-card .ck-tag{display:inline-block;margin-top:12px;padding:4px 10px;"
        "background:rgba(255,255,255,.2);border-radius:999px;font-size:12px}"
    )
    html = (
        '<div class="ck-card">'
        "<h1>Hello from Open Generative UI</h1>"
        f"<p>You asked: <em>{_html_escape(prompt_preview)}</em></p>"
        '<span class="ck-tag">sandboxed &middot; agent-authored</span>'
        "</div>"
    )
    return {
        "initialHeight": 180,
        "placeholderMessages": ["Building your UI..."],
        "css": css,
        "html": html,
    }


def _html_escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _last_user_text(messages: List[BaseMessage]) -> str:
    for msg in reversed(messages):
        if getattr(msg, "type", None) == "human":
            content = msg.content
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                parts: List[str] = []
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "text":
                        parts.append(str(block.get("text", "")))
                    elif isinstance(block, str):
                        parts.append(block)
                return "".join(parts)
    return ""


async def _call_model(state: MessagesState) -> dict:
    """Dispatch ONE `generateSandboxedUi` tool call via the CopilotKit adapter.

    `copilotkit_manually_emit_tool_call` is the CopilotKit-specific custom
    event handled by `@copilotkit/runtime/langgraph` — it fans out into the
    AG-UI TOOL_CALL_START / _ARGS / _END sequence which the runtime's
    `OpenGenerativeUIMiddleware` turns into activity events.

    The CopilotKit frontend registers a built-in `generateSandboxedUi`
    frontend tool with `followUp: true` whenever `openGenerativeUI` is on.
    That means after we emit the tool call, the client executes a
    placeholder handler and posts a `ToolMessage` back, re-invoking the
    graph. We must detect that follow-up turn and END without re-emitting,
    otherwise the demo loops forever and renders N duplicate cards.
    """
    messages = state["messages"]
    if any(isinstance(m, ToolMessage) for m in messages):
        # Follow-up turn after the client acknowledged the generated UI.
        # Nothing more to do — end the run so the user can send a new prompt.
        return {"messages": []}

    user_text = _last_user_text(messages)
    bundle = _build_bundle(user_text)
    tool_call_id = f"tc-{uuid.uuid4().hex[:12]}"

    await adispatch_custom_event(
        "copilotkit_manually_emit_tool_call",
        {
            "id": tool_call_id,
            "name": TOOL_NAME,
            "args": json.dumps(bundle),
        },
    )

    # Persist a completed AIMessage to conversation state so the checkpoint
    # is consistent. The tool is not actually executed — the middleware
    # converts the event stream into an activity message on the wire.
    persisted = AIMessage(
        content="",
        tool_calls=[
            {
                "name": TOOL_NAME,
                "args": bundle,
                "id": tool_call_id,
                "type": "tool_call",
            }
        ],
    )
    return {"messages": [persisted]}


_builder = StateGraph(MessagesState)
_builder.add_node("call_model", _call_model)
_builder.add_edge(START, "call_model")
_builder.add_edge("call_model", END)

graph = _builder.compile()
