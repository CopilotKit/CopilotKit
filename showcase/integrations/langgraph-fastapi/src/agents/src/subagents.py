"""LangGraph agent backing the Sub-Agents demo.

Demonstrates multi-agent delegation with a visible delegation log.

A top-level "supervisor" LLM orchestrates three specialized sub-agents,
exposed as tools:

  - `research_agent`  — gathers facts
  - `writing_agent`   — drafts prose
  - `critique_agent`  — reviews drafts

Each sub-agent is a full `create_agent(...)` under the hood. Every
delegation appends an entry to the `delegations` slot in shared agent
state so the UI can render a live "delegation log" as the supervisor
fans work out and collects results. This is the canonical LangGraph
sub-agents-as-tools pattern, adapted to surface delegation events to
the frontend via CopilotKit's shared-state channel.

This is the FastAPI variant — the graph is exported and registered in
`langgraph.json`. Identical agent topology to the langgraph-python
reference; only the server framework differs.
"""

# @region[supervisor-delegation-tools]
# @region[subagent-setup]
import uuid
from operator import add
from typing import Annotated, Literal, TypedDict

from langchain.agents import AgentState as BaseAgentState, create_agent
from langchain.tools import ToolRuntime, tool
from langchain_core.messages import HumanMessage, ToolMessage
from langchain_openai import ChatOpenAI
from langgraph.types import Command

from copilotkit import CopilotKitMiddleware


# ---------------------------------------------------------------------------
# Shared state
# ---------------------------------------------------------------------------


class Delegation(TypedDict):
    id: str
    sub_agent: Literal["research_agent", "writing_agent", "critique_agent"]
    task: str
    status: Literal["running", "completed", "failed"]
    result: str


class AgentState(BaseAgentState):
    """Shared state. `delegations` is rendered as a live log in the UI.

    `delegations` uses `operator.add` as its channel reducer so concurrent
    tool calls within a single supervisor turn each contribute their own
    entry. Without a reducer, parallel `tool_calls` would each read the
    same snapshot and the channel would last-write-wins, silently dropping
    every delegation but one from the UI log.
    """

    delegations: Annotated[list[Delegation], add]


# ---------------------------------------------------------------------------
# Sub-agents (real LLM agents under the hood)
# ---------------------------------------------------------------------------

# Each sub-agent is a full-fledged `create_agent(...)` with its own
# system prompt. They don't share memory or tools with the supervisor —
# the supervisor only sees their return value.
_sub_model = ChatOpenAI(model="gpt-4o-mini")

_research_agent = create_agent(
    model=_sub_model,
    tools=[],
    system_prompt=(
        "You are a research sub-agent. Given a topic, produce a concise "
        "bulleted list of 3-5 key facts. No preamble, no closing."
    ),
)

_writing_agent = create_agent(
    model=_sub_model,
    tools=[],
    system_prompt=(
        "You are a writing sub-agent. Given a brief and optional source "
        "facts, produce a polished 1-paragraph draft. Be clear and "
        "concrete. No preamble."
    ),
)

_critique_agent = create_agent(
    model=_sub_model,
    tools=[],
    system_prompt=(
        "You are an editorial critique sub-agent. Given a draft, give "
        "2-3 crisp, actionable critiques. No preamble."
    ),
)
# @endregion[subagent-setup]


def _invoke_sub_agent(agent, task: str) -> str:
    """Run a sub-agent on `task` and return its final message content."""
    result = agent.invoke({"messages": [HumanMessage(content=task)]})
    messages = result.get("messages", [])
    if not messages:
        return ""
    return str(messages[-1].content)


def _delegation_command(
    sub_agent: str,
    task: str,
    status: Literal["completed", "failed"],
    result: str,
    tool_call_id: str,
) -> Command:
    """Build a Command that appends a single new delegation entry.

    Emits ONLY the new entry under `delegations`. The channel reducer
    (`operator.add` on `AgentState.delegations`) extends the existing
    list, so parallel tool calls within one supervisor turn each
    contribute their own entry instead of clobbering each other via a
    last-write-wins read-modify-write.
    """
    entry: Delegation = {
        "id": str(uuid.uuid4()),
        "sub_agent": sub_agent,  # type: ignore[typeddict-item]
        "task": task,
        "status": status,
        "result": result,
    }
    return Command(
        update={
            "delegations": [entry],
            "messages": [
                ToolMessage(
                    content=result,
                    tool_call_id=tool_call_id,
                )
            ],
        }
    )


