"""
Agent Server for Agno

Uses AgentOS with the AG-UI interface to serve multiple Agno agents.
The Next.js CopilotKit runtime proxies requests to each interface via AG-UI.

Interfaces:
    /agui                       → main agent (sales assistant, most demos)
                                  Custom handler that forwards tool results
                                  from AGUI messages so HITL round-trips work.
    /reasoning/agui             → reasoning-capable agent
    /shared-state-rw/agui       → bidirectional shared-state agent
                                  (custom router emits STATE_SNAPSHOT)
    /subagents/agui             → supervisor with research/writing/critique
                                  sub-agents (custom router emits STATE_SNAPSHOT)
"""

import asyncio
import os
import uuid
from typing import Any, AsyncIterator, List, Optional, Set, Union

# CVDIAG bootstrap — MUST be the first non-stdlib import (folded in from the
# dropped L1-H slot). Importing this module configures the root logger via
# ``logging.basicConfig`` so the ``agents._header_forwarding`` (and sibling
# ``agents.*``) CVDIAG loggers actually EMIT (fixes the silent-drop bug), and
# resolves the verbosity tier + PB writer. It imports pydantic/starlette only
# (NOT agno), so it is safe to run before the agent imports below.
import _shared.cvdiag_bootstrap  # noqa: F401,E402  (first non-stdlib import — bootstrap side effects)

# ORDER-CRITICAL: install the global httpx hook BEFORE any agent module
# imports. Agno constructs its ``OpenAIChat`` client at agent-module
# import time, so the patch must be in place before those imports run.
from agents._cvdiag_backend import CvdiagBackendMiddleware
from agents._header_forwarding import (
    HeaderForwardingHTTPMiddleware,
    install_executor_contextvar_propagation,
    install_global_httpx_hook,
)

install_global_httpx_hook()
# Agno dispatches SYNC tools (e.g. the declarative gen-ui `generate_a2ui`
# tool, which makes a secondary OpenAI call) onto the default
# ThreadPoolExecutor via loop.run_in_executor(...), which does NOT
# propagate ContextVars to the worker thread. Without this, the
# forwarded-header ContextVar set on the inbound request task is empty by
# the time the secondary call's outbound httpx hook fires, and aimock
# can't match the right fixture for the request.
install_executor_contextvar_propagation()

import dotenv
from ag_ui.core import (
    BaseEvent,
    EventType,
    ReasoningMessageContentEvent,
    ReasoningMessageEndEvent,
    ReasoningMessageStartEvent,
    RunAgentInput,
    RunErrorEvent,
    RunFinishedEvent,
    RunStartedEvent,
    StateSnapshotEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
)
from ag_ui.core.types import Message as AGUIMessage
from ag_ui.encoder import EventEncoder
from agno.agent import Agent, RemoteAgent
from agno.models.message import Message
from agno.os import AgentOS
from agno.os.interfaces.agui import AGUI

# TODO: migrate to agno 2.6.20+ API once agui.utils replacement is identified
from agno.os.interfaces.agui.utils import (
    async_stream_agno_response_as_agui_events,
    extract_agui_user_input,
    validate_agui_state,
)
from agno.utils.log import log_debug, log_warning
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from agents.a2ui_dynamic_agent import agent as a2ui_dynamic_agent
from agents.a2ui_fixed_agent import agent as a2ui_fixed_agent
from agents.agent_config_agent import (
    agent as agent_config_agent,
    build_agent as build_agent_config_agent,
)
from agents.byoc_hashbrown_agent import agent as byoc_hashbrown_agent
from agents.byoc_json_render_agent import agent as byoc_json_render_agent
from agents.gen_ui_agent import agent as gen_ui_agent
from agents.interrupt_agent import agent as interrupt_agent
from agents.main import agent as main_agent
from agents.mcp_apps_agent import agent as mcp_apps_agent
from agents.multimodal_agent import agent as multimodal_agent
from agents.open_gen_ui_agent import agent as open_gen_ui_agent
from agents.reasoning_agent import agent as reasoning_agent
from agents.shared_state_read_write import agent as shared_state_rw_agent
from agents.subagents import agent as subagents_supervisor

dotenv.load_dotenv()


# ---------------------------------------------------------------------------
# AGUI message conversion for HITL tool-result forwarding
# ---------------------------------------------------------------------------
#
# agno >= 2.5.17 changed the stock AGUI router to use
# `extract_agui_user_input()` which passes ONLY the last user message to
# the agent. This works for simple chat but breaks Human-in-the-Loop
# flows: the second request (after the user confirms/rejects in the HITL
# UI) carries the tool result as an AGUI "tool" role message. Since
# `extract_agui_user_input` discards all non-user messages, the tool
# result never reaches the LLM and the agent just re-calls the tool and
# pauses again.
#
# The helper below converts AGUI messages to agno Messages — the same
# thing `convert_agui_messages_to_agno_messages` did in older agno
# releases — so we can detect tool results and pass the full conversation
# to the agent when they exist.


