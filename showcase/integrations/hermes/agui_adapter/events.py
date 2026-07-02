"""Translate Hermes ``AIAgent`` callbacks into AG-UI protocol events.

The Hermes agent runs synchronously in a worker thread and communicates
progress through a handful of push callbacks (see ``run_agent.AIAgent``):

    stream_delta_callback(text)          # assistant text deltas; None = flush
    reasoning_callback(text)             # provider reasoning/thinking deltas
    tool_progress_callback(evt, name, preview, args, **kw)  # "tool.started" ...
    step_callback(api_call_count, prev_tools)  # prev_tools carry results

This module owns the *translation* only. It converts those callbacks into
AG-UI ``BaseEvent`` objects and hands them to an ``emit`` callable. Thread
safety and transport (SSE) are the server's concern: ``emit`` is expected to
be safe to call from the agent worker thread (e.g. it pushes onto a queue the
async SSE generator drains).

Mirrors the structure of ``acp_adapter/events.py`` but targets AG-UI event
types instead of ACP ``session_update`` notifications.

Key differences from the ACP bridge:

* Assistant text is a *lifecycle*: AG-UI needs TEXT_MESSAGE_START before the
  first delta and TEXT_MESSAGE_END after the last. The bridge tracks whether a
  text (or reasoning) message is currently open and opens/closes it lazily.
  Reasoning uses the REASONING_MESSAGE_* lifecycle (not THINKING_*), because
  only that builds a ``role:"reasoning"`` message on the client.
* Tool completion + results arrive one step late via ``step_callback`` (the
  ``prev_tools`` of the *next* iteration), exactly as in ACP. A FIFO queue of
  tool-call ids per tool name matches a completion to the right start, so
  parallel/repeated same-name calls stay correctly paired.
"""

from __future__ import annotations

import json
import logging
import uuid
from collections import deque
from typing import Any, Callable, Deque, Dict, Optional

from ag_ui.core import (
    BaseEvent,
    ReasoningMessageContentEvent,
    ReasoningMessageEndEvent,
    ReasoningMessageStartEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallResultEvent,
    ToolCallStartEvent,
)

logger = logging.getLogger(__name__)

Emit = Callable[[BaseEvent], None]


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


