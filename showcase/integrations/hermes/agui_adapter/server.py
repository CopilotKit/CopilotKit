"""AG-UI HTTP/SSE server for Hermes.

Exposes a single POST endpoint that accepts an AG-UI ``RunAgentInput`` and
streams AG-UI protocol events (SSE). It runs the synchronous Hermes
``AIAgent`` on a worker thread; assistant text and reasoning stream live via
``AGUIEventBridge``, while tool-call events are derived from the resulting
message list (so they carry the model's real tool-call ids).

Frontend (client-executed) tools use Hermes' interrupt mechanism — see
``agui_adapter/session.py``. When the model calls one, the run unwinds; the
adapter emits the frontend tool call WITHOUT a result and finishes the run.
Any server-side tools called in the same turn ran first (the batch is
sequential) and their results are emitted normally. The client executes the
frontend tool and starts a new run with the result appended to ``messages``.

Run framing:

    RUN_STARTED
      -> (live)  TEXT_MESSAGE_* / REASONING_MESSAGE_*
      -> (post)  TOOL_CALL_* [+ TOOL_CALL_RESULT for server tools]
      -> (post)  STATE_SNAPSHOT for state-writer tools
    RUN_FINISHED   (or RUN_ERROR on failure)

State-writer tools (declared via ``forwarded_props``) are INTERNAL: their
authoritative UI is the state card driven by ``StateSnapshotEvent``, not a
chatty tool chip. The adapter therefore SUPPRESSES the visible ``TOOL_CALL_*``
/ ``TOOL_CALL_RESULT`` events for them (which would otherwise trail the
streamed text as a raw chip, since tool events are derived post-run) and emits
only the snapshot the call produced, in message order.
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
from typing import Any, Dict, List, Optional, Set

from ag_ui.core import (
    RunAgentInput,
    RunErrorEvent,
    RunFinishedEvent,
    RunStartedEvent,
    StateSnapshotEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallResultEvent,
    ToolCallStartEvent,
)
from ag_ui.encoder import EventEncoder
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse

from agui_adapter import resume_shim, translate
from agui_adapter.events import AGUIEventBridge
from agui_adapter.session import (
    AgentConfig,
    RunState,
    build_run_agent,
    reset_current_agent,
    reset_current_state,
    set_current_agent,
    set_current_state,
)

logger = logging.getLogger(__name__)

# Install the resume shim (no-op unless a resume run sets the flag).
resume_shim.install()

_FORWARD_HEADERS = ("x-aimock-context", "x-test-id", "x-aimock-strict")
_DONE = object()


def _new_message_id() -> str:
    import uuid

    return f"msg-{uuid.uuid4().hex[:12]}"


def _collect_forward_headers(headers) -> Dict[str, str]:
    return {name: headers.get(name) for name in _FORWARD_HEADERS if headers.get(name)}


def _input_tool_call_ids(messages) -> Set[str]:
    """All tool-call ids already present in the inbound AG-UI messages, so we
    can emit events only for tool calls produced by *this* run."""
    ids: Set[str] = set()
    for m in messages:
        if getattr(m, "role", None) == "assistant":
            for tc in getattr(m, "tool_calls", None) or []:
                ids.add(tc.id)
        elif getattr(m, "role", None) == "tool":
            ids.add(m.tool_call_id)
    return ids


def _results_by_id(hermes_messages: List[dict]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for m in hermes_messages:
        if isinstance(m, dict) and m.get("role") == "tool":
            tcid = m.get("tool_call_id")
            if tcid:
                out[tcid] = m.get("content", "")
    return out


def _new_tool_calls(hermes_messages: List[dict], known_ids: Set[str]):
    """Yield (id, name, arguments) for assistant tool calls not already known."""
    for m in hermes_messages:
        if isinstance(m, dict) and m.get("role") == "assistant":
            for tc in m.get("tool_calls") or []:
                tcid = tc.get("id")
                if tcid and tcid not in known_ids:
                    fn = tc.get("function") or {}
                    yield tcid, fn.get("name", ""), fn.get("arguments", "{}")


def _run_turn(run_input: RunAgentInput, config: AgentConfig, bridge: AGUIEventBridge,
              fwd_headers: Dict[str, str]) -> Dict[str, Any]:
    """Build + configure the agent and run one turn (on a worker thread)."""
    frontend_schemas = translate.agui_tools_to_openai(run_input.tools)
    frontend_names = translate.frontend_tool_names(run_input.tools)
    context_text = translate.context_to_text(run_input.context)
    # forwarded_props (agent config) and inbound shared state are each injected
    # as their own read-only system message, exactly like context_text.
    props_text = translate.forwarded_props_to_text(run_input.forwarded_props)
    state_text = translate.state_to_text(run_input.state)
    prep = translate.prepare_run(
        run_input.messages,
        context_text=context_text,
        system_texts=[props_text, state_text],
    )

    # Shared state: seed the run-scoped store from inbound state so snapshots
    # carry UI-set keys (e.g. preferences) alongside agent-written keys. Declare
    # which server-executed tools mutate which state key (from forwarded_props).
    state_specs, state_schemas = translate.parse_state_writer_props(run_input.forwarded_props)
    inbound_state = run_input.state if isinstance(run_input.state, dict) else {}
    run_state = RunState(state=dict(inbound_state), specs=state_specs)

    agent = build_run_agent(
        config,
        frontend_tool_schemas=frontend_schemas,
        frontend_tool_names=frontend_names,
        state_writer_specs=state_specs or None,
        state_writer_schemas=state_schemas or None,
        default_headers=fwd_headers or None,
    )
    # Text + reasoning stream live; tool events are derived from messages after
    # the run (real ids). tool_progress/step are intentionally left unset.
    agent.stream_delta_callback = bridge.on_text_delta
    agent.reasoning_callback = bridge.on_reasoning_delta
    agent.thinking_callback = None

    token = set_current_agent(agent)
    state_token = set_current_state(run_state)
    resume_token = resume_shim.set_resume(prep.is_resume)
    try:
        result = agent.run_conversation(prep.user_message, conversation_history=prep.conversation_history)
    finally:
        resume_shim.reset_resume(resume_token)
        reset_current_state(state_token)
        reset_current_agent(token)
    return {
        "result": result or {},
        "frontend_names": frontend_names,
        "state_writer_names": set(state_specs),
        "run_state": run_state,
    }


async def _event_stream(run_input: RunAgentInput, encoder: EventEncoder,
                        config: AgentConfig, fwd_headers: Dict[str, str]):
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def emit(event) -> None:
        loop.call_soon_threadsafe(queue.put_nowait, event)

    bridge = AGUIEventBridge(emit)
    known_ids = _input_tool_call_ids(run_input.messages)
    holder: Dict[str, Any] = {}

    def worker() -> None:
        try:
            out = _run_turn(run_input, config, bridge, fwd_headers)
            holder["out"] = out
            result = out["result"]
            frontend_names = out["frontend_names"]
            state_writer_names = out["state_writer_names"]
            run_state: RunState = out["run_state"]
            messages = result.get("messages") or []
            results = _results_by_id(messages)

            # Snapshots recorded (in call order) by the state-writer handlers.
            # Consumed FIFO as we walk the state-writer tool calls in message
            # order, so each StateSnapshotEvent is emitted right after the tool
            # call that produced it and carries the full merged state as of then.
            snapshots = list(run_state.snapshots)
            snap_idx = 0

            handed_off = False
            # Emit server-tool events (with results) first, then frontend tool
            # calls (no result — the client produces it).
            deferred_frontend = []
            for tcid, name, args in _new_tool_calls(messages, known_ids):
                if name in frontend_names:
                    deferred_frontend.append((tcid, name, args))
                    continue
                # State-writer tools are INTERNAL: their authoritative UI is the
                # state card driven by the StateSnapshotEvent below, not a chatty
                # tool chip. Suppress the visible TOOL_CALL_* / TOOL_CALL_RESULT
                # events for them (they would otherwise trail the streamed text
                # as a raw chip, since tool events are derived post-run) but STILL
                # emit the snapshot the call produced, in message order.
                if name not in state_writer_names:
                    emit(ToolCallStartEvent(tool_call_id=tcid, tool_call_name=name))
                    emit(ToolCallArgsEvent(tool_call_id=tcid, delta=args if isinstance(args, str) else json.dumps(args)))
                    emit(ToolCallEndEvent(tool_call_id=tcid))
                    if tcid in results:
                        emit(ToolCallResultEvent(message_id=f"res-{tcid}", tool_call_id=tcid, content=results[tcid]))
                # After a state-writer tool call, emit the snapshot it produced
                # so the frontend re-renders with the new full shared state.
                if name in state_writer_names and snap_idx < len(snapshots):
                    emit(StateSnapshotEvent(snapshot=snapshots[snap_idx]))
                    snap_idx += 1
            for tcid, name, args in deferred_frontend:
                handed_off = True
                # Anchor the client-side tool call to a fresh assistant message.
                # The AG-UI → CopilotKit conversion maps TOOL_CALL_START →
                # ActionExecutionStart with parentMessageId; a distinct parent
                # per run keeps multi-turn frontend-tool calls (e.g. the D5
                # 3-pill sequence) individually reconcilable so each turn's
                # handler re-applies instead of a later run reverting to an
                # earlier historical tool call's state.
                parent_id = _new_message_id()
                emit(ToolCallStartEvent(tool_call_id=tcid, tool_call_name=name, parent_message_id=parent_id))
                emit(ToolCallArgsEvent(tool_call_id=tcid, delta=args if isinstance(args, str) else json.dumps(args)))
                emit(ToolCallEndEvent(tool_call_id=tcid))

            # Final assistant text: only on a normal finish (not a client-tool
            # handoff, whose final_response is an interrupt placeholder). Emit a
            # fallback only if nothing streamed live.
            if not handed_off:
                final = result.get("final_response") or ""
                if final and not bridge.emitted_any_text:
                    bridge.on_text_delta(final)
            bridge.finish()
        except Exception as exc:  # noqa: BLE001 - surfaced as RUN_ERROR
            holder["error"] = exc
            logger.exception("AG-UI run failed")
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, _DONE)

    threading.Thread(target=worker, name="hermes-agui-run", daemon=True).start()

    yield encoder.encode(RunStartedEvent(thread_id=run_input.thread_id, run_id=run_input.run_id))
    while True:
        item = await queue.get()
        if item is _DONE:
            break
        yield encoder.encode(item)

    if "error" in holder:
        yield encoder.encode(RunErrorEvent(message=str(holder["error"])))
        return
    yield encoder.encode(RunFinishedEvent(thread_id=run_input.thread_id, run_id=run_input.run_id))


def create_app(config: Optional[AgentConfig] = None) -> FastAPI:
    config = config or AgentConfig()
    app = FastAPI(title="Hermes AG-UI Adapter")

    @app.get("/health")
    async def health() -> dict:
        return {"status": "ok"}

    @app.post("/")
    async def run_agent_endpoint(request: Request) -> StreamingResponse:
        body = await request.json()
        run_input = RunAgentInput.model_validate(body)
        encoder = EventEncoder(accept=request.headers.get("accept"))
        fwd_headers = _collect_forward_headers(request.headers)
        return StreamingResponse(
            _event_stream(run_input, encoder, config, fwd_headers),
            media_type=encoder.get_content_type(),
        )

    return app