def _has_tool_results(messages: List[AGUIMessage]) -> bool:
    """Return True if the message list contains any tool-result messages."""
    return any(msg.role == "tool" for msg in messages)


def _convert_agui_messages(messages: List[AGUIMessage]) -> List[Message]:
    """Convert AG-UI messages to Agno messages (full conversation).

    Mirrors the old `convert_agui_messages_to_agno_messages` from
    agno < 2.5.17. The LLM (and OpenAI's API) requires assistant
    ``tool_calls`` and their ``tool`` results to stay paired: an
    orphan ``tool`` message with no matching assistant ``tool_calls``
    is rejected with a 400, and an assistant ``tool_calls`` whose
    result never arrived confuses the model. So we drop orphans on
    BOTH sides together, keeping only complete pairs.

    A ``tool`` message with a falsy ``tool_call_id`` (empty string, or
    ``None`` if the message bypassed pydantic validation) can never be
    paired, so it is skipped consistently across both passes — never
    added to the result and never allowed to poison dedup.
    """
    # First pass: collect the tool_call ids that BOTH sides agree on —
    # an id that appears on an assistant ``tool_calls`` AND on a ``tool``
    # result message. Only these ids yield a complete, emittable pair.
    assistant_tool_call_ids: Set[str] = set()
    tool_result_ids: Set[str] = set()
    for msg in messages:
        if msg.role == "tool" and msg.tool_call_id:
            tool_result_ids.add(msg.tool_call_id)
        elif msg.role == "assistant" and msg.tool_calls:
            for tc in msg.tool_calls:
                if tc.id:
                    assistant_tool_call_ids.add(tc.id)

    paired_ids: Set[str] = assistant_tool_call_ids & tool_result_ids

    result: List[Message] = []
    seen_tool_ids: Set[str] = set()

    for msg in messages:
        if msg.role == "tool":
            tool_call_id = msg.tool_call_id
            # Drop orphans: falsy ids can never pair, and an id with no
            # matching assistant tool_call would be a 400 from OpenAI.
            if not tool_call_id or tool_call_id not in paired_ids:
                continue
            # Dedup retained ids only — falsy ids were already skipped,
            # so they can no longer poison this set.
            if tool_call_id in seen_tool_ids:
                continue
            seen_tool_ids.add(tool_call_id)
            result.append(
                Message(
                    role="tool",
                    tool_call_id=tool_call_id,
                    content=msg.content,
                )
            )
        elif msg.role == "assistant":
            tool_calls = None
            if msg.tool_calls:
                # Keep only tool_calls whose result is present (paired).
                filtered = [tc for tc in msg.tool_calls if tc.id in paired_ids]
                if filtered:
                    tool_calls = [tc.model_dump(exclude_none=True) for tc in filtered]
            if not msg.content and tool_calls is None:
                # Drop an empty assistant turn (no content + all tool_calls
                # orphaned): OpenAI rejects {role:"assistant"} with neither
                # content nor tool_calls, and it pollutes HITL history.
                continue
            result.append(
                Message(
                    role="assistant",
                    content=msg.content,
                    tool_calls=tool_calls,
                )
            )
        elif msg.role == "user":
            result.append(Message(role="user", content=msg.content))
        # system messages are skipped — agent builds its own

    return result


# ---------------------------------------------------------------------------
# HITL-aware AGUI handler for the main agent
# ---------------------------------------------------------------------------
#
# The stock AGUI handler passes only the last user message to the agent,
# relying on agno's session DB for history.  This works for standard chat
# but breaks HITL: the second leg (tool-result) is dropped.
#
# This custom handler detects tool results in the incoming AGUI messages
# and, when present, passes the full message list to the agent instead.
# For first-leg requests (no tool results) it falls back to the stock
# `extract_agui_user_input` behaviour.