class AGUIEventBridge:
    """Stateful translator from Hermes agent callbacks to AG-UI events.

    One instance per agent run. Not thread-safe on its own — the Hermes agent
    fires all of these callbacks from a single worker thread, so mutations to
    the open-message / tool-queue state are serialized by construction. The
    injected ``emit`` is the only thing that crosses the thread boundary.
    """

    def __init__(self, emit: Emit, *, id_factory: Callable[[str], str] = _new_id):
        self._emit = emit
        self._id = id_factory
        # Whether any assistant text has been emitted this run (lets the
        # server decide if it must emit a final-response fallback message when
        # a provider path produced no text deltas).
        self.emitted_any_text: bool = False
        # Assistant text message currently streaming (None when closed).
        self._text_message_id: Optional[str] = None
        # Thinking message currently streaming (None when closed).
        self._thinking_message_id: Optional[str] = None
        # FIFO of AG-UI tool_call_ids per Hermes tool name, so a completion
        # arriving via step_callback pairs with the right start event.
        self._tool_ids: Dict[str, Deque[str]] = {}
        # Real (model-issued) id overrides, keyed by tool name — used for
        # client-side tools whose id must match the assistant message so the
        # returned ToolMessage correlates. See server-side client-tool path.
        self._id_overrides: Dict[str, Deque[str]] = {}

    # -- public callback surface (assign these onto the AIAgent) -----------

    def on_text_delta(self, text: Optional[str]) -> None:
        """``stream_delta_callback``. ``None`` flushes/closes the message."""
        if text is None:
            self._close_text()
            return
        if not text:
            return
        # Text and thinking can't interleave in one AG-UI stream — close any
        # open thinking message before assistant text starts.
        self._close_thinking()
        if self._text_message_id is None:
            self._text_message_id = self._id("msg")
            self._emit(TextMessageStartEvent(message_id=self._text_message_id, role="assistant"))
        self.emitted_any_text = True
        self._emit(TextMessageContentEvent(message_id=self._text_message_id, delta=text))

    def on_reasoning_delta(self, text: Optional[str]) -> None:
        """``reasoning_callback``. Provider reasoning/thinking deltas.

        Emits AG-UI ``REASONING_MESSAGE_*`` events (not ``THINKING_*``): only
        the reasoning-message lifecycle is turned into a ``role:"reasoning"``
        message by ``@ag-ui/client`` / CopilotKit, so this is what the client
        actually renders in its reasoning slot.
        """
        if not text:
            return
        # A model that emits reasoning then answer text is the norm; keep them
        # in separate AG-UI message lifecycles.
        self._close_text()
        if self._thinking_message_id is None:
            self._thinking_message_id = self._id("think")
            self._emit(
                ReasoningMessageStartEvent(
                    message_id=self._thinking_message_id, role="reasoning"
                )
            )
        self._emit(
            ReasoningMessageContentEvent(
                message_id=self._thinking_message_id, delta=text
            )
        )

    def on_tool_progress(
        self,
        event_type: str,
        name: Optional[str] = None,
        preview: Optional[str] = None,
        args: Any = None,
        **kwargs: Any,
    ) -> None:
        """``tool_progress_callback``. Only ``tool.started`` is bridged here;
        completion + results come through ``on_step`` where the result payload
        is available (matching the ACP bridge's split)."""
        if event_type != "tool.started" or not name:
            return
        args_dict = _coerce_args(args)
        # Close any open assistant/thinking message before a tool call block.
        self._close_text()
        self._close_thinking()

        tc_id = self._next_id_for(name)
        self._tool_ids.setdefault(name, deque()).append(tc_id)

        self._emit(ToolCallStartEvent(tool_call_id=tc_id, tool_call_name=name))
        self._emit(ToolCallArgsEvent(tool_call_id=tc_id, delta=json.dumps(args_dict)))

    def on_step(self, api_call_count: int, prev_tools: Any = None) -> None:
        """``step_callback``. ``prev_tools`` lists the tools completed in the
        previous iteration, each carrying its result."""
        if not isinstance(prev_tools, list):
            return
        for info in prev_tools:
            name, result = _tool_info(info)
            queue = self._tool_ids.get(name or "")
            if not name or not queue:
                continue
            tc_id = queue.popleft()
            self._emit(ToolCallEndEvent(tool_call_id=tc_id))
            self._emit(
                ToolCallResultEvent(
                    message_id=self._id("res"),
                    tool_call_id=tc_id,
                    content="" if result is None else str(result),
                )
            )
            if not queue:
                self._tool_ids.pop(name, None)

    def finish(self) -> None:
        """Close any messages left open when the run ends."""
        self._close_text()
        self._close_thinking()

    # -- client-side tool id correlation -----------------------------------

    def bind_client_tool_id(self, name: str, tool_call_id: str) -> None:
        """Force the next ``tool.started`` for *name* to use *tool_call_id*
        (the model-issued id) instead of a generated one, so the AG-UI event
        the client sees matches the assistant message and the returned
        ToolMessage correlates on resume."""
        self._id_overrides.setdefault(name, deque()).append(tool_call_id)

    # -- internals ---------------------------------------------------------

    def _next_id_for(self, name: str) -> str:
        overrides = self._id_overrides.get(name)
        if overrides:
            tc_id = overrides.popleft()
            if not overrides:
                self._id_overrides.pop(name, None)
            return tc_id
        return self._id("tc")

    def _close_text(self) -> None:
        if self._text_message_id is not None:
            self._emit(TextMessageEndEvent(message_id=self._text_message_id))
            self._text_message_id = None

    def _close_thinking(self) -> None:
        if self._thinking_message_id is not None:
            self._emit(ReasoningMessageEndEvent(message_id=self._thinking_message_id))
            self._thinking_message_id = None


def _coerce_args(args: Any) -> dict:
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except (json.JSONDecodeError, TypeError):
            return {"raw": args}
    return args if isinstance(args, dict) else {}


def _tool_info(info: Any) -> tuple[Optional[str], Any]:
    """Extract (name, result) from a step_callback prev_tools entry."""
    if isinstance(info, dict):
        name = info.get("name") or info.get("function_name")
        result = info.get("result") if "result" in info else info.get("output")
        return name, result
    if isinstance(info, str):
        return info, None
    return None, None
