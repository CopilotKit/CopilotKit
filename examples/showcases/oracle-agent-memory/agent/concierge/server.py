"""FastAPI server: Agent Spec agent on LangGraph over AG-UI, + durable memory.

We hand-roll the AG-UI streaming route (copied from the adapter's thin
`add_agentspec_fastapi_endpoint`) so we can persist each exchange to Oracle
Agent Memory — the adapter exposes no post-run hook. Persistence runs as a
background task once the run finishes (off the SSE critical path, so the stream
closes at RUN_FINISHED); it is fully server-side, and the frontend just streams
from /run.
"""

from __future__ import annotations

import asyncio
import functools
import html
from contextlib import asynccontextmanager

from ag_ui.core import EventType, RunAgentInput, RunErrorEvent
from ag_ui.encoder import EventEncoder
from ag_ui_agentspec.agent import AgentSpecAgent
from ag_ui_agentspec.agentspec_tracing_exporter import EVENT_QUEUE
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .agent import build_agent_json
from .memory import get_memory
from .reconcile import reconcile_durable_memories
from .tools import DEMO_USER_ID, TOOL_REGISTRY

load_dotenv()


# ── Multi-turn fix (upstream adapter workaround) ──────────────────────────────
# The ag_ui_agentspec LangGraph runner checkpoints history per thread_id and, on
# each turn, tries to append only the client messages whose ids aren't already in
# the checkpoint (filter_only_new_messages). But CopilotKit re-sends the *full*
# history with ids that never match the checkpoint's, so a second copy of the
# assistant(tool_calls)/tool block gets appended; OpenAI then rejects the malformed
# sequence on the next turn (400: "a message with role 'tool' must be a response to
# a preceeding message with 'tool_calls'"), breaking every follow-up after a server
# tool runs. See docs/known-issues/agentspec-multiturn-toolcall-correlation.md.
#
# Since the client already sends the full, valid history each turn, we replace the
# adapter's incremental merge with a full-history *replace*: clear the checkpoint's
# messages (RemoveMessage) and use the client's history verbatim. Drop this once the
# upstream adapter records ToolExecutionRequests so the ids correlate.
from langchain_core.messages import RemoveMessage  # noqa: E402
from langgraph.graph.message import REMOVE_ALL_MESSAGES  # noqa: E402
import ag_ui_agentspec.runtimes.langgraph_runner as _lg_runner  # noqa: E402


def _repair_dangling_tool_calls(messages: list[dict]) -> list[dict]:
    """Synthesize a tool result for any assistant tool_call that has no response.

    book_flight is a client-side HITL tool: calling it interrupts the run and emits
    an assistant message with a tool_call, then waits for the UI to return a result
    when the traveler clicks Confirm/Cancel. If they instead send another chat
    message, that tool_call is left unanswered — and because we forward the client's
    full history verbatim, OpenAI rejects the next turn (400: "tool_call_ids did not
    have response messages"). This is the inverse of the duplicate-tool-block issue
    the history replace already handles (see the comment above).

    For each assistant tool_call with no real tool result, insert a synthetic
    "not completed" tool result directly after the assistant message so the sequence
    is valid and the model can answer the new question. In this app the only tool
    that can dangle is the book_flight HITL — server tools resolve within the run —
    so the synthetic content is phrased for that case.

    Assumes CopilotKit's normal ordering, where a real tool result immediately
    follows its assistant tool_calls message: this repairs *missing* results, not a
    result that has been re-ordered away from its originating call.
    """
    # tool_call_ids that already have a REAL result somewhere in the history.
    answered = {
        m["tool_call_id"]
        for m in messages
        if m.get("role") == "tool" and m.get("tool_call_id")
    }
    repaired: list[dict] = []
    for m in messages:
        repaired.append(m)
        if m.get("role") != "assistant" or not m.get("tool_calls"):
            continue
        # De-dupe within THIS message only — a second assistant message carrying the
        # same unanswered id still needs its own result, so `answered` is never
        # mutated here (mutating it was the original bug: it suppressed the repair the
        # next occurrence needed).
        synthesized: set[str] = set()
        for tc in m["tool_calls"]:
            tc_id = tc.get("id")
            if not tc_id:
                # Can't synthesize a result without an id; surface it rather than
                # silently leave a dangling call that 400s on the next turn.
                print("[history] warning: assistant tool_call has no id; cannot repair")
                continue
            if tc_id in answered or tc_id in synthesized:
                continue
            synthesized.add(tc_id)
            name = (tc.get("function") or {}).get("name") or "the requested action"
            repaired.append(
                {
                    "role": "tool",
                    "tool_call_id": tc_id,
                    "content": f"{name} was not completed — the traveler continued without confirming.",
                }
            )
    return repaired