async def _run_main_agent_hitl_aware(
    agent: Union[Agent, RemoteAgent], run_input: RunAgentInput
) -> AsyncIterator[BaseEvent]:
    """Stream one agent run, forwarding tool results when present."""
    run_id = run_input.run_id or str(uuid.uuid4())
    thread_id = run_input.thread_id

    try:
        messages = run_input.messages or []
        has_results = _has_tool_results(messages)

        if has_results:
            # Second leg: convert full conversation so the LLM sees the
            # tool result and can generate a follow-up response.
            agent_input = _convert_agui_messages(messages)
            log_debug(
                "HITL-aware handler: forwarding full messages (tool results present)"
            )
        else:
            # First leg: extract only the user message (stock behaviour).
            agent_input = extract_agui_user_input(messages)
            log_debug("HITL-aware handler: extracting user input (no tool results)")

        yield RunStartedEvent(
            type=EventType.RUN_STARTED, thread_id=thread_id, run_id=run_id
        )

        user_id: Optional[str] = None
        if run_input.forwarded_props and isinstance(run_input.forwarded_props, dict):
            user_id = run_input.forwarded_props.get("user_id")

        session_state = validate_agui_state(run_input.state, thread_id) or {}

        response_stream = agent.arun(  # type: ignore[attr-defined]
            input=agent_input,
            session_id=thread_id,
            stream=True,
            stream_events=True,
            user_id=user_id,
            session_state=session_state,
            run_id=run_id,
            # When we pass full messages (HITL second leg), disable session
            # history to avoid duplicating messages the caller already sent.
            add_history_to_context=not has_results,
        )

        async for event in async_stream_agno_response_as_agui_events(
            response_stream=response_stream,  # type: ignore[arg-type]
            thread_id=thread_id,
            run_id=run_id,
        ):
            yield event

    except asyncio.CancelledError:  # noqa: TRY302
        raise
    except Exception as exc:  # noqa: BLE001
        yield RunErrorEvent(type=EventType.RUN_ERROR, message=str(exc))


def _attach_hitl_aware_route(app: FastAPI, agent: Agent, prefix: str) -> None:
    """Mount a HITL-aware AGUI POST endpoint at `<prefix>/agui`."""
    encoder = EventEncoder()
    route = f"{prefix.rstrip('/')}/agui"

    async def _handler(run_input: RunAgentInput) -> StreamingResponse:
        async def _gen():
            async for event in _run_main_agent_hitl_aware(agent, run_input):
                yield encoder.encode(event)

        return StreamingResponse(
            _gen(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
                "Access-Control-Allow-Headers": "*",
            },
        )

    app.post(route, name=f"agui_hitl_aware_{prefix.strip('/')}")(_handler)


# ---------------------------------------------------------------------------
# State-aware AGUI handler
# ---------------------------------------------------------------------------
#
# Agno's stock AGUI router (`agno.os.interfaces.agui`) does NOT emit
# `StateSnapshotEvent` events back to the client. This means tools that
# mutate `session_state` are invisible to a UI subscribed via
# `useAgent({ updates: [OnStateChanged] })` — the round-trip is broken.
#
# For the shared-state-read-write and subagents demos we replicate the
# stock router's behavior but emit a `StateSnapshotEvent` carrying the
# final `session_state` immediately before the closing `RunFinishedEvent`.
# That gives the UI the canonical bidirectional contract its langgraph-
# python and google-adk siblings already have.


async def _run_agent_with_state_snapshot(
    agent: Union[Agent, RemoteAgent], run_input: RunAgentInput
) -> AsyncIterator[BaseEvent]:
    """Stream one agent run, emitting STATE_SNAPSHOT before RUN_FINISHED.

    Mirrors `agno.os.interfaces.agui.router.run_agent` but inserts a
    `StateSnapshotEvent` after the inner Agno stream completes. We also
    suppress the inner stream's `RunFinishedEvent` and emit our own at
    the very end so the snapshot lands inside the run window.
    """
    run_id = run_input.run_id or str(uuid.uuid4())
    thread_id = run_input.thread_id

    try:
        user_input = extract_agui_user_input(run_input.messages or [])

        yield RunStartedEvent(
            type=EventType.RUN_STARTED, thread_id=thread_id, run_id=run_id
        )

        user_id: Optional[str] = None
        if run_input.forwarded_props and isinstance(run_input.forwarded_props, dict):
            user_id = run_input.forwarded_props.get("user_id")

        session_state = validate_agui_state(run_input.state, thread_id) or {}

        response_stream = agent.arun(  # type: ignore[attr-defined]
            input=user_input,
            session_id=thread_id,
            stream=True,
            stream_events=True,
            user_id=user_id,
            session_state=session_state,
            run_id=run_id,
        )

        async for event in async_stream_agno_response_as_agui_events(
            response_stream=response_stream,  # type: ignore[arg-type]
            thread_id=thread_id,
            run_id=run_id,
        ):
            # Suppress the inner RUN_STARTED / RUN_FINISHED — we already
            # emitted RUN_STARTED above and will emit RUN_FINISHED after
            # the snapshot. Yield everything else (text, tool calls,
            # reasoning, errors) verbatim.
            if event.type in (EventType.RUN_STARTED, EventType.RUN_FINISHED):
                continue
            yield event

        # Snapshot the final session_state from the agent's session DB.
        # `agent.arun` mutates `session_state` in-place when tools call
        # `run_context.session_state[...] = ...`, but we read back via
        # the agent's own getter so we pick up any merged DB state too.
        final_state: Any = session_state
        try:
            getter = getattr(agent, "aget_session_state", None)
            if getter is not None:
                final_state = await getter(session_id=thread_id)  # type: ignore[misc]
            else:
                sync_getter = getattr(agent, "get_session_state", None)
                if sync_getter is not None:
                    final_state = sync_getter(session_id=thread_id)
        except Exception:  # noqa: BLE001 — fall back to in-memory snapshot
            final_state = session_state

        if not isinstance(final_state, dict):
            final_state = session_state if isinstance(session_state, dict) else {}

        yield StateSnapshotEvent(type=EventType.STATE_SNAPSHOT, snapshot=final_state)
        yield RunFinishedEvent(
            type=EventType.RUN_FINISHED, thread_id=thread_id, run_id=run_id
        )

    except asyncio.CancelledError:  # noqa: TRY302 — propagate cancellation
        raise
    except Exception as exc:  # noqa: BLE001
        yield RunErrorEvent(type=EventType.RUN_ERROR, message=str(exc))


