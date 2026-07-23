"""LlamaIndex agent backing the Sub-Agents demo.

Mirrors `langgraph-python/src/agents/subagents.py` and
`google-adk/src/agents/subagents_agent.py`. A supervisor agent (the
default `AGUIChatWorkflow` wired below) delegates to three specialized
sub-agents — research / writing / critique — exposed as backend tools.

Each sub-agent is a stand-alone single-shot LLM call (mirrors the
google-adk pattern: a `FunctionAgent`-equivalent invocation per delegation
keeps the supervisor's tool surface small). Every delegation appends a
`Delegation` entry to `state["delegations"]`:

    {id, sub_agent, task, status: "running"|"completed"|"failed", result}

The router emits a `StateSnapshotWorkflowEvent` after every tool call, so
the frontend's `useAgent({ updates: [OnStateChanged] })` subscription
receives a live delegation log as the supervisor fans work out.

Implementation notes:
- We use a stand-alone `FunctionAgent` per sub-agent so each has its own
  isolated `system_prompt` and message context. The supervisor only sees
  the sub-agent's final text via the tool's return value.
- `state["delegations"]` is mutated in place inside the supervisor's
  tools; the router's state snapshot picks up the change automatically.
"""

# @region[supervisor-delegation-tools]
# @region[subagent-setup]
import logging
import os
import uuid
from typing import Annotated, Any

from llama_index.core.agent.workflow import FunctionAgent
from llama_index.core.workflow import Context
from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Sub-agents — one FunctionAgent per role, each with its own system prompt.
# These are stand-alone agents the supervisor cannot share memory with;
# the supervisor only sees the final text the sub-agent returns.
# ---------------------------------------------------------------------------

_openai_kwargs = {}
if os.environ.get("OPENAI_BASE_URL"):
    _openai_kwargs["api_base"] = os.environ["OPENAI_BASE_URL"]

_SUB_LLM = OpenAI(model="gpt-4.1-mini", **_openai_kwargs)

_RESEARCH_SYSTEM = (
    "You are a research sub-agent. Given a topic, produce a concise "
    "bulleted list of 3-5 key facts. No preamble, no closing."
)
_WRITING_SYSTEM = (
    "You are a writing sub-agent. Given a brief and optional source "
    "facts, produce a polished 1-paragraph draft. Be clear and concrete. "
    "No preamble."
)
_CRITIQUE_SYSTEM = (
    "You are an editorial critique sub-agent. Given a draft, give 2-3 "
    "crisp, actionable critiques. No preamble."
)


def _build_sub_agent(system_prompt: str, name: str) -> FunctionAgent:
    # `timeout=60` so a stalled sub-agent run can never wedge the
    # supervisor's tool call indefinitely.
    return FunctionAgent(
        name=name,
        description=system_prompt,
        llm=_SUB_LLM,
        tools=[],
        system_prompt=system_prompt,
        timeout=60,
    )


_research_sub = _build_sub_agent(_RESEARCH_SYSTEM, "research_sub")
_writing_sub = _build_sub_agent(_WRITING_SYSTEM, "writing_sub")
_critique_sub = _build_sub_agent(_CRITIQUE_SYSTEM, "critique_sub")
# @endregion[subagent-setup]


class _SubAgentError(Exception):
    """Raised when a sub-agent invocation fails.

    Carries a user-facing message safe to surface in the delegation log.
    """


async def _invoke_sub_agent(agent: FunctionAgent, task: str) -> str:
    """Run a sub-agent on `task` and return its final response text."""
    try:
        response = await agent.run(user_msg=task)
    except Exception as exc:  # noqa: BLE001 - we re-raise with safe message
        logger.exception("subagent: FunctionAgent.run failed")
        raise _SubAgentError(
            f"sub-agent call failed: {exc.__class__.__name__} "
            "(see server logs for details)"
        ) from exc

    text = str(response).strip()
    if not text:
        raise _SubAgentError("sub-agent returned empty text")
    return text


# ---------------------------------------------------------------------------
# Delegation log helpers (mutate state["delegations"] in place)
# ---------------------------------------------------------------------------


async def _append_running_delegation(ctx: Context, *, sub_agent: str, task: str) -> str:
    """Append a `running` delegation entry; return its id."""
    state: dict[str, Any] = await ctx.store.get("state", default={})
    delegations = list(state.get("delegations") or [])
    entry_id = str(uuid.uuid4())
    delegations.append(
        {
            "id": entry_id,
            "sub_agent": sub_agent,
            "task": task,
            "status": "running",
            "result": "",
        }
    )
    state["delegations"] = delegations
    await ctx.store.set("state", state)
    return entry_id


