"""AG2 agent for the Sub-Agents demo.

Demonstrates multi-agent delegation with a visible delegation log.

A top-level "supervisor" ConversableAgent orchestrates three specialized
sub-agents — each itself a ConversableAgent — exposed as supervisor tools:

  - `research_agent`  — gathers facts
  - `writing_agent`   — drafts prose
  - `critique_agent`  — reviews drafts

Every delegation appends an entry to the `delegations` slot in shared
agent state (via AG2's ContextVariables + ReplyResult), so the UI can
render a live "delegation log" as the supervisor fans work out and
collects results. This is the canonical AG2 sub-agents-as-tools pattern,
adapted to surface delegation events to the frontend via AG-UI's
shared-state channel.
"""

# @region[supervisor-delegation-tools]
# @region[subagent-setup]
import asyncio
import logging
import uuid
from textwrap import dedent
from typing import List, Literal

from autogen import ConversableAgent, LLMConfig
from autogen.ag_ui import AGUIStream
from autogen.agentchat import ContextVariables, ReplyResult
from autogen.tools import tool
from fastapi import FastAPI
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


SubAgentName = Literal["research_agent", "writing_agent", "critique_agent"]
DelegationStatus = Literal["running", "completed", "failed"]


class Delegation(BaseModel):
    """One entry in the delegation log shown by the UI."""

    id: str
    sub_agent: SubAgentName
    task: str
    status: DelegationStatus = "completed"
    result: str = ""


class SubagentsSnapshot(BaseModel):
    """Shape of the shared `delegations` state slot rendered by the UI."""

    delegations: List[Delegation] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Sub-agents (real ConversableAgents under the hood)
# ---------------------------------------------------------------------------
#
# Each sub-agent is its own LLM ConversableAgent with a focused system
# prompt. They don't share memory or tools with the supervisor — the
# supervisor only sees what each sub-agent's final reply produces.

_SUB_LLM_CONFIG = LLMConfig({"model": "gpt-4o-mini", "stream": False})

_research_agent = ConversableAgent(
    name="research_sub_agent",
    system_message=dedent(
        """
        You are a research sub-agent. Given a topic, produce a concise
        bulleted list of 3-5 key facts. No preamble, no closing.
        """
    ).strip(),
    llm_config=_SUB_LLM_CONFIG,
    human_input_mode="NEVER",
    max_consecutive_auto_reply=1,
)

_writing_agent = ConversableAgent(
    name="writing_sub_agent",
    system_message=dedent(
        """
        You are a writing sub-agent. Given a brief and optional source
        facts, produce a polished 1-paragraph draft. Be clear and
        concrete. No preamble.
        """
    ).strip(),
    llm_config=_SUB_LLM_CONFIG,
    human_input_mode="NEVER",
    max_consecutive_auto_reply=1,
)

_critique_agent = ConversableAgent(
    name="critique_sub_agent",
    system_message=dedent(
        """
        You are an editorial critique sub-agent. Given a draft, produce
        2-3 crisp, actionable critiques. No preamble.
        """
    ).strip(),
    llm_config=_SUB_LLM_CONFIG,
    human_input_mode="NEVER",
    max_consecutive_auto_reply=1,
)
# @endregion[subagent-setup]


async def _invoke_sub_agent(sub_agent: ConversableAgent, task: str) -> str:
    """Run a sub-agent on `task` and return its final reply text.

    `generate_reply` produces a single LLM completion against a one-shot
    user message. AG2's ``generate_reply`` is synchronous and performs a
    blocking LLM round-trip, so we offload it to a worker thread to keep
    the asyncio event loop responsive while the call is in flight.
    """
    reply = await asyncio.to_thread(
        sub_agent.generate_reply,
        messages=[{"role": "user", "content": task}],
    )
    if reply is None:
        return ""
    if isinstance(reply, dict):
        # ConversableAgent.generate_reply may return {"content": "..."}.
        return str(reply.get("content") or "")
    return str(reply)


def _load_snapshot(context_variables: ContextVariables) -> SubagentsSnapshot:
    """Best-effort load of the SubagentsSnapshot from context variables.

    Logs at WARNING when state fails validation so silent corruption is
    visible in server logs instead of degrading to an empty snapshot
    without a trace.
    """
    data = context_variables.data or {}
    try:
        return SubagentsSnapshot.model_validate(data)
    except Exception as exc:
        logger.warning(
            "subagents: failed to validate SubagentsSnapshot from context "
            "variables (%s: %s); falling back to empty snapshot",
            exc.__class__.__name__,
            exc,
        )
        return SubagentsSnapshot()


