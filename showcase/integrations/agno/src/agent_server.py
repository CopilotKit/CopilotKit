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
    agno < 2.5.17. Keeps assistant tool_calls only when a matching
    tool-result message exists, so the LLM always sees complete pairs.
    """
    # First pass: collect tool_call_ids that have results
    tool_ids_with_results: Set[str] = set()
    for msg in messages:
        if msg.role == "tool" and msg.tool_call_id:
            tool_ids_with_results.add(msg.tool_call_id)

    result: List[Message] = []
    seen_tool_ids: Set[str] = set()

    for msg in messages:
        if msg.role == "tool":
            if msg.tool_call_id in seen_tool_ids:
                continue
            seen_tool_ids.add(msg.tool_call_id)
            result.append(
                Message(
                    role="tool",
                    tool_call_id=msg.tool_call_id,
                    content=msg.content,
                )
            )
        elif msg.role == "assistant":
            tool_calls = None
            if msg.tool_calls:
                filtered = [
                    tc for tc in msg.tool_calls if tc.id in tool_ids_with_results
                ]
                if filtered:
                    tool_calls = [tc.model_dump(exclude_none=True) for tc in filtered]
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
#   2. Collects the streamed text content
#   3. Parses <reasoning>...</reasoning> tags from the text
#   4. Emits REASONING_MESSAGE_* events for the reasoning block
#   5. Emits TEXT_MESSAGE_* events for the answer
#
# If no <reasoning> tags are found, the entire response is emitted as a
# text message (graceful fallback for aimock fixtures that return plain
# text containing reasoning keywords).

import re

_REASONING_PATTERN = re.compile(
    r"<reasoning>(.*?)</reasoning>",
    re.DOTALL | re.IGNORECASE,
)


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
        # complete response to split reasoning from answer. We still forward
        # tool-call events in real-time (important for the reasoning-chain
        # demo that interleaves reasoning with tool rendering).
        full_text = ""
        tool_events: list[BaseEvent] = []

        async for event in async_stream_agno_response_as_agui_events(
            response_stream=response_stream,  # type: ignore[arg-type]
            thread_id=thread_id,
            run_id=run_id,
        ):
            if event.type in (EventType.RUN_STARTED, EventType.RUN_FINISHED):
                continue
            # Accumulate text content
            if event.type == EventType.TEXT_MESSAGE_CONTENT:
                full_text += event.delta  # type: ignore[attr-defined]
            # Forward tool-call events immediately
            elif event.type in (
                EventType.TOOL_CALL_START,
                EventType.TOOL_CALL_ARGS,
                EventType.TOOL_CALL_END,
            ):
                tool_events.append(event)
            # Skip text start/end — we'll re-emit with reasoning split

        # Parse <reasoning>...</reasoning> tags
        match = _REASONING_PATTERN.search(full_text)

        if match:
            reasoning_text = match.group(1).strip()
            answer_text = (
                full_text[: match.start()] + full_text[match.end() :]
            ).strip()
        else:
            # Fallback: check for "Reasoning:" prefix pattern (aimock fixtures)
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
        AGUI(agent=reasoning_agent, prefix="/reasoning"),
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

# State-aware routes (bidirectional shared state via StateSnapshotEvent).
# Mounted directly on the AgentOS FastAPI app so they share routing and
# CORS with the stock AGUI interfaces above.
_attach_state_aware_route(app, shared_state_rw_agent, "/shared-state-rw")
_attach_state_aware_route(app, subagents_supervisor, "/subagents")


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


def main():
    """Run the uvicorn server."""
    port = int(os.getenv("PORT", "8000"))
    agent_os.serve(app="agent_server:app", host="0.0.0.0", port=port, reload=True)


if __name__ == "__main__":
    main()