def _attach_state_aware_route(app: FastAPI, agent: Agent, prefix: str) -> None:
    """Mount a single state-aware AGUI POST endpoint at `<prefix>/agui`."""
    encoder = EventEncoder()
    route = f"{prefix.rstrip('/')}/agui"

    async def _handler(run_input: RunAgentInput) -> StreamingResponse:
        async def _gen():
            async for event in _run_agent_with_state_snapshot(agent, run_input):
                yield encoder.encode(event)

        return StreamingResponse(
            _gen(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
                "Access-Control-Allow-Headers": "*",
            },
        )

    app.post(route, name=f"agui_state_aware_{prefix.strip('/')}")(_handler)


# ---------------------------------------------------------------------------
# Per-request agent factory (Agent Config Object demo)
# ---------------------------------------------------------------------------
#
# The CopilotKit provider's `properties` prop arrives as top-level keys on
# `RunAgentInput.forwarded_props`. The Agent Config Object cell reads three
# of those keys (tone, expertise, responseLength) and composes a fresh
# system prompt per turn. Agno doesn't have a LangGraph-style configurable
# channel, so we mount a custom AGUI handler that builds a per-request
# Agno Agent and runs it through the stock AGUI stream mapper.


async def _run_agent_config(run_input: RunAgentInput) -> AsyncIterator[BaseEvent]:
    """Stream one Agent-Config run with a freshly-built system prompt."""
    run_id = run_input.run_id or str(uuid.uuid4())
    thread_id = run_input.thread_id

    forwarded = (
        run_input.forwarded_props
        if isinstance(run_input.forwarded_props, dict)
        else None
    )

    try:
        user_input = extract_agui_user_input(run_input.messages or [])

        yield RunStartedEvent(
            type=EventType.RUN_STARTED, thread_id=thread_id, run_id=run_id
        )

        per_request_agent = build_agent_config_agent(forwarded)
        session_state = validate_agui_state(run_input.state, thread_id) or {}

        response_stream = per_request_agent.arun(  # type: ignore[attr-defined]
            input=user_input,
            session_id=thread_id,
            stream=True,
            stream_events=True,
            session_state=session_state,
            run_id=run_id,
        )

        async for event in async_stream_agno_response_as_agui_events(
            response_stream=response_stream,  # type: ignore[arg-type]
            thread_id=thread_id,
            run_id=run_id,
        ):
            # The inner stream emits its own RUN_STARTED/RUN_FINISHED; we
            # already emitted RUN_STARTED and will close out below.
            if event.type in (EventType.RUN_STARTED, EventType.RUN_FINISHED):
                continue
            yield event

        yield RunFinishedEvent(
            type=EventType.RUN_FINISHED, thread_id=thread_id, run_id=run_id
        )
    except asyncio.CancelledError:  # noqa: TRY302 — propagate cancellation
        raise
    except Exception as exc:  # noqa: BLE001
        yield RunErrorEvent(type=EventType.RUN_ERROR, message=str(exc))


