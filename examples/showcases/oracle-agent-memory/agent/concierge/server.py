"""FastAPI server: Agent Spec agent on LangGraph over AG-UI, + durable memory.

We hand-roll the AG-UI streaming route (copied from the adapter's thin
`add_agentspec_fastapi_endpoint`) so we can persist each exchange to Oracle
Agent Memory *after the SSE stream drains* — the adapter exposes no post-run
hook. Persistence is fully server-side; the frontend just streams from /run.
"""

from __future__ import annotations

import asyncio
import functools

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


async def _replace_history_with_client(_agent, _thread_id, input_messages):
    """Replace the checkpoint's messages with the client's full history each turn."""
    if not input_messages:
        return input_messages
    return [RemoveMessage(id=REMOVE_ALL_MESSAGES), *input_messages]


_lg_runner.filter_only_new_messages = _replace_history_with_client


app = FastAPI(title="Oracle Concierge Agent")
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
    """Stream the Agent Spec run over AG-UI, then persist the turn to memory.

    The event_generator mirrors the adapter's endpoint.py: a per-request queue is
    set into EVENT_QUEUE, the run is spawned as a task, and events are drained to
    SSE. We additionally collect the assistant's text deltas and persist after.
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
            # Persist after the stream drains so the next session can recall it.
            await asyncio.to_thread(_persist_sync, user_text, "".join(assistant_parts))

    return StreamingResponse(event_generator(), media_type=encoder.get_content_type())