def _delegate(
    sub_agent_name: str,
    agent,
    task: str,
    tool_call_id: str,
) -> Command:
    """Invoke a sub-agent and turn the outcome into a Command.

    Wrapped in try/except so that a sub-agent LLM failure (rate limit,
    transport error, missing API key, etc.) is recorded as a `failed`
    delegation entry and surfaced to the supervisor as a ToolMessage,
    instead of propagating and crashing the supervisor turn. The
    user-facing `result` is scrubbed to the exception class name only;
    full details are captured server-side via the standard logging path
    when the exception is re-raised at the caller's discretion (we do
    not re-raise here — recovery is the supervisor's job).
    """
    try:
        result = _invoke_sub_agent(agent, task)
        return _delegation_command(
            sub_agent_name, task, "completed", result, tool_call_id
        )
    except Exception as exc:  # noqa: BLE001 - intentional broad catch
        # Keep the message generic; class name only, no exception args
        # (which can contain prompts, keys, or other sensitive data).
        message = (
            f"sub-agent call failed: {exc.__class__.__name__} "
            f"(see server logs for details)"
        )
        return _delegation_command(
            sub_agent_name, task, "failed", message, tool_call_id
        )


# ---------------------------------------------------------------------------
# Supervisor tools (each tool delegates to one sub-agent)
# ---------------------------------------------------------------------------


# Each @tool wraps a sub-agent invocation. The supervisor LLM "calls"
# these tools to delegate work; each call synchronously runs the
# matching sub-agent, records the delegation into shared state, and
# returns the sub-agent's output as a ToolMessage the supervisor can
# read on its next step.
@tool
def research_agent(task: str, runtime: ToolRuntime) -> Command:
    """Delegate a research task to the research sub-agent.

    Use for: gathering facts, background, definitions, statistics.
    Returns a bulleted list of key facts.
    """
    return _delegate("research_agent", _research_agent, task, runtime.tool_call_id)


@tool
def writing_agent(task: str, runtime: ToolRuntime) -> Command:
    """Delegate a drafting task to the writing sub-agent.

    Use for: producing a polished paragraph, draft, or summary. Pass
    relevant facts from prior research inside `task`.
    """
    return _delegate("writing_agent", _writing_agent, task, runtime.tool_call_id)


@tool
def critique_agent(task: str, runtime: ToolRuntime) -> Command:
    """Delegate a critique task to the critique sub-agent.

    Use for: reviewing a draft and suggesting concrete improvements.
    """
    return _delegate("critique_agent", _critique_agent, task, runtime.tool_call_id)


# @endregion[supervisor-delegation-tools]


# ---------------------------------------------------------------------------
# Supervisor (the graph we export)
# ---------------------------------------------------------------------------

graph = create_agent(
    model=ChatOpenAI(model="gpt-4o-mini"),
    tools=[research_agent, writing_agent, critique_agent],
    middleware=[CopilotKitMiddleware()],
    state_schema=AgentState,
    system_prompt=(
        "You are a supervisor agent that coordinates three specialized "
        "sub-agents to produce high-quality deliverables.\n\n"
        "Available sub-agents (call them as tools):\n"
        "  - research_agent: gathers facts on a topic.\n"
        "  - writing_agent: turns facts + a brief into a polished draft.\n"
        "  - critique_agent: reviews a draft and suggests improvements.\n\n"
        "For most non-trivial user requests, delegate in sequence: "
        "research -> write -> critique. Pass the relevant facts/draft "
        "through the `task` argument of each tool. Keep your own "
        "messages short — explain the plan once, delegate, then return "
        "a concise summary once done. The UI shows the user a live log "
        "of every sub-agent delegation."
    ),
)