async def _replace_history_with_client(_agent, _thread_id, input_messages):
    """Replace the checkpoint's messages with the client's full history each turn,
    repairing any dangling tool_call (e.g. an abandoned book_flight HITL) first."""
    if not input_messages:
        return input_messages
    return [RemoveMessage(id=REMOVE_ALL_MESSAGES), *_repair_dangling_tool_calls(input_messages)]


_lg_runner.filter_only_new_messages = _replace_history_with_client

# ── Oracle checkpointer injection (Plan §3, Option A) ─────────────────────────
# ag_ui_agentspec's load_agent_spec hardcodes checkpointer=MemorySaver(); we
# replace it so the LangGraph graph is compiled with our flag-gated checkpointer
# (AsyncOracleSaver when LANGGRAPH_CHECKPOINTER=oracle, else MemorySaver). The
# underlying pyagentspec AgentSpecLoader already accepts a checkpointer; only the
# convenience wrapper needed patching. Drop this once the upstream adapter takes a
# checkpointer param (Plan §3, Option B). AgentSpecAgent.__init__ resolves the name
# from ag_ui_agentspec.agent, so we rebind both module namespaces.
import ag_ui_agentspec.agent as _agent_mod  # noqa: E402
import ag_ui_agentspec.agentspecloader as _asl_mod  # noqa: E402
from pyagentspec.adapters.langgraph import AgentSpecLoader as _LGLoader  # noqa: E402

from .checkpointer import resolve_checkpointer, init_checkpointer, close_checkpointer  # noqa: E402

_orig_load_agent_spec = _agent_mod.load_agent_spec


def _load_agent_spec_with_checkpointer(
    runtime, agent_spec_json, tool_registry=None, components_registry=None
):
    if runtime != "langgraph":
        return _orig_load_agent_spec(
            runtime, agent_spec_json, tool_registry, components_registry
        )
    return _LGLoader(
        tool_registry=tool_registry, checkpointer=resolve_checkpointer()
    ).load_json(agent_spec_json, components_registry)


_agent_mod.load_agent_spec = _load_agent_spec_with_checkpointer
_asl_mod.load_agent_spec = _load_agent_spec_with_checkpointer


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    # Build the Oracle checkpointer (if LANGGRAPH_CHECKPOINTER=oracle) before the
    # lazy agent build so resolve_checkpointer() sees an initialised saver. No-op
    # under the default `memory` flag.
    await init_checkpointer()
    try:
        yield
    finally:
        # Drain in-flight background persists on shutdown so a graceful stop doesn't
        # drop the last turn's memory write. Loop rather than a single gather: a
        # request finishing during the drain can add a task after the snapshot, so
        # re-check until the set is empty. Persists are serialized (one at a time).
        while _PERSIST_TASKS:
            await asyncio.gather(*list(_PERSIST_TASKS), return_exceptions=True)
        await close_checkpointer()