def _record_delegation(
    context_variables: ContextVariables,
    sub_agent: SubAgentName,
    task: str,
    result: str,
    status: DelegationStatus = "completed",
) -> ReplyResult:
    """Append a delegation entry to shared state and return ReplyResult."""
    snapshot = _load_snapshot(context_variables)
    snapshot.delegations.append(
        Delegation(
            id=str(uuid.uuid4()),
            sub_agent=sub_agent,
            task=task,
            status=status,
            result=result,
        )
    )
    context_variables.update(snapshot.model_dump())
    return ReplyResult(
        message=result,
        context_variables=context_variables,
    )


async def _run_delegation(
    context_variables: ContextVariables,
    sub_agent_name: SubAgentName,
    sub_agent: ConversableAgent,
    task: str,
) -> ReplyResult:
    """Invoke a sub-agent and record the outcome (completed or failed).

    If the underlying ``generate_reply`` raises (transport error, quota,
    SDK bug, ...), we record the delegation with ``status='failed'`` and
    return a sane ReplyResult so the supervisor can recover instead of
    crashing the turn. The full traceback is logged server-side; the
    user-facing ``result`` text only mentions the exception class to
    avoid leaking internals.
    """
    try:
        result = await _invoke_sub_agent(sub_agent, task)
    except Exception as exc:
        logger.exception(
            "subagents: sub-agent %s failed while handling task", sub_agent_name
        )
        failure_message = (
            f"sub-agent call failed: {exc.__class__.__name__} (see server logs)"
        )
        return _record_delegation(
            context_variables,
            sub_agent_name,
            task,
            failure_message,
            status="failed",
        )

    return _record_delegation(
        context_variables,
        sub_agent_name,
        task,
        result,
        status="completed",
    )


# ---------------------------------------------------------------------------
# Supervisor tools (each tool delegates to one sub-agent)
# ---------------------------------------------------------------------------


# Each @tool wraps a sub-agent invocation. The supervisor LLM "calls"
# these tools to delegate work; each call asynchronously runs the
# matching sub-agent, records the delegation into shared state via
# ContextVariables, and returns a ReplyResult the supervisor reads as
# its tool output on the next step.
@tool()
async def research_agent(
    context_variables: ContextVariables,
    task: str,
) -> ReplyResult:
    """Delegate a research task to the research sub-agent.

    Use for: gathering facts, background, definitions, statistics. Returns
    a bulleted list of key facts.

    Args:
        task: The specific research question or topic to investigate.
    """
    return await _run_delegation(
        context_variables, "research_agent", _research_agent, task
    )


@tool()
async def writing_agent(
    context_variables: ContextVariables,
    task: str,
) -> ReplyResult:
    """Delegate a drafting task to the writing sub-agent.

    Use for: producing a polished paragraph, draft, or summary. Pass
    relevant facts from prior research inside ``task``.

    Args:
        task: The brief plus any relevant facts the writer should use.
    """
    return await _run_delegation(
        context_variables, "writing_agent", _writing_agent, task
    )


@tool()
async def critique_agent(
    context_variables: ContextVariables,
    task: str,
) -> ReplyResult:
    """Delegate a critique task to the critique sub-agent.

    Use for: reviewing a draft and suggesting concrete improvements.

    Args:
        task: The draft to critique (paste it directly into ``task``).
    """
    return await _run_delegation(
        context_variables, "critique_agent", _critique_agent, task
    )


# @endregion[supervisor-delegation-tools]


# ---------------------------------------------------------------------------
# Supervisor (the agent we export)
# ---------------------------------------------------------------------------

supervisor = ConversableAgent(
    name="supervisor",
    system_message=dedent(
        """
        You are a supervisor agent that coordinates three specialized
        sub-agents to produce high-quality deliverables.

        Available sub-agents (call them as tools):
          - research_agent: gathers facts on a topic.
          - writing_agent: turns facts + a brief into a polished draft.
          - critique_agent: reviews a draft and suggests improvements.

        For most non-trivial user requests, delegate in sequence:
        research -> write -> critique. Pass the relevant facts/draft
        through the `task` argument of each tool. Keep your own messages
        short — explain the plan once, delegate, then return a concise
        summary once done. The UI shows the user a live log of every
        sub-agent delegation, so don't repeat sub-agent output verbatim
        in your final reply — just summarize.
        """
    ).strip(),
    llm_config=LLMConfig({"model": "gpt-4o-mini", "stream": True}),
    human_input_mode="NEVER",
    # Limit supervisor steps to bound delegation fan-out.
    max_consecutive_auto_reply=8,
    functions=[research_agent, writing_agent, critique_agent],
)

stream = AGUIStream(supervisor)
subagents_app = FastAPI()
subagents_app.mount("", stream.build_asgi())
