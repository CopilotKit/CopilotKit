"""Agent backing the State Streaming demo.

The agent writes a long `document` string into shared agent state via a
`write_document` tool. The UI renders `state["document"]` live as the
tool arguments arrive.

How the per-token "live" feel is produced:

1. `PredictStateMapping(state_key="document", tool="write_document",
   tool_argument="content", stream_tool_call=True)` is declared on the
   ADKAgent middleware in `registry.py`. The middleware emits a
   STATE_DELTA every time the corresponding tool argument grows.
2. `streaming_function_call_arguments=True` is also set on the ADKAgent
   middleware so ag_ui_adk subscribes to incremental TOOL_CALL_ARGS
   events from the underlying ADK runner. This requires google-adk
   >= 1.24.0 via Vertex AI for true per-token streaming; on older
   versions or via Gemini Studio the middleware emits a UserWarning at
   startup and falls back to chunk-level streaming, which still drives
   STATE_DELTAs but at coarser granularity. The UI's "LIVE" badge stays
   honest in both modes — it just updates fewer times per second on the
   fallback path.

The model itself does not need a `GenerateContentConfig` override for
this — the streaming behaviour is entirely controlled by the ADKAgent
middleware. This matches langgraph-python's StateStreamingMiddleware
setup.
"""

from __future__ import annotations

from ag_ui_adk.config import PredictStateMapping
from google.adk.agents import LlmAgent
from google.adk.tools import ToolContext

from agents.shared_chat import get_model


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

# @region[state-streaming-middleware]
shared_state_streaming_agent = LlmAgent(
    name="SharedStateStreamingAgent",
    model=get_model(),
    instruction=_INSTRUCTION,
    tools=[write_document],
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
# @endregion[state-streaming-middleware]
