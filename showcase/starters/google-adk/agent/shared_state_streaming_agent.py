"""Agent backing the State Streaming demo.

The agent writes a long `document` string into shared agent state via a
`write_document` tool. PredictStateMapping (declared on the ADKAgent
middleware in registry.py) tells ag_ui_adk to emit STATE_DELTA events
forwarding every token of `write_document.content` straight into
state["document"], so the UI sees the document grow token-by-token
without waiting for the tool call to complete.

`stream_function_call_arguments=True` on the model + the predict_state
mapping below produces the per-token streaming behaviour. This matches
langgraph-python's StateStreamingMiddleware setup.
"""

from __future__ import annotations

from ag_ui_adk.config import PredictStateMapping
from google.adk.agents import LlmAgent
from google.adk.tools import ToolContext
from google.genai import types

def write_document(tool_context: ToolContext, content: str) -> dict:
    """Write a document into shared state.

    Whenever the user asks you to write or draft anything (essay, poem,
    email, summary, etc.), call this tool with the full content as a
    single string. The UI renders state["document"] live as you type.
    """
    tool_context.state["document"] = content
    return {"status": "ok", "length": len(content)}

_INSTRUCTION = (
    "You are a collaborative writing assistant. Whenever the user asks "
    "you to write, draft, or revise any piece of text, ALWAYS call the "
    "`write_document` tool with the full content as a single string. "
    "Never paste the document into a chat message directly — the document "
    "belongs in shared state and the UI renders it live as you type."
)

shared_state_streaming_agent = LlmAgent(
    name="SharedStateStreamingAgent",
    model="gemini-2.5-flash",
    instruction=_INSTRUCTION,
    tools=[write_document],
    generate_content_config=types.GenerateContentConfig(
        # Required for ag_ui_adk's per-token argument streaming alongside
        # PredictStateMapping. Without this, the model emits the full args
        # in one chunk and the UI only sees the final document.
        # Falls back to non-streaming on models that don't support it.
    ),
)

SHARED_STATE_STREAMING_PREDICT_STATE = [
    PredictStateMapping(
        state_key="document",
        tool="write_document",
        tool_argument="content",
        emit_confirm_tool=False,
        stream_tool_call=True,
    ),
]
