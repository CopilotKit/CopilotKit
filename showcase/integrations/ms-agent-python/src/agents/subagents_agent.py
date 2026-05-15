"""MS Agent Framework agent backing the Sub-Agents demo.

Mirrors langgraph-python/src/agents/subagents.py and
google-adk/src/agents/subagents_agent.py:

A top-level supervisor LLM orchestrates three specialized sub-agents
exposed as tools:

  - `research_agent` — gathers facts
  - `writing_agent`  — drafts prose
  - `critique_agent` — reviews drafts

Each sub-agent is a real `agent_framework.Agent` with its own system
prompt. Each delegation appends an entry to the `delegations` slot in
AG-UI shared state via `state_update(...)`, so the UI can render a
live delegation log via `useAgent`.

Subagent invocation contract: each delegation tool returns
`state_update(...)` containing the FULL updated `delegations` list. We
read the prior list out of a per-request `ContextVar` populated by an
`agent_middleware` that captures the AG-UI session metadata
(specifically `current_state`, which the AG-UI runtime stuffs into
`session.metadata` on every turn) before the supervisor runs.
"""

# @region[supervisor-delegation-tools]
# @region[subagent-setup]
from __future__ import annotations

import asyncio
import contextvars
import json
import logging
import threading
import uuid
from collections.abc import Awaitable, Callable
from textwrap import dedent
from typing import Annotated, Any

from agent_framework import (
    Agent,
    AgentContext,
    BaseChatClient,
    Content,
    agent_middleware,
    tool,
)
from agent_framework_ag_ui import AgentFrameworkAgent, state_update
from pydantic import Field

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# State schema — `delegations` is rendered as a live log in the UI.
# ---------------------------------------------------------------------------

STATE_SCHEMA: dict[str, object] = {
    "delegations": {
        "type": "array",
        "description": (
            "Append-only log of supervisor -> sub-agent delegations. "
            "Each entry is a Delegation = "
            "{id, sub_agent, task, status, result}."
        ),
        "items": {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "sub_agent": {"type": "string"},
                "task": {"type": "string"},
                "status": {"type": "string"},
                "result": {"type": "string"},
            },
        },
    }
}


# ---------------------------------------------------------------------------
# Per-request current_state bridge
#
# Tools cannot directly receive `current_state` from the AG-UI runtime,
# but `agent_middleware` runs once per agent invocation with full
# session context. We snapshot the latest `delegations` list into a
# ContextVar before `call_next()`, so each delegation tool (running in
# the same task / contextvar scope) can read it back, append, and
# return the FULL list via `state_update`.
# ---------------------------------------------------------------------------

_current_delegations: contextvars.ContextVar[list[dict[str, Any]]] = (
    contextvars.ContextVar("ms_subagents_current_delegations", default=[])
)


def _extract_delegations(raw: Any) -> list[dict[str, Any]]:
    """Pull a clean delegations list out of session metadata.

    `session.metadata["current_state"]` is JSON-serialized by the
    AG-UI runtime (see `_build_safe_metadata`) so we tolerate either
    a plain dict or its string form.
    """
    payload: Any = raw
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            logger.warning(
                "subagents: current_state was not valid JSON; "
                "starting from empty delegations list"
            )
            return []
    if not isinstance(payload, dict):
        return []
    delegations = payload.get("delegations")
    if not isinstance(delegations, list):
        return []
    return [dict(d) for d in delegations if isinstance(d, dict)]


@agent_middleware
async def capture_current_state(
    context: AgentContext, call_next: Callable[[], Awaitable[None]]
) -> None:
    """Snapshot `delegations` from session metadata into a ContextVar."""
    snapshot: list[dict[str, Any]] = []
    session = context.session
    metadata = getattr(session, "metadata", None) if session else None
    if isinstance(metadata, dict):
        snapshot = _extract_delegations(metadata.get("current_state"))
    token = _current_delegations.set(snapshot)
    try:
        await call_next()
    finally:
        _current_delegations.reset(token)


# ---------------------------------------------------------------------------
# Sub-agent factory
#
# Each sub-agent is a full `Agent(...)` with its own system prompt.
# They share the chat client with the supervisor but otherwise have no
# shared memory or tools — the supervisor only sees their final text.
# ---------------------------------------------------------------------------


