"""PydanticAI agent backing the Sub-Agents demo.

Mirrors langgraph-python/src/agents/subagents.py and
google-adk/src/agents/subagents_agent.py: a top-level "supervisor"
:class:`Agent` orchestrates three specialised sub-:class:`Agent`
instances (research / writing / critique) via tools. Each delegation
appends an entry to the ``delegations`` slot of shared agent state so
the UI can render a live delegation log.

PydanticAI specifics
--------------------
* Each sub-agent is a real ``Agent(model=..., system_prompt=...)`` that
  the supervisor invokes via ``await Agent.run(...)``. The supervisor
  itself runs inside an async event loop (the AG-UI handler awaits
  ``agent.run``); calling ``run_sync`` from a tool would attempt to
  start a nested loop and raise ``RuntimeError``.
* Each delegation tool is an async ``@supervisor.tool`` that
    1) appends a "running" entry to ``ctx.deps.state.delegations``
       and emits a ``StateSnapshotEvent`` so the UI updates immediately,
    2) runs the sub-agent,
    3) flips the entry to ``"completed"`` (or ``"failed"``) and emits a
       second ``StateSnapshotEvent`` with the final result.

The supervisor and sub-agents do not share memory — only the supervisor
sees a sub-agent's return value, exactly like the LangGraph-Python and
Google ADK references.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field
from pydantic_ai import Agent, RunContext
from pydantic_ai.ag_ui import StateDeps
from pydantic_ai.models.openai import OpenAIResponsesModel

logger = logging.getLogger(__name__)


SubAgentName = Literal["research_agent", "writing_agent", "critique_agent"]
DelegationStatus = Literal["running", "completed", "failed"]


# ── Shared state ────────────────────────────────────────────────────


class Delegation(BaseModel):
    """One sub-agent invocation, surfaced in the UI's delegation log."""

    id: str
    sub_agent: str  # SubAgentName at runtime; widened so model_dump round-trips
    task: str
    status: str  # DelegationStatus at runtime
    result: str = ""


class SubagentsState(BaseModel):
    """Shared state. ``delegations`` is rendered as a live log in the UI."""

    delegations: list[Delegation] = Field(default_factory=list)


# ── Sub-agents (real PydanticAI Agents) ─────────────────────────────


# @region[subagent-setup]
# Each sub-agent is a full-fledged ``Agent(model=..., system_prompt=...)``
# with its own system prompt. They don't share memory or tools with the
# supervisor — the supervisor only sees their return value.
_SUB_MODEL = OpenAIResponsesModel("gpt-4o-mini")

_research_agent: Agent[None, str] = Agent(
    model=_SUB_MODEL,
    system_prompt=(
        "You are a research sub-agent. Given a topic, produce a concise "
        "bulleted list of 3-5 key facts. No preamble, no closing."
    ),
)

_writing_agent: Agent[None, str] = Agent(
    model=_SUB_MODEL,
    system_prompt=(
        "You are a writing sub-agent. Given a brief and optional source "
        "facts, produce a polished 1-paragraph draft. Be clear and "
        "concrete. No preamble."
    ),
)

_critique_agent: Agent[None, str] = Agent(
    model=_SUB_MODEL,
    system_prompt=(
        "You are an editorial critique sub-agent. Given a draft, give "
        "2-3 crisp, actionable critiques. No preamble."
    ),
)
# @endregion[subagent-setup]


async def _invoke_sub_agent(sub_agent: Agent[None, str], task: str) -> str:
    """Run a sub-agent on ``task`` and return its final text output.

    Uses the async ``Agent.run`` API rather than ``run_sync`` because the
    supervisor itself executes inside a running event loop (AG-UI awaits
    ``agent.run``); ``run_sync`` from inside a running loop raises
    ``RuntimeError: This event loop is already running``.
    """
    result = await sub_agent.run(task)
    output: Any = result.output
    return str(output) if output is not None else ""


# ── Supervisor ──────────────────────────────────────────────────────


_SUPERVISOR_PROMPT = (
    "You are a supervisor agent that coordinates three specialized "
    "sub-agents to produce high-quality deliverables.\n\n"
    "Available sub-agents (call them as tools):\n"
    "  - research_agent: gathers facts on a topic.\n"
    "  - writing_agent: turns facts + a brief into a polished draft.\n"
    "  - critique_agent: reviews a draft and suggests improvements.\n\n"
    "For most non-trivial user requests, delegate in sequence: research -> "
    "write -> critique. Pass the relevant facts/draft through the `task` "
    "argument of each tool. Each tool returns the sub-agent's output as a "
    "string. Keep your own messages short — explain the plan once, "
    "delegate, then return a concise summary once done. The UI shows the "
    "user a live log of every sub-agent delegation, including the "
    "in-flight 'running' state."
)


