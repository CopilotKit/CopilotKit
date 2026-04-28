"""Agno agent backing the Sub-Agents demo.

Mirrors `langgraph-python/src/agents/subagents.py` and
`google-adk/src/agents/subagents_agent.py`.

A supervisor Agno agent delegates work to three specialized sub-agents
(research / writing / critique) exposed as tools. Each delegation
appends an entry to `session_state["delegations"]` so the UI can render
a live delegation log via `useAgent({ updates: [OnStateChanged] })`.

Each sub-agent is itself a full `Agent(...)` with its own system prompt
— the supervisor only sees the sub-agent's final text response. This is
the canonical Agno multi-agent pattern, surfaced to the frontend via
shared state.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

import dotenv
from agno.agent.agent import Agent
from agno.models.openai import OpenAIChat
from agno.run import RunContext

dotenv.load_dotenv()

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Sub-agents (real Agno agents under the hood)
# ---------------------------------------------------------------------------

_SUB_MODEL_ID = "gpt-4o-mini"


# @region[subagent-setup]
# Each sub-agent is a full Agno `Agent(...)` with its own system prompt.
# They don't share memory or tools with the supervisor — the supervisor
# only sees their final text response, which is returned via the
# delegation tool below.
_research_agent = Agent(
    model=OpenAIChat(id=_SUB_MODEL_ID, timeout=120),
    description="Research sub-agent.",
    instructions=(
        "You are a research sub-agent. Given a topic, produce a concise "
        "bulleted list of 3-5 key facts. No preamble, no closing."
    ),
)

_writing_agent = Agent(
    model=OpenAIChat(id=_SUB_MODEL_ID, timeout=120),
    description="Writing sub-agent.",
    instructions=(
        "You are a writing sub-agent. Given a brief and optional source "
        "facts, produce a polished 1-paragraph draft. Be clear and "
        "concrete. No preamble."
    ),
)

_critique_agent = Agent(
    model=OpenAIChat(id=_SUB_MODEL_ID, timeout=120),
    description="Critique sub-agent.",
    instructions=(
        "You are an editorial critique sub-agent. Given a draft, give "
        "2-3 crisp, actionable critiques. No preamble."
    ),
)
# @endregion[subagent-setup]


def _invoke_sub_agent(sub_agent: Agent, task: str) -> str:
    """Run a sub-agent on `task` and return its final message content."""
    result = sub_agent.run(input=task)
    content = getattr(result, "content", None)
    if isinstance(content, str):
        return content.strip()
    if content is None:
        return ""
    return str(content).strip()


# ---------------------------------------------------------------------------
# Shared-state helpers
# ---------------------------------------------------------------------------


def _append_delegation(
    run_context: RunContext,
    *,
    sub_agent: str,
    task: str,
    status: str,
    result: str,
) -> str:
    """Append a delegation entry and return its id."""
    if run_context.session_state is None:
        run_context.session_state = {}
    delegations = list(run_context.session_state.get("delegations") or [])
    entry_id = str(uuid.uuid4())
    delegations.append(
        {
            "id": entry_id,
            "sub_agent": sub_agent,
            "task": task,
            "status": status,
            "result": result,
        }
    )
    run_context.session_state["delegations"] = delegations
    return entry_id


def _update_delegation(
    run_context: RunContext,
    *,
    entry_id: str,
    status: str,
    result: str,
) -> None:
    """Mutate the delegation entry with `entry_id` in shared state.

    If the entry has gone missing (another part of the system replaced
    `session_state["delegations"]`), log loudly and skip rather than
    appending a synthetic entry. Mirrors the conservative behavior used
    in the google-adk reference.
    """
    if run_context.session_state is None:
        run_context.session_state = {}
    delegations = list(run_context.session_state.get("delegations") or [])
    for entry in delegations:
        if entry.get("id") == entry_id:
            entry["status"] = status
            entry["result"] = result
            run_context.session_state["delegations"] = delegations
            return
    logger.warning(
        "subagents: delegation entry %s missing on update — final %s "
        "state (result_length=%d) will not be rendered",
        entry_id,
        status,
        len(result),
    )


def _delegate(
    run_context: RunContext,
    *,
    sub_agent_name: str,
    sub_agent: Agent,
    task: str,
) -> dict[str, Any]:
    """Common delegation flow: append running entry → invoke → update final."""
    entry_id = _append_delegation(
        run_context,
        sub_agent=sub_agent_name,
        task=task,
        status="running",
        result="",
    )
    try:
        result = _invoke_sub_agent(sub_agent, task)
    except Exception as exc:  # noqa: BLE001 — sub-agent transport can fail anywhere
        logger.exception("subagents: sub-agent %s failed", sub_agent_name)
        # Surface only the exception class to the supervisor / frontend —
        # provider error strings can carry URLs / request IDs / partial
        # credentials. The full traceback stays in server logs.
        message = (
            f"sub-agent call failed: {exc.__class__.__name__} "
            "(see server logs for details)"
        )
        _update_delegation(
            run_context, entry_id=entry_id, status="failed", result=message
        )
        return {"status": "failed", "error": message}

    _update_delegation(
        run_context, entry_id=entry_id, status="completed", result=result
    )
    return {"status": "completed", "result": result}


# ---------------------------------------------------------------------------
# Supervisor tools (each tool delegates to one sub-agent)
# ---------------------------------------------------------------------------


# @region[supervisor-delegation-tools]
# Each function is a tool exposed to the supervisor agent. The supervisor
# LLM "calls" these to delegate work; each call synchronously runs the
# matching sub-agent, records the delegation into shared state, and
# returns the sub-agent's output as the tool result the supervisor reads
# on its next step.
def research_agent(run_context: RunContext, task: str) -> dict[str, Any]:
    """Delegate a research task to the research sub-agent.

    Use for: gathering facts, background, definitions, statistics.
    Returns {status, result} on success or {status: "failed", error} on
    sub-agent failure.
    """
    return _delegate(
        run_context,
        sub_agent_name="research_agent",
        sub_agent=_research_agent,
        task=task,
    )


def writing_agent(run_context: RunContext, task: str) -> dict[str, Any]:
    """Delegate a drafting task to the writing sub-agent.

    Use for: producing a polished paragraph, draft, or summary. Pass
    relevant facts from prior research inside `task`. Same return shape
    as research_agent.
    """
    return _delegate(
        run_context,
        sub_agent_name="writing_agent",
        sub_agent=_writing_agent,
        task=task,
    )


def critique_agent(run_context: RunContext, task: str) -> dict[str, Any]:
    """Delegate a critique task to the critique sub-agent.

    Use for: reviewing a draft and suggesting concrete improvements.
    Same return shape as research_agent.
    """
    return _delegate(
        run_context,
        sub_agent_name="critique_agent",
        sub_agent=_critique_agent,
        task=task,
    )
# @endregion[supervisor-delegation-tools]


# ---------------------------------------------------------------------------
# Supervisor (the agent we export)
# ---------------------------------------------------------------------------


_SUPERVISOR_INSTRUCTION = (
    "You are a supervisor agent that coordinates three specialized "
    "sub-agents to produce high-quality deliverables.\n\n"
    "Available sub-agents (call them as tools):\n"
    "  - research_agent: gathers facts on a topic.\n"
    "  - writing_agent: turns facts + a brief into a polished draft.\n"
    "  - critique_agent: reviews a draft and suggests improvements.\n\n"
    "For most non-trivial user requests, delegate in sequence: "
    "research -> write -> critique. Pass the relevant facts/draft "
    "through the `task` argument of each tool. Each tool returns a dict "
    "shaped {status: 'completed' | 'failed', result?: str, error?: str}. "
    "If a sub-agent fails, surface the failure briefly to the user "
    "(don't fabricate a result) and decide whether to retry. Keep your "
    "own messages short — explain the plan once, delegate, then return a "
    "concise summary once done. The UI shows the user a live log of "
    "every sub-agent delegation, including the in-flight 'running' state."
)


agent = Agent(
    model=OpenAIChat(id=_SUB_MODEL_ID, timeout=120),
    tools=[research_agent, writing_agent, critique_agent],
    description="Supervisor agent coordinating research / writing / critique sub-agents.",
    instructions=_SUPERVISOR_INSTRUCTION,
    tool_call_limit=10,
)