def _attach_agent_config_route(app: FastAPI, prefix: str) -> None:
    """Mount a single Agent-Config AGUI POST endpoint at `<prefix>/agui`."""
    encoder = EventEncoder()
    route = f"{prefix.rstrip('/')}/agui"

    async def _handler(run_input: RunAgentInput) -> StreamingResponse:
        async def _gen():
            async for event in _run_agent_config(run_input):
                yield encoder.encode(event)

        return StreamingResponse(
            _gen(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
                "Access-Control-Allow-Headers": "*",
            },
        )

    app.post(route, name=f"agui_agent_config_{prefix.strip('/')}")(_handler)


# ---------------------------------------------------------------------------
# Reasoning-aware AGUI handler
# ---------------------------------------------------------------------------
#
# Agno's stock AGUI handler emits STEP_STARTED/STEP_FINISHED events for
# reasoning, not the REASONING_MESSAGE_* events that CopilotKit expects.
# And reasoning=True triggers a multi-call CoT loop that breaks with
# aimock/fixture environments.
#
# This custom handler:
#   1. Runs the agent with reasoning=False (single LLM call)
#   2. Captures the model's NATIVE reasoning channel — OpenAI-compatible
#      chat-completions stream a `delta.reasoning_content` field which Agno's
#      OpenAIChat model surfaces on each `RunContentEvent.reasoning_content`.
#      That is the channel aimock fixtures populate (via their `reasoning`
#      field), and it is what reasoning models emit in production. Agno's
#      AGUI stream mapper (`async_stream_agno_response_as_agui_events`) DROPS
#      that channel entirely, so we tee the raw stream to accumulate it.
#   3. Collects the streamed text content (the answer)
#   4. Emits REASONING_MESSAGE_* events for the reasoning block — preferring
#      the native channel, then falling back to <reasoning>...</reasoning>
#      tag parsing of the text for no-native-reasoning fixtures
#   5. Emits TEXT_MESSAGE_* events for the answer
#
# Mirrors the claude-sdk-python /reasoning handler, which forwards Anthropic
# `thinking`/`thinking_delta` blocks as REASONING_MESSAGE_* directly. The
# emitted channel is REASONING_MESSAGE_* (role "reasoning") — NOT THINKING_*,
# which @ag-ui/client silently drops.

import re

from agno.run.agent import RunEvent

_REASONING_PATTERN = re.compile(
    r"<reasoning>(.*?)</reasoning>",
    re.DOTALL | re.IGNORECASE,
)


async def _tee_native_reasoning(
    # Carries Agno run events (RunContentEvent etc.) plus the terminal
    # RunOutput — NOT AG-UI's BaseEvent. Annotated ``Any`` because Agno's
    # concrete union (``RunOutputEvent | RunOutput``) does not line up with
    # the ``RunOutputEvent | TeamRunOutputEvent`` the downstream AGUI mapper
    # consumes, and a precise annotation here only moves the mismatch.
    response_stream: AsyncIterator[Any],
    reasoning_sink: dict,
) -> AsyncIterator[Any]:
    """Pass an Agno run stream through verbatim, accumulating the model's
    native ``reasoning_content`` channel into ``reasoning_sink["text"]``.

    OpenAI-compatible providers (and aimock fixtures' ``reasoning`` field)
    stream reasoning as ``delta.reasoning_content`` deltas, which Agno's
    ``OpenAIChat`` model surfaces on each ``RunContentEvent.reasoning_content``.
    Agno's AGUI stream mapper ignores that field, so we capture it here while
    forwarding every chunk untouched to the downstream mapper. No chunk is
    consumed or altered — the mapper still produces TEXT/TOOL events exactly
    as before; we only read the reasoning side-channel.
    """
    async for chunk in response_stream:
        if getattr(chunk, "event", None) == RunEvent.run_content:
            delta = getattr(chunk, "reasoning_content", None)
            if delta:
                reasoning_sink["text"] = reasoning_sink.get("text", "") + delta
        yield chunk