agent = Agent(
    model=OpenAIResponsesModel("gpt-4o-mini"),
    deps_type=StateDeps[SubagentsState],
    system_prompt=_SUPERVISOR_PROMPT,
)


def _append_running(
    ctx: RunContext[StateDeps[SubagentsState]],
    *,
    sub_agent: SubAgentName,
    task: str,
) -> str:
    """Append a ``running`` delegation entry and return its id."""
    entry = Delegation(
        id=str(uuid.uuid4()),
        sub_agent=sub_agent,
        task=task,
        status="running",
        result="",
    )
    ctx.deps.state.delegations = [*ctx.deps.state.delegations, entry]
    return entry.id


def _finalise(
    ctx: RunContext[StateDeps[SubagentsState]],
    *,
    entry_id: str,
    status: DelegationStatus,
    result: str,
) -> None:
    """Mutate the delegation entry with ``entry_id`` to its terminal state.

    If the entry has gone missing (e.g. another part of the system replaced
    ``state.delegations`` mid-turn) we log a warning and skip rather than
    appending a synthetic entry — same defensive choice as google-adk's
    ``_update_delegation``.
    """
    delegations = list(ctx.deps.state.delegations)
    for idx, entry in enumerate(delegations):
        if entry.id == entry_id:
            delegations[idx] = entry.model_copy(
                update={"status": status, "result": result}
            )
            ctx.deps.state.delegations = delegations
            return
    logger.warning(
        "subagents: delegation entry %s missing on update — final %s state "
        "(result_length=%d) will not be rendered",
        entry_id,
        status,
        len(result),
    )


# ── Delegation tools ────────────────────────────────────────────────


async def _delegate(
    ctx: RunContext[StateDeps[SubagentsState]],
    *,
    sub_agent: SubAgentName,
    sub_agent_obj: Agent[None, str],
    task: str,
) -> str:
    """Common delegation flow: append running → invoke → finalise.

    Returns the sub-agent's output text so the supervisor LLM can read it
    on its next step. State mutations (running entry + final entry) are
    written through ``ctx.deps.state``; PydanticAI's AG-UI bridge syncs
    those back to the frontend at end-of-turn so the delegation log
    re-renders automatically.
    """
    entry_id = _append_running(ctx, sub_agent=sub_agent, task=task)
    try:
        result = await _invoke_sub_agent(sub_agent_obj, task)
    except Exception as exc:  # noqa: BLE001 — surface failure to supervisor
        logger.exception("subagents: %s failed", sub_agent)
        message = (
            f"sub-agent {sub_agent} failed: {exc.__class__.__name__} "
            "(see server logs for details)"
        )
        _finalise(ctx, entry_id=entry_id, status="failed", result=message)
        return message
    _finalise(ctx, entry_id=entry_id, status="completed", result=result)
    return result


# @region[supervisor-delegation-tools]
# Each ``@agent.tool`` wraps a sub-agent invocation. The supervisor LLM
# "calls" these tools to delegate work; each call asynchronously runs the
# matching sub-agent, records the delegation into shared state, and
# returns the sub-agent's output as a string the supervisor can read on
# its next step.
@agent.tool
async def research_agent(
    ctx: RunContext[StateDeps[SubagentsState]],
    task: str,
) -> str:
    """Delegate a research task to the research sub-agent.

    Use for: gathering facts, background, definitions, statistics.
    Returns a bulleted list of key facts.
    """
    return await _delegate(
        ctx,
        sub_agent="research_agent",
        sub_agent_obj=_research_agent,
        task=task,
    )


@agent.tool
async def writing_agent(
    ctx: RunContext[StateDeps[SubagentsState]],
    task: str,
) -> str:
    """Delegate a drafting task to the writing sub-agent.

    Use for: producing a polished paragraph, draft, or summary. Pass
    relevant facts from prior research inside ``task``.
    """
    return await _delegate(
        ctx,
        sub_agent="writing_agent",
        sub_agent_obj=_writing_agent,
        task=task,
    )


@agent.tool
async def critique_agent(
    ctx: RunContext[StateDeps[SubagentsState]],
    task: str,
) -> str:
    """Delegate a critique task to the critique sub-agent.

    Use for: reviewing a draft and suggesting concrete improvements.
    """
    return await _delegate(
        ctx,
        sub_agent="critique_agent",
        sub_agent_obj=_critique_agent,
        task=task,
    )
# @endregion[supervisor-delegation-tools]


__all__: list[str] = [
    "SubagentsState",
    "Delegation",
    "agent",
]
