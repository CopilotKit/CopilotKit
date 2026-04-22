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
"""

import uuid
from typing import Literal, TypedDict

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
    """Shared state. `delegations` is rendered as a live log in the UI."""

    delegations: list[Delegation]

# ---------------------------------------------------------------------------
# Sub-agents (real LLM agents under the hood)
# ---------------------------------------------------------------------------

# @region[subagent-setup]
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

def _delegation_update(
    state: AgentState,
    sub_agent: str,
    task: str,
    result: str,
    tool_call_id: str,
) -> Command:
    """Append a completed delegation entry to shared state."""
    entry: Delegation = {
        "id": str(uuid.uuid4()),
        "sub_agent": sub_agent,  # type: ignore[typeddict-item]
        "task": task,
        "status": "completed",
        "result": result,
    }
    existing = list(state.get("delegations") or [])
    return Command(
        update={
            "delegations": [*existing, entry],
            "messages": [
                ToolMessage(
                    content=result,
                    tool_call_id=tool_call_id,
                )
            ],
        }
    )

# ---------------------------------------------------------------------------
# Supervisor tools (each tool delegates to one sub-agent)
# ---------------------------------------------------------------------------

# @region[supervisor-delegation-tools]
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
    state: AgentState = runtime.state  # type: ignore[assignment]
    result = _invoke_sub_agent(_research_agent, task)
    return _delegation_update(
        state, "research_agent", task, result, runtime.tool_call_id
    )

@tool
def writing_agent(task: str, runtime: ToolRuntime) -> Command:
    """Delegate a drafting task to the writing sub-agent.

    Use for: producing a polished paragraph, draft, or summary. Pass
    relevant facts from prior research inside `task`.
    """
    state: AgentState = runtime.state  # type: ignore[assignment]
    result = _invoke_sub_agent(_writing_agent, task)
    return _delegation_update(
        state, "writing_agent", task, result, runtime.tool_call_id
    )

@tool
def critique_agent(task: str, runtime: ToolRuntime) -> Command:
    """Delegate a critique task to the critique sub-agent.

    Use for: reviewing a draft and suggesting concrete improvements.
    """
    state: AgentState = runtime.state  # type: ignore[assignment]
    result = _invoke_sub_agent(_critique_agent, task)
    return _delegation_update(
        state, "critique_agent", task, result, runtime.tool_call_id
    )
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