# Each sub-agent is a full-fledged `Agent(...)` with its own system
# prompt. They don't share memory or tools with the supervisor — the
# supervisor only sees their return value (final text content).
_RESEARCH_INSTRUCTIONS = (
    "You are a research sub-agent. Given a topic, produce a concise "
    "bulleted list of 3-5 key facts. No preamble, no closing."
)
_WRITING_INSTRUCTIONS = (
    "You are a writing sub-agent. Given a brief and optional source "
    "facts, produce a polished 1-paragraph draft. Be clear and "
    "concrete. No preamble."
)
_CRITIQUE_INSTRUCTIONS = (
    "You are an editorial critique sub-agent. Given a draft, give "
    "2-3 crisp, actionable critiques. No preamble."
)


def _make_sub_agent(chat_client: BaseChatClient, name: str, instructions: str) -> Agent:
    return Agent(
        client=chat_client,
        name=name,
        instructions=instructions,
        tools=[],
    )


# @endregion[subagent-setup]


# Module-level holder so the delegation tools can reach the
# pre-built sub-agents without rebuilding them on every tool call.
# Populated lazily by `create_subagents_agent(...)`.
_SUB_AGENTS: dict[str, Agent] = {}


async def _invoke_sub_agent_async(sub_agent_name: str, task: str) -> str:
    """Run a sub-agent on `task` and return its final text content."""
    agent = _SUB_AGENTS.get(sub_agent_name)
    if agent is None:
        raise RuntimeError(
            f"sub-agent '{sub_agent_name}' is not registered; call "
            "create_subagents_agent(...) first"
        )
    response = await agent.run(task)
    text = (getattr(response, "text", "") or "").strip()
    if text:
        return text
    # Fall back to scanning messages — `Agent.run` always returns
    # an `AgentRunResponse`, but `.text` may be empty if the chat
    # client only emitted reasoning content or tool calls.
    messages = getattr(response, "messages", None) or []
    for message in reversed(messages):
        for content in getattr(message, "contents", None) or []:
            content_text = getattr(content, "text", None)
            if content_text:
                fallback = str(content_text).strip()
                if fallback:
                    return fallback
    raise RuntimeError(f"sub-agent '{sub_agent_name}' returned no text content")


def _invoke_sub_agent(sub_agent_name: str, task: str) -> str:
    """Sync bridge: drive the async invocation from inside a tool callback.

    `@tool` reflects on the underlying callable's signature, so the
    tool entry points are sync. The supervisor's chat client typically
    runs inside an existing event loop (FastAPI request handler), so
    `asyncio.run` would refuse — fall through to a worker thread that
    spins up its own loop.
    """
    try:
        return asyncio.run(_invoke_sub_agent_async(sub_agent_name, task))
    except RuntimeError as exc:
        if "asyncio.run() cannot be called" not in str(exc):
            raise

    container: dict[str, Any] = {}

    def _runner() -> None:
        try:
            container["result"] = asyncio.run(
                _invoke_sub_agent_async(sub_agent_name, task)
            )
        except Exception as inner:  # pragma: no cover -- defensive
            container["error"] = inner

    worker = threading.Thread(target=_runner, daemon=True)
    worker.start()
    worker.join()

    if "error" in container:
        raise container["error"]
    return str(container["result"])


def _delegate(sub_agent_name: str, task: str) -> Content:
    """Common delegation flow: invoke sub-agent, append entry, push state."""
    delegations = list(_current_delegations.get())
    entry_id = str(uuid.uuid4())
    try:
        result_text = _invoke_sub_agent(sub_agent_name, task)
    except Exception as exc:
        logger.exception("subagents: %s delegation failed", sub_agent_name)
        delegations.append(
            {
                "id": entry_id,
                "sub_agent": sub_agent_name,
                "task": task,
                "status": "failed",
                # Surface only the exception class — sub-agent error
                # messages can leak chat client URLs / quota details
                # in deployed environments.
                "result": (f"sub-agent error: {exc.__class__.__name__}"),
            }
        )
        # Mirror the contextvar so a follow-up sub-agent call within the
        # same supervisor turn sees this entry.
        _current_delegations.set(delegations)
        return state_update(
            text=(f"{sub_agent_name} failed; surfaced in delegation log."),
            state={"delegations": delegations},
        )

    delegations.append(
        {
            "id": entry_id,
            "sub_agent": sub_agent_name,
            "task": task,
            "status": "completed",
            "result": result_text,
        }
    )
    _current_delegations.set(delegations)
    return state_update(
        text=result_text,
        state={"delegations": delegations},
    )