async def _run_reasoning_agent(
    agent: Union[Agent, RemoteAgent], run_input: RunAgentInput
) -> AsyncIterator[BaseEvent]:
    """Stream one reasoning agent run, synthesizing REASONING_MESSAGE events."""
    run_id = run_input.run_id or str(uuid.uuid4())
    thread_id = run_input.thread_id

    try:
        user_input = extract_agui_user_input(run_input.messages or [])

        yield RunStartedEvent(
            type=EventType.RUN_STARTED, thread_id=thread_id, run_id=run_id
        )

        user_id: Optional[str] = None
        if run_input.forwarded_props and isinstance(run_input.forwarded_props, dict):
            user_id = run_input.forwarded_props.get("user_id")

        session_state = validate_agui_state(run_input.state, thread_id) or {}

        response_stream = agent.arun(  # type: ignore[attr-defined]
            input=user_input,
            session_id=thread_id,
            stream=True,
            stream_events=True,
            user_id=user_id,
            session_state=session_state,
            run_id=run_id,
        )

        # Collect the full text from the agent stream — we need to see the
        # complete response before we can split reasoning from answer, so
        # text and tool-call events are BUFFERED here and flushed after the
        # reasoning/answer split below (tool events are NOT interleaved with
        # the text in real time; they are emitted after the answer bubble).
        full_text = ""
        tool_events: list[BaseEvent] = []

        # Tee the raw Agno stream to capture the model's native reasoning
        # channel (`RunContentEvent.reasoning_content`) — the channel aimock
        # fixtures populate and that the AGUI mapper drops. Accumulated here,
        # preferred over <reasoning>-tag parsing below.
        native_reasoning: dict = {}

        async for event in async_stream_agno_response_as_agui_events(
            response_stream=_tee_native_reasoning(
                response_stream,
                native_reasoning,
            ),
            thread_id=thread_id,
            run_id=run_id,
        ):
            if event.type in (EventType.RUN_STARTED, EventType.RUN_FINISHED):
                continue
            # Propagate an inner-stream error instead of silently dropping
            # it — otherwise the run would report success with an empty or
            # partial message. Forward the RUN_ERROR and stop the run.
            if event.type == EventType.RUN_ERROR:
                yield event
                return
            # Accumulate text content
            if event.type == EventType.TEXT_MESSAGE_CONTENT:
                full_text += event.delta  # type: ignore[attr-defined]
            # Buffer tool-call events; they're flushed after the answer.
            # TOOL_CALL_RESULT must be buffered too — the reasoning agent has
            # tools, and dropping the result loses the tool-result render in
            # the reasoning-chain demo. Results follow their START/ARGS/END so
            # the post-answer flush order below preserves correct sequencing.
            elif event.type in (
                EventType.TOOL_CALL_START,
                EventType.TOOL_CALL_ARGS,
                EventType.TOOL_CALL_END,
                EventType.TOOL_CALL_RESULT,
            ):
                tool_events.append(event)
            # Skip text start/end — we'll re-emit with reasoning split

        native_reasoning_text = (native_reasoning.get("text") or "").strip()

        if native_reasoning_text:
            # Native reasoning channel present (reasoning model / aimock
            # `reasoning` fixture field). This is the production path and the
            # gold-standard parity channel — use it directly. The answer is
            # the streamed text minus any stray <reasoning> tags (defensive:
            # a native-reasoning fixture shouldn't also embed tags, but strip
            # them so they never leak into the visible answer bubble).
            reasoning_text = native_reasoning_text
            answer_text = _REASONING_PATTERN.sub("", full_text).strip()
        else:
            # Fallback: parse <reasoning>...</reasoning> tags from the text
            # (no-native-reasoning fixtures / non-reasoning models).
            match = _REASONING_PATTERN.search(full_text)

            if match:
                reasoning_text = match.group(1).strip()
                answer_text = (
                    full_text[: match.start()] + full_text[match.end() :]
                ).strip()
            else:
                # Fallback: check for "Reasoning:" prefix pattern (aimock
                # fixtures)
                lower = full_text.lower()
                if lower.startswith("reasoning:") or lower.startswith("reasoning step"):
                    # Treat the whole text as containing reasoning — emit as
                    # reasoning message so the ReasoningBlock renders, then
                    # re-emit as a text message so CopilotKit's conversation
                    # view has an assistant bubble the D5 probe can read.
                    reasoning_text = full_text.strip()
                    answer_text = full_text.strip()
                else:
                    reasoning_text = ""
                    answer_text = full_text.strip()

        # Emit reasoning message if we have reasoning content
        if reasoning_text:
            reasoning_msg_id = str(uuid.uuid4())
            yield ReasoningMessageStartEvent(
                type=EventType.REASONING_MESSAGE_START,
                message_id=reasoning_msg_id,
                role="reasoning",
            )
            yield ReasoningMessageContentEvent(
                type=EventType.REASONING_MESSAGE_CONTENT,
                message_id=reasoning_msg_id,
                delta=reasoning_text,
            )
            yield ReasoningMessageEndEvent(
                type=EventType.REASONING_MESSAGE_END,
                message_id=reasoning_msg_id,
            )

        # Always emit a text message so CopilotKit renders an assistant
        # bubble in the conversation. Without this the frontend shows
        # nothing (reasoning events alone don't produce a visible message
        # in the default CopilotChat transcript).
        text_msg_id = str(uuid.uuid4())
        if answer_text or tool_events:
            yield TextMessageStartEvent(
                type=EventType.TEXT_MESSAGE_START,
                message_id=text_msg_id,
                role="assistant",
            )
            if answer_text:
                yield TextMessageContentEvent(
                    type=EventType.TEXT_MESSAGE_CONTENT,
                    message_id=text_msg_id,
                    delta=answer_text,
                )
            yield TextMessageEndEvent(
                type=EventType.TEXT_MESSAGE_END,
                message_id=text_msg_id,
            )

        # Emit any tool-call events that were collected
        for te in tool_events:
            yield te

        yield RunFinishedEvent(
            type=EventType.RUN_FINISHED, thread_id=thread_id, run_id=run_id
        )

    except asyncio.CancelledError:  # noqa: TRY302
        raise
    except Exception as exc:  # noqa: BLE001
        yield RunErrorEvent(type=EventType.RUN_ERROR, message=str(exc))