async def _finalize_delegation(
    ctx: Context, *, entry_id: str, status: str, result: str
) -> None:
    """Replace the matching entry's status + result.

    If the entry has gone missing (e.g. another writer replaced
    `state['delegations']` mid-turn) we log loudly and skip — slipping in
    a synthetic entry with `sub_agent='unknown'` would render as
    undefined badge text in `delegation-log.tsx`.
    """
    state: dict[str, Any] = await ctx.store.get("state", default={})
    delegations = list(state.get("delegations") or [])
    for entry in delegations:
        if entry.get("id") == entry_id:
            entry["status"] = status
            entry["result"] = result
            state["delegations"] = delegations
            await ctx.store.set("state", state)
            return
    logger.warning(
        "subagent: delegation entry %s missing on update — final %s "
        "state will not be rendered",
        entry_id,
        status,
    )


async def _delegate(
    ctx: Context, *, sub_agent_name: str, agent: FunctionAgent, task: str
) -> dict[str, Any]:
    """Append a running entry, run the sub-agent, finalize the entry."""
    entry_id = await _append_running_delegation(
        ctx, sub_agent=sub_agent_name, task=task
    )
    try:
        result = await _invoke_sub_agent(agent, task)
    except _SubAgentError as exc:
        await _finalize_delegation(
            ctx, entry_id=entry_id, status="failed", result=str(exc)
        )
        return {"status": "failed", "error": str(exc)}

    await _finalize_delegation(
        ctx, entry_id=entry_id, status="completed", result=result
    )
    return {"status": "completed", "result": result}


# ---------------------------------------------------------------------------
# Supervisor tools — each delegates to one sub-agent.
# ---------------------------------------------------------------------------


async def research_agent(
    ctx: Context,
    task: Annotated[
        str,
        "Research brief — the topic / question to gather facts on.",
    ],
) -> str:
    """Delegate a research task to the research sub-agent.

    Use for: gathering facts, background, definitions, statistics.
    Returns a JSON-ish string of {status, result|error}.
    """
    outcome = await _delegate(
        ctx,
        sub_agent_name="research_agent",
        agent=_research_sub,
        task=task,
    )
    return _stringify_outcome(outcome)


async def writing_agent(
    ctx: Context,
    task: Annotated[
        str,
        "Writing brief — include relevant facts from prior research.",
    ],
) -> str:
    """Delegate a drafting task to the writing sub-agent.

    Use for: producing a polished paragraph, draft, or summary. Pass
    relevant facts from prior research inside `task`.
    """
    outcome = await _delegate(
        ctx,
        sub_agent_name="writing_agent",
        agent=_writing_sub,
        task=task,
    )
    return _stringify_outcome(outcome)


async def critique_agent(
    ctx: Context,
    task: Annotated[str, "The draft to critique."],
) -> str:
    """Delegate a critique task to the critique sub-agent.

    Use for: reviewing a draft and suggesting concrete improvements.
    """
    outcome = await _delegate(
        ctx,
        sub_agent_name="critique_agent",
        agent=_critique_sub,
        task=task,
    )
    return _stringify_outcome(outcome)


# @endregion[supervisor-delegation-tools]


def _stringify_outcome(outcome: dict[str, Any]) -> str:
    """Render the delegation outcome as plain text the supervisor LLM can read."""
    if outcome.get("status") == "completed":
        return str(outcome.get("result") or "")
    return f"[sub-agent failed] {outcome.get('error') or 'unknown error'}"


# ---------------------------------------------------------------------------
# Supervisor (the workflow router we export).
# ---------------------------------------------------------------------------

SUPERVISOR_SYSTEM_PROMPT = (
    "You are a supervisor agent that coordinates three specialized "
    "sub-agents to produce high-quality deliverables.\n\n"
    "Available sub-agents (call them as tools):\n"
    "  - research_agent: gathers facts on a topic.\n"
    "  - writing_agent: turns facts + a brief into a polished draft.\n"
    "  - critique_agent: reviews a draft and suggests improvements.\n\n"
    "For most non-trivial user requests, delegate in sequence: "
    "research -> write -> critique. Pass the relevant facts/draft through "
    "the `task` argument of each tool. Each tool returns either the "
    "sub-agent's text output or a `[sub-agent failed]` prefix on failure. "
    "If a sub-agent fails, briefly surface the failure to the user (do "
    "not fabricate a result) and decide whether to retry. Keep your own "
    "messages short — explain the plan once, delegate, then return a "
    "concise summary once done. The UI renders a live log of every "
    "sub-agent delegation."
)


subagents_router = get_ag_ui_workflow_router(
    llm=OpenAI(model="gpt-4.1", **_openai_kwargs),
    frontend_tools=[],
    backend_tools=[research_agent, writing_agent, critique_agent],
    system_prompt=SUPERVISOR_SYSTEM_PROMPT,
    initial_state={"delegations": []},
)