# ---------------------------------------------------------------------------
# Supervisor delegation tools — each one wraps a sub-agent invocation.
# ---------------------------------------------------------------------------


# Each @tool wraps a sub-agent invocation. The supervisor LLM "calls"
# these tools to delegate work; each call synchronously runs the
# matching sub-agent (via `_delegate`), appends the entry to the
# `delegations` shared-state slot, and returns a `state_update(...)` so
# the AG-UI emitter pushes a deterministic StateSnapshotEvent — both
# surfacing the result to the supervisor and refreshing the live
# delegation log in the UI.
@tool(
    name="research_agent",
    description=(
        "Delegate a research task to the research sub-agent. Use for "
        "gathering facts, background, definitions, statistics. Returns "
        "a bulleted list of key facts."
    ),
)
def research_agent(
    task: Annotated[
        str,
        Field(description="The research question or topic to investigate."),
    ],
) -> Content:
    """Delegate a research task to the research sub-agent."""
    return _delegate("research_agent", task)


@tool(
    name="writing_agent",
    description=(
        "Delegate a drafting task to the writing sub-agent. Use for "
        "producing a polished paragraph, draft, or summary. Pass any "
        "relevant facts from prior research inside `task`."
    ),
)
def writing_agent(
    task: Annotated[
        str,
        Field(
            description=(
                "The drafting brief, including any relevant source "
                "facts the writer should weave in."
            )
        ),
    ],
) -> Content:
    """Delegate a drafting task to the writing sub-agent."""
    return _delegate("writing_agent", task)


@tool(
    name="critique_agent",
    description=(
        "Delegate a critique task to the critique sub-agent. Use for "
        "reviewing a draft and suggesting concrete improvements."
    ),
)
def critique_agent(
    task: Annotated[
        str,
        Field(
            description=(
                "The draft text to critique. Provide the full text -- "
                "the critique sub-agent has no other context."
            )
        ),
    ],
) -> Content:
    """Delegate a critique task to the critique sub-agent."""
    return _delegate("critique_agent", task)


# @endregion[supervisor-delegation-tools]


# ---------------------------------------------------------------------------
# Supervisor agent factory
# ---------------------------------------------------------------------------


SUPERVISOR_PROMPT = dedent(
    """
    You are a supervisor agent that coordinates three specialized
    sub-agents to produce high-quality deliverables.

    Available sub-agents (call them as tools):
      - research_agent: gathers facts on a topic.
      - writing_agent:  turns facts + a brief into a polished draft.
      - critique_agent: reviews a draft and suggests improvements.

    For most non-trivial user requests, delegate in sequence:
    research -> write -> critique. Pass the relevant facts/draft
    through the `task` argument of each tool.

    Keep your own messages short — explain the plan once, delegate,
    then return a concise summary once done. The UI shows the user a
    live log of every sub-agent delegation.
    """
).strip()


def create_subagents_agent(chat_client: BaseChatClient) -> AgentFrameworkAgent:
    """Instantiate the Sub-Agents demo supervisor."""
    # Build (and cache) the three sub-agents so the @tool entry points
    # can find them via the module-level registry.
    _SUB_AGENTS["research_agent"] = _make_sub_agent(
        chat_client, "research_agent", _RESEARCH_INSTRUCTIONS
    )
    _SUB_AGENTS["writing_agent"] = _make_sub_agent(
        chat_client, "writing_agent", _WRITING_INSTRUCTIONS
    )
    _SUB_AGENTS["critique_agent"] = _make_sub_agent(
        chat_client, "critique_agent", _CRITIQUE_INSTRUCTIONS
    )

    base_agent = Agent(
        client=chat_client,
        name="subagents_supervisor",
        instructions=SUPERVISOR_PROMPT,
        tools=[research_agent, writing_agent, critique_agent],
        middleware=[capture_current_state],
    )

    return AgentFrameworkAgent(
        agent=base_agent,
        name="CopilotKitMSAgentSubagentsSupervisor",
        description=(
            "Supervisor agent. Delegates research / writing / critique "
            "to specialized sub-agents and surfaces the live "
            "delegation log to the UI via shared state."
        ),
        state_schema=STATE_SCHEMA,
        require_confirmation=False,
    )