def _attach_reasoning_route(app: FastAPI, agent: Agent, prefix: str) -> None:
    """Mount a reasoning-aware AGUI POST endpoint at `<prefix>/agui`."""
    encoder = EventEncoder()
    route = f"{prefix.rstrip('/')}/agui"

    async def _handler(run_input: RunAgentInput) -> StreamingResponse:
        async def _gen():
            async for event in _run_reasoning_agent(agent, run_input):
                yield encoder.encode(event)

        return StreamingResponse(
            _gen(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
                "Access-Control-Allow-Headers": "*",
            },
        )

    app.post(route, name=f"agui_reasoning_{prefix.strip('/')}")(_handler)


# ---------------------------------------------------------------------------
# AgentOS bootstrap
# ---------------------------------------------------------------------------

agent_os = AgentOS(
    agents=[
        main_agent,
        interrupt_agent,
        a2ui_dynamic_agent,
        a2ui_fixed_agent,
        agent_config_agent,
        byoc_hashbrown_agent,
        byoc_json_render_agent,
        gen_ui_agent,
        mcp_apps_agent,
        multimodal_agent,
        open_gen_ui_agent,
        reasoning_agent,
        shared_state_rw_agent,
        subagents_supervisor,
    ],
    interfaces=[
        # main_agent is mounted separately below via _attach_hitl_aware_route
        # so it can forward tool results for HITL round-trips.
        # reasoning_agent is mounted separately below via
        # _attach_reasoning_route so /reasoning/agui emits REASONING_MESSAGE_*
        # events instead of the stock AGUI STEP_STARTED/STEP_FINISHED.
        # No-tools agent for the MCP Apps cell. The CopilotKit runtime's
        # `mcpApps.servers` middleware injects MCP server tools at request
        # time, so the LLM only sees the MCP-provided toolset.
        AGUI(agent=mcp_apps_agent, prefix="/mcp-apps"),  # -> /mcp-apps/agui
        # No-tools agent for the Open Generative UI cells. The runtime's
        # `openGenerativeUI` middleware injects the `generateSandboxedUi`
        # tool the LLM uses to author HTML+CSS for the sandboxed iframe.
        AGUI(agent=open_gen_ui_agent, prefix="/open-gen-ui"),  # -> /open-gen-ui/agui
        # Vision-capable agent (gpt-4o) for the Multimodal Attachments cell.
        AGUI(agent=multimodal_agent, prefix="/multimodal"),  # -> /multimodal/agui
        # BYOC: hashbrown — agent emits a hashbrown UI-kit envelope as a single
        # JSON object that the frontend renderer parses progressively.
        AGUI(agent=byoc_hashbrown_agent, prefix="/byoc-hashbrown"),
        # BYOC: json-render — agent emits a json-render spec the frontend
        # renderer mounts against a Zod-validated catalog.
        AGUI(agent=byoc_json_render_agent, prefix="/byoc-json-render"),
        # A2UI dynamic schema — agent owns `generate_a2ui` which calls a
        # secondary OpenAI client bound to `render_a2ui` and emits an
        # `a2ui_operations` container the runtime A2UI middleware forwards
        # to the frontend renderer.
        AGUI(agent=a2ui_dynamic_agent, prefix="/declarative-gen-ui"),
        # A2UI fixed schema — agent's `display_flight` tool emits an
        # `a2ui_operations` container directly (no secondary LLM) bound to
        # the pre-authored `flight_schema.json`.
        AGUI(agent=a2ui_fixed_agent, prefix="/a2ui-fixed-schema"),
    ],
)
app = agent_os.get_app()

