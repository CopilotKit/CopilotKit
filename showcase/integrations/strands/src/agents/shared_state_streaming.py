"""shared-state-streaming — dedicated Strands agent for per-token document state.

Mirrors LangGraph's ``langgraph-python/src/agents/shared_state_streaming.py``
and the MAF port in ``ms-agent-python/src/agents/shared_state_streaming.py``.

The frontend (``src/app/demos/shared-state-streaming/page.tsx``) subscribes
to ``agent.state.document`` via ``useAgent`` and re-renders the document
view as content arrives. This agent's job is to call ``write_document``
with a full document string; ``ToolBehavior.predict_state`` mirrors LGP's
``StateStreamingMiddleware(StateItem(state_key="document",
tool="write_document", tool_argument="document"))`` and MAF's
``predict_state_config`` — it tells the runtime / frontend to map the
tool's ``document`` argument into ``state.document``.

Streaming limitations (ag_ui_strands)
-------------------------------------
``ag_ui_strands`` (through at least v0.1.x) buffers tool-call input until
``contentBlockStop``, then emits:

1. ``state_from_args`` → authoritative ``StateSnapshotEvent`` with the
   full ``document`` string.
2. ``CustomEvent(name="PredictState")`` carrying the
   ``PredictStateMapping`` payload so the frontend's
   ``usePredictStateSubscription`` knows to mirror tool-arg deltas into
   ``state.document``.
3. ``ToolCallStart`` / ``ToolCallArgs`` / ``ToolCallEnd`` for the call.

There is no mid-generation ``ToolCallArgsEvent`` stream while the LLM is
still producing the tool argument (unlike LGP's StateStreamingMiddleware,
which forwards every token as it is generated). Best-effort progressive
UI updates are provided by ``args_streamer``, which re-emits the completed
JSON args as small deltas after the block stops so the PredictState
subscription can paint ``state.document`` incrementally. True per-token
mid-generation state deltas would require adapter-level hooks on
``current_tool_use`` updates; those are not exposed today.

Mount wiring is deferred to the wire-server slot — this module only
exports the factory.
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from textwrap import dedent
from typing import Any

from strands import tool


logger = logging.getLogger(__name__)

# Chunk size for best-effort progressive ToolCallArgs emission. Small enough
# that the document panel visibly grows; large enough to avoid flooding the
# SSE channel with single-character events.
_ARGS_STREAM_CHUNK_SIZE = 16


# ---- Tool ---------------------------------------------------------------


@tool
def write_document(document: str) -> str:
    """Write a document for the user.

    Always call this tool when the user asks you to write, draft, or revise
    any piece of text (an essay, poem, email, summary, etc.). Pass the FULL
    content as a single string in the ``document`` argument — the document
    lives in shared state and the UI renders it live; never paste it into a
    chat message.

    Args:
        document: The full document content as a single string.

    Returns:
        Confirmation string for the LLM to summarise back to the user.
    """
    return "Document written to shared state."


# ---- State hook ---------------------------------------------------------


async def document_state_from_args(context: Any) -> dict | None:
    """Emit a StateSnapshotEvent for the ``document`` slot when
    ``write_document`` fires.

    Accepts str-or-dict tool input (ag_ui_strands may pass either while
    args are still streaming or after they complete). Returns ``None``
    when the input shape is unrecognized so a bad tool call never crashes
    the stream — matches ``notes_state_from_args`` / ``sales_state_from_args``
    error-degradation policy in ``agent.py``.
    """
    raw_input = getattr(context, "tool_input", None)
    if raw_input is None:
        logger.warning("document_state_from_args: context has no tool_input")
        return None

    tool_input = raw_input
    if isinstance(tool_input, str):
        try:
            tool_input = json.loads(tool_input)
        except json.JSONDecodeError as exc:
            logger.warning(
                "document_state_from_args: malformed JSON tool input (%s); "
                "input excerpt: %s",
                exc,
                repr(raw_input)[:200],
            )
            return None

    if isinstance(tool_input, dict):
        document = tool_input.get("document")
    elif isinstance(tool_input, str):
        document = tool_input
    else:
        logger.warning(
            "document_state_from_args: unsupported tool_input type %s",
            type(tool_input).__name__,
        )
        return None

    if not isinstance(document, str) or not document:
        return None
    return {"document": document}


# ---- Args streamer (best-effort progressive ToolCallArgs) ---------------


async def document_args_streamer(context: Any) -> AsyncIterator[str]:
    """Re-emit completed tool args as small deltas for progressive UI paint.

    ag_ui_strands only invokes this after ``contentBlockStop`` (the full
    argument string is already known). Yielding it in chunks lets the
    frontend's PredictState subscription update ``state.document`` as
    partial JSON accumulates, approximating LGP per-token streaming for
    the demo even though the LLM generation has finished.
    """
    args_str = getattr(context, "args_str", None)
    if not isinstance(args_str, str) or not args_str:
        # Fall back: rebuild from tool_input when args_str is missing.
        tool_input = getattr(context, "tool_input", None)
        if isinstance(tool_input, dict):
            args_str = json.dumps(tool_input)
        elif isinstance(tool_input, str) and tool_input:
            args_str = tool_input
        else:
            return

    chunk = _ARGS_STREAM_CHUNK_SIZE
    for i in range(0, len(args_str), chunk):
        yield args_str[i : i + chunk]


# ---- Prompt -------------------------------------------------------------


SYSTEM_PROMPT = dedent(
    """
    You are a collaborative writing assistant. Whenever the user asks
    you to write, draft, or revise any piece of text, ALWAYS call the
    `write_document` tool with the full content as a single string in
    the `document` argument. Never paste the document into a chat
    message directly — the document belongs in shared state and the UI
    renders it live as you type.
    """
).strip()


# ---- Factory ------------------------------------------------------------


def build_shared_state_streaming_agent():
    """Build a dedicated StrandsAgent for the shared-state-streaming demo.

    Returns an ``ag_ui_strands.StrandsAgent`` wrapper (mirrors
    ``build_voice_agent`` / ``build_byoc_hashbrown_agent``) so it can be
    mounted by ``create_strands_app`` and exposed as a dedicated AG-UI
    endpoint. Mount wiring is intentionally left to the wire-server slot.

    Tool behavior:
    * ``state_from_args`` — authoritative ``StateSnapshotEvent`` with the
      full document once the tool call completes.
    * ``predict_state`` — ``PredictStateMapping`` so the frontend mirrors
      tool-arg deltas into ``state.document`` (LGP / MAF parity).
    * ``args_streamer`` — best-effort progressive re-emission of the
      completed args JSON (see module docstring for mid-generation limits).
    """
    # Deferred imports so this module remains importable before the
    # agent_server import-order patches run. Mirrors build_voice_agent /
    # build_byoc_hashbrown_agent: the OpenAI model is built via the shared
    # agents.agent._build_model factory to avoid circular import at module
    # load time.
    from strands import Agent
    from ag_ui_strands import (
        PredictStateMapping,
        StrandsAgent,
        StrandsAgentConfig,
        ToolBehavior,
    )

    from agents.agent import _build_model

    strands_agent = Agent(
        model=_build_model(),
        system_prompt=SYSTEM_PROMPT,
        tools=[write_document],
    )

    return StrandsAgent(
        agent=strands_agent,
        name="shared_state_streaming",
        description=(
            "Per-token state streaming: write_document arg deltas land "
            "in state.document as the tool call is emitted."
        ),
        config=StrandsAgentConfig(
            tool_behaviors={
                "write_document": ToolBehavior(
                    state_from_args=document_state_from_args,
                    predict_state=[
                        PredictStateMapping(
                            state_key="document",
                            tool="write_document",
                            tool_argument="document",
                        )
                    ],
                    args_streamer=document_args_streamer,
                ),
            },
        ),
    )
