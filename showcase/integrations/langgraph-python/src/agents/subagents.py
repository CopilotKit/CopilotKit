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

import operator
import uuid
from typing import Annotated, Literal, TypedDict

from langchain.agents import AgentState as BaseAgentState, create_agent
from langchain.tools import ToolRuntime, tool
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
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
    status: Literal["completed"]
    result: str


# Cap the supervisor → critique sub-agent loop at a single iteration.
# Without this, the supervisor LLM occasionally re-calls `critique_agent`
# repeatedly on the same draft (visible as stacking 🧐 cards in the
# chat). The critic only adds value once per draft, so we hard-stop
# after `_MAX_CRITIQUE_ITERATIONS` invocations and return a no-op
# result.
_MAX_CRITIQUE_ITERATIONS = 1


class AgentState(BaseAgentState):
    """Shared state. `delegations` is rendered as a live log in the UI.

    `delegations` uses an `operator.add` reducer so that concurrent
    sub-agent emissions in the same supervisor step accumulate into a
    single list instead of conflicting (LangGraph would otherwise raise
    `INVALID_CONCURRENT_GRAPH_UPDATE` — "Can receive only one value per
    step. Use an Annotated key to handle multiple values.").
    """

    delegations: Annotated[list[Delegation], operator.add]


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


# Sentinel surfaced when a sub-agent run produces no usable text. Kept
# as a module-level constant so the harness probe (and any UI fallback)
# can match the exact phrase. The leading/trailing angle brackets keep
# it out of plausible LLM phrasing.
SUB_AGENT_EMPTY_SENTINEL = "<sub-agent produced no output>"


def _invoke_sub_agent(agent, task: str) -> str:
    """Run a sub-agent on `task` and return its final prose message.

    Walks the sub-agent's returned messages list newest → oldest and
    returns the first AIMessage with non-empty string content. This
    avoids two failure modes:

      1. The final message may be an empty AIMessage that only carries
         `tool_calls` (no text content) — falling back to `messages[-1]`
         would surface an empty string.
      2. If the supervisor's chat history leaks into the sub-agent's
         result list, we still pick the AI's actual prose answer for
         this task instead of a stale assistant intro.
    """
    result = agent.invoke({"messages": [HumanMessage(content=task)]})
    messages = result.get("messages", [])
    for msg in reversed(messages):
        if isinstance(msg, AIMessage):
            content = msg.content
            if isinstance(content, str) and content.strip():
                return content
            # Some providers stream content as a list of content blocks
            # (e.g. {"type": "text", "text": "..."}). Concatenate any
            # text blocks we find.
            if isinstance(content, list):
                parts: list[str] = []
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "text":
                        text = block.get("text")
                        if isinstance(text, str):
                            parts.append(text)
                joined = "".join(parts).strip()
                if joined:
                    return joined
    # Last-resort fallback: surface an explicit sentinel rather than ""
    # or a Python repr like "[{'type': 'text', ...}]" leaking from a
    # block-list `content`. The d5-subagents probe asserts this exact
    # sentinel against its boilerplate-marker list so an empty/garbled
    # sub-agent result fails the genuine-pass test instead of silently
    # rendering an empty card.
    return SUB_AGENT_EMPTY_SENTINEL


def _delegation_update(
    sub_agent: str,
    task: str,
    result: str,
    tool_call_id: str,
) -> Command:
    """Append a completed delegation entry to shared state.

    Returns just the new entry (a one-element list). The reducer on
    `AgentState.delegations` is `operator.add`, which concatenates the
    new list with the prior state — so we must NOT echo back the
    existing delegations here, or they would be duplicated each step.
    """
    entry: Delegation = {
        "id": str(uuid.uuid4()),
        "sub_agent": sub_agent,  # type: ignore[typeddict-item]
        "task": task,
        "status": "completed",
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
    result = _invoke_sub_agent(_research_agent, task)
    return _delegation_update(
        "research_agent", task, result, runtime.tool_call_id
    )


@tool
def writing_agent(task: str, runtime: ToolRuntime) -> Command:
    """Delegate a drafting task to the writing sub-agent.

    Use for: producing a polished paragraph, draft, or summary. Pass
    relevant facts from prior research inside `task`.
    """
    result = _invoke_sub_agent(_writing_agent, task)
    return _delegation_update(
        "writing_agent", task, result, runtime.tool_call_id
    )


@tool
def critique_agent(task: str, runtime: ToolRuntime) -> Command:
    """Delegate a critique task to the critique sub-agent.

    Use for: reviewing a draft and suggesting concrete improvements.

    Capped at `_MAX_CRITIQUE_ITERATIONS` invocations per supervisor run
    — the supervisor LLM occasionally re-calls the critic in a loop and
    each rerun produces near-identical output, so additional calls are
    short-circuited with a no-op result that nudges the supervisor to
    finish.
    """
    state: AgentState = runtime.state  # type: ignore[assignment]
    delegations = state.get("delegations") or []
    prior_critiques = sum(
        1 for d in delegations if d.get("sub_agent") == "critique_agent"
    )
    if prior_critiques >= _MAX_CRITIQUE_ITERATIONS:
        # Short-circuit without appending another delegation entry — the
        # UI renders one card per delegation and we want exactly one
        # critic card per supervisor run, even if the LLM ignores the
        # system prompt and re-issues the call.
        skip_message = (
            "Critique already produced for this run. "
            "Stop calling critique_agent and return your final answer "
            "to the user now."
        )
        return Command(
            update={
                "messages": [
                    ToolMessage(
                        content=skip_message,
                        tool_call_id=runtime.tool_call_id,
                    )
                ],
            }
        )
    result = _invoke_sub_agent(_critique_agent, task)
    return _delegation_update(
        "critique_agent", task, result, runtime.tool_call_id
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
        "For every non-trivial user request, delegate in sequence: "
        "research_agent -> writing_agent -> critique_agent. "
        "IMPORTANT: call EACH sub-agent EXACTLY ONCE per user request. "
        "After critique_agent returns, do NOT call any sub-agent "
        "again — return a concise final answer to the user that "
        "incorporates the critique. Pass the relevant facts/draft "
        "through the `task` argument of each tool. Keep your own "
        "messages short — explain the plan once, delegate, then return "
        "a concise summary once done. The UI shows the user a live log "
        "of every sub-agent delegation."
    ),
)