# HITL-aware route for the main agent.  Replaces the stock AGUI interface
# (``AGUI(agent=main_agent)``) so tool results from the CopilotKit runtime
# are forwarded to the LLM on the second leg of HITL flows instead of being
# silently dropped by ``extract_agui_user_input()``.
_attach_hitl_aware_route(app, main_agent, "")

# Interrupt-adapted scheduling agent. Shared by gen-ui-interrupt and
# interrupt-headless demos -- backend has tools=[], the frontend provides
# `schedule_meeting` via `useFrontendTool` with an async Promise handler.
_attach_hitl_aware_route(app, interrupt_agent, "/interrupt-adapted")

# Reasoning-aware route. Replaces the stock AGUI interface
# (``AGUI(agent=reasoning_agent, prefix="/reasoning")``) so /reasoning/agui
# emits REASONING_MESSAGE_* events (what CopilotKit's
# CopilotChatReasoningMessage / custom reasoning slots render) instead of the
# stock STEP_STARTED/STEP_FINISHED events.
_attach_reasoning_route(app, reasoning_agent, "/reasoning")

# State-aware routes (bidirectional shared state via StateSnapshotEvent).
# Mounted directly on the AgentOS FastAPI app so they share routing and
# CORS with the stock AGUI interfaces above.
_attach_state_aware_route(app, shared_state_rw_agent, "/shared-state-rw")
_attach_state_aware_route(app, subagents_supervisor, "/subagents")
# gen-ui-agent: planner that walks 3 steps through pending -> in_progress
# -> completed via the `set_steps` tool. Each set_steps call mutates
# session_state["steps"], and the state-aware router emits a
# StateSnapshotEvent after the run so the UI's useAgent picks it up.
_attach_state_aware_route(app, gen_ui_agent, "/gen-ui-agent")


# Agent Config Object cell — builds a per-request Agno Agent whose system
# prompt is composed from the CopilotKit provider's forwarded properties
# (tone / expertise / responseLength).
_attach_agent_config_route(app, "/agent-config")


# Serve /health via middleware so it short-circuits BEFORE route resolution.
class HealthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.url.path == "/health" and request.method == "GET":
            return JSONResponse({"status": "ok"})
        return await call_next(request)


app.add_middleware(HealthMiddleware)

# Capture inbound CopilotKit ``x-*`` headers (e.g. ``x-aimock-context``) so
# downstream LLM/provider httpx calls inside the request scope copy them
# onto their outbound requests. Paired with ``install_global_httpx_hook``
# at the top of this file.
app.add_middleware(HeaderForwardingHTTPMiddleware)

# CVDIAG backend emitter (spec §3 Layer 2) — emits the HTTP-observable backend
# boundaries (request.ingress, sse.first_byte, sse.event, sse.aborted,
# response.complete, error.caught) as structured CVDIAG envelopes. Added LAST so
# it is the OUTERMOST layer: it observes ingress before any inner layer mutates
# the request and wraps the response stream so SSE boundaries fire as chunks
# flow. Gated behind ``CVDIAG_BACKEND_EMITTER`` (default OFF, canary-safe) — the
# middleware fast-paths to a bare pass-through when the flag is unset.
app.add_middleware(CvdiagBackendMiddleware)


def main():
    """Run the uvicorn server.

    ``loop="asyncio"`` pins uvicorn's event-loop factory to the stdlib
    ``asyncio`` loop instead of letting its default ``loop="auto"`` select
    uvloop (installed transitively via ``uvicorn[standard]``). This is
    load-bearing for header forwarding on the SECONDARY OpenAI call inside
    the sync ``generate_a2ui`` tool: agno dispatches that sync tool onto a
    worker thread via ``loop.run_in_executor(...)``, and
    ``install_executor_contextvar_propagation()`` (called at import time)
    only propagates the forwarded-header ContextVar into that worker thread
    when the loop is a stdlib ``BaseEventLoop`` subclass. Under uvloop the
    shim is inert (uvloop's loop is not a ``BaseEventLoop``), so the
    ContextVar is empty in the executor thread and the secondary call drops
    ``x-aimock-context`` → aimock 503. ``AgentOS.serve(**kwargs)`` forwards
    ``loop`` straight through to ``uvicorn.run``. The prod entrypoint, which
    launches uvicorn via its CLI rather than this ``serve`` path, pins the
    same loop via ``--loop asyncio`` in ``entrypoint.sh``.
    """
    port = int(os.getenv("PORT", "8000"))
    agent_os.serve(
        app="agent_server:app",
        host="0.0.0.0",
        port=port,
        reload=True,
        loop="asyncio",
    )


if __name__ == "__main__":
    main()
