"""AG2 agent for the Sub-Agents demo.

Demonstrates multi-agent delegation with a visible delegation log.

A top-level "supervisor" Agent orchestrates three specialized
sub-agents — each itself an ag2 ``Agent`` — exposed as supervisor tools:

  - `research_agent`  — gathers facts
  - `writing_agent`   — drafts prose
  - `critique_agent`  — reviews drafts

Every delegation appends an entry to the `delegations` slot in shared
agent state (via ``Context.variables`` plus an explicit intermediate
``STATE_SNAPSHOT`` event), so the UI can render a live "delegation log"
as the supervisor fans work out and collects results. This is the
canonical AG2 sub-agents-as-tools pattern, adapted to surface delegation
events to the frontend via AG-UI's shared-state channel.
"""

# @region[supervisor-delegation-tools]
# @region[subagent-setup]
import logging
import uuid
from textwrap import dedent
from typing import Annotated, List, Literal

from ag_ui.core import StateSnapshotEvent
from fastapi import FastAPI
from pydantic import BaseModel, Field

from ag2 import Agent, Context, tool
from ag2.ag_ui import AGUIEvent, AGUIStream
from ag2.config import OpenAIConfig

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
# Sub-agents (real ag2 Agents under the hood)
# ---------------------------------------------------------------------------
#
# Each sub-agent is its own LLM Agent with a focused prompt. They don't
# share memory or tools with the supervisor — the supervisor only sees
# what each sub-agent's final reply produces.

_SUB_CONFIG = OpenAIConfig(model="gpt-4o-mini")

_research_agent = Agent(
    name="research_sub_agent",
    prompt=dedent(
        """
        You are a research sub-agent. Given a topic, produce a concise
        bulleted list of 3-5 key facts. No preamble, no closing.
        """
    ).strip(),
    config=_SUB_CONFIG,
)

_writing_agent = Agent(
    name="writing_sub_agent",
    prompt=dedent(
        """
        You are a writing sub-agent. Given a brief and optional source
        facts, produce a polished 1-paragraph draft. Be clear and
        concrete. No preamble.
        """
    ).strip(),
    config=_SUB_CONFIG,
)

_critique_agent = Agent(
    name="critique_sub_agent",
    prompt=dedent(
        """
        You are an editorial critique sub-agent. Given a draft, produce
        2-3 crisp, actionable critiques. No preamble.
        """
    ).strip(),
    config=_SUB_CONFIG,
)
# @endregion[subagent-setup]


async def _invoke_sub_agent(sub_agent: Agent, task: str) -> str:
    """Run a sub-agent on `task` and return its final reply text.

    ``Agent.ask`` runs a one-shot conversation on a fresh stream and is
    natively async, so the event loop stays responsive while the LLM
    round-trip is in flight.
    """
    reply = await sub_agent.ask(task)
    return await reply.content() or ""


def _load_snapshot(variables: dict) -> SubagentsSnapshot:
    """Best-effort load of the SubagentsSnapshot from conversation variables.

    Logs at WARNING when state fails validation so silent corruption is
    visible in server logs instead of degrading to an empty snapshot
    without a trace.
    """
    try:
        return SubagentsSnapshot.model_validate(
            {"delegations": variables.get("delegations", [])}
        )
    except Exception as exc:
        logger.warning(
            "subagents: failed to validate SubagentsSnapshot from conversation "
            "variables (%s: %s); falling back to empty snapshot",
            exc.__class__.__name__,
            exc,
        )
        return SubagentsSnapshot()


async def _record_delegation(
    context: Context,
    sub_agent: SubAgentName,
    task: str,
    result: str,
    status: DelegationStatus = "completed",
) -> str:
    """Append a delegation entry to shared state and return the result text.

    Mutating ``context.variables`` alone would only surface in the
    automatic ``STATE_SNAPSHOT`` at the END of the run, so we also emit
    an intermediate snapshot right away — the UI's delegation log
    re-renders live after every delegation.
    """
    snapshot = _load_snapshot(context.variables)
    snapshot.delegations.append(
        Delegation(
            id=str(uuid.uuid4()),
            sub_agent=sub_agent,
            task=task,
            status=status,
            result=result,
        )
    )
    context.variables.update(snapshot.model_dump())
    await context.send(
        AGUIEvent(StateSnapshotEvent(snapshot=dict(context.variables)))
    )
    return result


async def _run_delegation(
    context: Context,
    sub_agent_name: SubAgentName,
    sub_agent: Agent,
    task: str,
) -> str:
    """Invoke a sub-agent and record the outcome (completed or failed).

    If the underlying ``ask`` raises (transport error, quota, SDK bug,
    ...), we record the delegation with ``status='failed'`` and return a
    sane result string so the supervisor can recover instead of crashing
    the turn. The full traceback is logged server-side; the user-facing
    ``result`` text only mentions the exception class to avoid leaking
    internals.
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
        return await _record_delegation(
            context,
            sub_agent_name,
            task,
            failure_message,
            status="failed",
        )

    return await _record_delegation(
        context,
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
# Context.variables (+ an intermediate STATE_SNAPSHOT so the log updates
# live), and returns the sub-agent's text as its tool output.
@tool
async def research_agent(
    task: Annotated[
        str,
        Field(description="The specific research question or topic to investigate."),
    ],
    context: Context,
) -> str:
    """Delegate a research task to the research sub-agent.

    Use for: gathering facts, background, definitions, statistics. Returns
    a bulleted list of key facts.
    """
    return await _run_delegation(context, "research_agent", _research_agent, task)


@tool
async def writing_agent(
    task: Annotated[
        str,
        Field(description="The brief plus any relevant facts the writer should use."),
    ],
    context: Context,
) -> str:
    """Delegate a drafting task to the writing sub-agent.

    Use for: producing a polished paragraph, draft, or summary. Pass
    relevant facts from prior research inside ``task``.
    """
    return await _run_delegation(context, "writing_agent", _writing_agent, task)


@tool
async def critique_agent(
    task: Annotated[
        str,
        Field(description="The draft to critique (paste it directly into task)."),
    ],
    context: Context,
) -> str:
    """Delegate a critique task to the critique sub-agent.

    Use for: reviewing a draft and suggesting concrete improvements.
    """
    return await _run_delegation(context, "critique_agent", _critique_agent, task)


# @endregion[supervisor-delegation-tools]


# ---------------------------------------------------------------------------
# Supervisor (the agent we export)
# ---------------------------------------------------------------------------

supervisor = Agent(
    name="supervisor",
    prompt=dedent(
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
    config=OpenAIConfig(model="gpt-4o-mini", streaming=True),
    tools=[research_agent, writing_agent, critique_agent],
)

stream = AGUIStream(supervisor)
subagents_app = FastAPI()
subagents_app.mount("", stream.build_asgi())