app = FastAPI(title="Oracle Concierge Agent", lifespan=_lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

@functools.lru_cache(maxsize=1)
def _get_agentspec_agent() -> AgentSpecAgent:
    """Build the agent once, on first request. Construction eagerly resolves the
    LLM (ChatOpenAI), which needs OPENAI_API_KEY, so we defer it out of import."""
    return AgentSpecAgent(
        build_agent_json(), runtime="langgraph", tool_registry=TOOL_REGISTRY
    )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


def _last_user_message(messages: list) -> str:
    for message in reversed(messages):
        if getattr(message, "role", None) == "user":
            return getattr(message, "content", "") or ""
    return ""


def _clean_assistant_text(parts: list[str]) -> str:
    """Assemble the streamed assistant deltas into the text we persist to memory.

    The agentspec exporter HTML-escapes every TEXT_MESSAGE_CHUNK delta for safe
    transport to the browser (agentspec_tracing_exporter._escape_html: & < > ->
    &amp; &lt; &gt;). We must reverse that before persisting, or Oracle Agent
    Memory stores corrupted facts like "fares &lt; $700" and recall/extraction
    operate on the mangled text. Join first, then unescape, so an entity split
    across two delta boundaries (e.g. "&l" + "t;") is still decoded correctly.
    The streamed copy yielded to the client is untouched — only the persisted
    copy is unescaped here.
    """
    return html.unescape("".join(parts))


# Background persistence tasks are tracked here so the event loop keeps a strong
# reference until each finishes — a bare fire-and-forget task can be garbage
# collected mid-flight (see the asyncio.create_task docs).
_PERSIST_TASKS: set[asyncio.Task] = set()
# Serialize background persists: only one extraction + reconciliation runs at a
# time. The old await made the client wait on stream-close before sending the
# next turn, which serialized persists for free; now that the stream closes at
# RUN_FINISHED, overlapping turns could otherwise run reconcile's read-modify-
# write concurrently (racing on which durable fact "wins") and exhaust the small
# Oracle connection pool. Background persists queue on this lock instead.
_PERSIST_LOCK = asyncio.Lock()


async def _persist_serialized(user_text: str, assistant_text: str) -> None:
    async with _PERSIST_LOCK:
        await asyncio.to_thread(_persist_sync, user_text, assistant_text)


def _on_persist_done(task: asyncio.Task) -> None:
    """Drop the task ref and surface any failure. The write happens off the
    request path, so a silently-dropped task exception would make a lost write
    invisible. _persist_sync swallows its own DB/LLM errors; this catches
    cancellation (loop shutdown) and scheduling failures that would vanish."""
    _PERSIST_TASKS.discard(task)
    if task.cancelled():
        print("[persist] warning: background persist cancelled before completing")
        return
    exc = task.exception()
    if exc is not None:
        print(f"[persist] warning: background persist task failed ({exc!r})")


def _spawn_persist(user_text: str, assistant_text: str) -> None:
    """Run persistence off the request's critical path.

    _persist_sync makes two LLM calls (memory extraction + reconciliation) plus
    DB writes — ~2-13s in practice. Awaiting it in the SSE generator's finally
    held the HTTP stream open that whole time *after* RUN_FINISHED, so the client
    (which ends its run/loading state on stream-close, not on RUN_FINISHED) showed
    a multi-second lag once the reply had already finished. Spawning it as a
    tracked, serialized background task lets the stream close at RUN_FINISHED; the
    write still lands a few seconds later, well before a human starts the next turn.
    """
    task = asyncio.create_task(_persist_serialized(user_text, assistant_text))
    _PERSIST_TASKS.add(task)
    task.add_done_callback(_on_persist_done)


def _persist_sync(user_text: str, assistant_text: str) -> None:
    """Persist the exchange for memory extraction, then supersede stale facts.

    Both turns are stored: extraction reliably distills durable facts from a full
    user+assistant exchange, whereas a lone user turn often yields only a raw
    "message" record and no extracted fact. The agent's echoes land as "message"
    records too, but recall_memory filters those out (see tools.DURABLE_RECORD_TYPES),
    so they never re-assert a stale preference. Reconciliation then deletes
    outdated/duplicate *durable* facts so an updated preference wins on recall.
    """
    exchange: list[dict[str, str]] = []
    if user_text:
        exchange.append({"role": "user", "content": user_text})
    if assistant_text:
        exchange.append({"role": "assistant", "content": assistant_text})
    if not exchange:
        return
    try:
        memory = get_memory()
        thread = memory.create_thread(user_id=DEMO_USER_ID)
        thread.add_messages(exchange)  # triggers automatic memory extraction
        # Delete outdated/duplicate durable facts so the newest preference wins on recall.
        reconcile_durable_memories(DEMO_USER_ID)
    except Exception as exc:  # persistence is best-effort; a DB blip must not 500 the run
        # Mirror recall_memory's graceful degradation: the chat reply already streamed
        # successfully, so swallow + log rather than raising out of the SSE generator's
        # finally (which surfaced as "Exception in ASGI application" while the DB was down).
        print(f"[persist] warning: memory persist failed, degrading gracefully ({exc})")


@app.post("/run")
async def run_endpoint(input_data: RunAgentInput, request: Request):
    """Stream the Agent Spec run over AG-UI, then persist the turn in the background.

    The event_generator mirrors the adapter's endpoint.py: a per-request queue is
    set into EVENT_QUEUE, the run is spawned as a task, and events are drained to
    SSE. We additionally collect the assistant's text deltas and, once the stream
    closes, spawn persistence as a background task (off the critical path).
    """
    encoder = EventEncoder(accept=request.headers.get("accept"))
    user_text = _last_user_message(input_data.messages)

    async def event_generator():
        queue: asyncio.Queue = asyncio.Queue()
        token = EVENT_QUEUE.set(queue)
        assistant_parts: list[str] = []

        async def run_and_close():
            try:
                await _get_agentspec_agent().run(input_data)
            except Exception as exc:  # surface failures to the client
                queue.put_nowait(RunErrorEvent(message=repr(exc)))
            finally:
                queue.put_nowait(None)

        try:
            asyncio.create_task(run_and_close())
            while True:
                item = await queue.get()
                if item is None:
                    break
                if item.type in (EventType.RUN_STARTED, EventType.RUN_FINISHED):
                    item.thread_id = input_data.thread_id
                    item.run_id = input_data.run_id
                if item.type == EventType.TEXT_MESSAGE_CHUNK:
                    assistant_parts.append(getattr(item, "delta", "") or "")
                yield encoder.encode(item)
        except Exception as exc:
            yield encoder.encode(RunErrorEvent(message=str(exc)))
        finally:
            EVENT_QUEUE.reset(token)
            # Persist off the critical path so the SSE stream closes at RUN_FINISHED
            # instead of blocking on memory extraction + reconciliation. The write
            # still lands shortly after, so the next session can recall it.
            _spawn_persist(user_text, _clean_assistant_text(assistant_parts))

    return StreamingResponse(event_generator(), media_type=encoder.get_content_type())
