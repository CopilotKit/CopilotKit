"""Minimal LangGraph agent for the Open-Ended Generative UI demo.

This is the simplest possible example that exercises the open-ended
generative UI pipeline. All the interesting work happens in the
CopilotKit runtime middleware (enabled via `openGenerativeUI` on the
runtime): it converts a streamed `generateSandboxedUi` tool call into
`open-generative-ui` activity events that the built-in renderer mounts
inside a sandboxed iframe.

We don't rely on a real LLM here — the graph deterministically emits ONE
hand-authored UI bundle via `copilotkit_manually_emit_tool_call`, so the
demo is visibly working without any API keys. The "advanced" sibling
cell (`open-gen-ui-advanced`) adds sandbox functions and app-side tool
calling on top of this same base.
"""

from __future__ import annotations

import json
import uuid
from typing import List

from langchain_core.callbacks.manager import adispatch_custom_event
from langchain_core.messages import AIMessage, BaseMessage, ToolMessage
from langgraph.graph import END, START, MessagesState, StateGraph

TOOL_NAME = "generateSandboxedUi"

# A tiny hand-authored UI bundle. The parameter shape is what the
# runtime middleware parses out of the `generateSandboxedUi` tool call:
# { initialHeight, css, html, placeholderMessages }.
BUNDLE = {
    "initialHeight": 140,
    "placeholderMessages": ["Building your UI..."],
    "css": (
        ".card{font-family:-apple-system,BlinkMacSystemFont,sans-serif;"
        "background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;"
        "padding:20px 24px;border-radius:12px;text-align:center}"
        ".card h1{margin:0 0 6px 0;font-size:20px}"
        ".card p{margin:0;font-size:14px;opacity:.9}"
    ),
    "html": (
        '<div class="card">'
        "<h1>Hello!</h1>"
        "<p>Agent-authored UI, rendered inside a sandboxed iframe.</p>"
        "</div>"
    ),
}


async def _call_model(state: MessagesState) -> dict:
    messages: List[BaseMessage] = state["messages"]

    # Follow-up turn after the client acknowledged the generated UI —
    # end without re-emitting, otherwise the demo loops forever.
    if any(isinstance(m, ToolMessage) for m in messages):
        return {"messages": []}

    tool_call_id = f"tc-{uuid.uuid4().hex[:12]}"

    await adispatch_custom_event(
        "copilotkit_manually_emit_tool_call",
        {
            "id": tool_call_id,
            "name": TOOL_NAME,
            "args": json.dumps(BUNDLE),
        },
    )

    persisted = AIMessage(
        content="",
        tool_calls=[
            {
                "name": TOOL_NAME,
                "args": BUNDLE,
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
