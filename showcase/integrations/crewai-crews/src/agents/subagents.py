"""CrewAI Flow backing the Sub-Agents demo.

Mirrors `langgraph-python/src/agents/subagents.py` but uses CrewAI's
native `Crew` + `Task` primitives for the three specialised sub-agents.

Architecture
------------

A top-level "supervisor" LLM (driven directly via `litellm.acompletion`)
orchestrates three single-agent CrewAI crews exposed to the LLM as
tool calls:

  - `research_agent`  — gathers facts (research crew)
  - `writing_agent`   — drafts prose (writing crew)
  - `critique_agent`  — reviews drafts (critique crew)

Each delegation runs the matching crew synchronously via `kickoff()`
inside an asyncio thread (to avoid blocking the event loop), appends a
`Delegation = {id, sub_agent, task, status, result}` entry to
`state["delegations"]`, and emits a STATE_SNAPSHOT so the UI's
delegation log renders updates live.

Why a Flow + tool calls instead of a single supervisor Crew?
------------------------------------------------------------

CrewAI's hierarchical / sequential `Process` modes orchestrate sub-agents
internally and surface only the final crew output through the AG-UI
bridge — every intermediate sub-task / delegation is opaque to the
client. The brief explicitly requires that "each delegation appends a
Delegation entry to state and the UI renders a live delegation log",
which mandates per-delegation visibility.

The cleanest fit is therefore: each sub-agent is a real CrewAI Crew
(authentic CrewAI primitive), the supervisor is a litellm-driven LLM
that exposes the three crews as tools, and the supervisor wrapper
flow emits state snapshots after every delegation. This is the same
shape `langgraph-python/src/agents/subagents.py` uses, ported to CrewAI
where each sub-graph is replaced by a real `Crew(agents=[...],
tasks=[...])`.
"""

# @region[supervisor-delegation-tools]
# @region[subagent-setup]
from __future__ import annotations

import asyncio
import json
import uuid
from typing import List, Literal, Optional

from crewai import Agent, Crew, Process, Task
from crewai.flow.flow import Flow, start
from litellm import acompletion
from pydantic import BaseModel, Field

from ag_ui_crewai import CopilotKitState, copilotkit_emit_state, copilotkit_stream


# ---------------------------------------------------------------------------
# Shared state
# ---------------------------------------------------------------------------


SubAgentName = Literal["research_agent", "writing_agent", "critique_agent"]


class Delegation(BaseModel):
    """Shape of one entry in the delegation log.

    Mirrors the LangGraph reference 1:1 so the frontend type can be
    shared verbatim across runtimes.
    """

    id: str
    sub_agent: SubAgentName
    task: str
    status: Literal["running", "completed", "failed"]
    result: str = ""


class AgentState(CopilotKitState):
    """Shared state. `delegations` is rendered as a live log in the UI."""

    delegations: List[Delegation] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Sub-agent crews (each is a real, single-agent CrewAI Crew)
# ---------------------------------------------------------------------------

_LLM = "gpt-4o-mini"


# Each sub-agent is a real, single-agent CrewAI Crew with its own
# Agent role/goal/backstory and a single Task. They don't share
# memory or tools with the supervisor — the supervisor only sees
# the crew's final raw output (returned via `Crew.kickoff(...)`).
def _build_research_crew() -> Crew:
    researcher = Agent(
        role="Researcher",
        goal="Produce a concise bulleted list of 3-5 key facts on the topic.",
        backstory=(
            "You are a research sub-agent. You gather and distil "
            "information into short, structured bullets. No preamble."
        ),
        verbose=False,
        allow_delegation=False,
    )
    research_task = Task(
        description=(
            "Topic: {task}\n\n"
            "Produce a concise bulleted list of 3-5 key facts about the "
            "topic. Each bullet ≤ 1 short sentence. No preamble or "
            "closing remarks."
        ),
        expected_output="3-5 short bullets, one per line, prefixed with '- '.",
        agent=researcher,
    )
    return Crew(
        agents=[researcher],
        tasks=[research_task],
        process=Process.sequential,
        verbose=False,
        chat_llm=_LLM,
    )


def _build_writing_crew() -> Crew:
    writer = Agent(
        role="Writer",
        goal="Turn a brief and any source facts into a polished single paragraph.",
        backstory=(
            "You are a writing sub-agent. You take a brief plus optional "
            "facts and produce one polished paragraph. Be clear and "
            "concrete. No preamble."
        ),
        verbose=False,
        allow_delegation=False,
    )
    writing_task = Task(
        description=(
            "Brief and source material:\n{task}\n\n"
            "Produce one polished paragraph (3-6 sentences). No "
            "headings, no bullet list, no preamble."
        ),
        expected_output="Exactly one polished paragraph.",
        agent=writer,
    )
    return Crew(
        agents=[writer],
        tasks=[writing_task],
        process=Process.sequential,
        verbose=False,
        chat_llm=_LLM,
    )


def _build_critique_crew() -> Crew:
    critic = Agent(
        role="Editorial Critic",
        goal="Give 2-3 crisp, actionable critiques of a draft.",
        backstory=(
            "You are a critique sub-agent. You read a draft and offer "
            "2-3 crisp, actionable improvements. No preamble, no rewrite."
        ),
        verbose=False,
        allow_delegation=False,
    )
    critique_task = Task(
        description=(
            "Draft to critique:\n{task}\n\n"
            "Provide 2-3 crisp, actionable critiques as short bullets "
            "(one critique per bullet). No preamble, no rewrite of the "
            "draft itself."
        ),
        expected_output="2-3 short bullet-point critiques.",
        agent=critic,
    )
    return Crew(
        agents=[critic],
        tasks=[critique_task],
        process=Process.sequential,
        verbose=False,
        chat_llm=_LLM,
    )


# @endregion[subagent-setup]


# Lazy singletons — each Crew is hot once built, so reuse across requests.
# Built lazily so import is cheap and aimock-mocked tests don't trigger
# any Crew machinery at module load.
_RESEARCH_CREW: Optional[Crew] = None
_WRITING_CREW: Optional[Crew] = None
_CRITIQUE_CREW: Optional[Crew] = None


def _get_research_crew() -> Crew:
    global _RESEARCH_CREW
    if _RESEARCH_CREW is None:
        _RESEARCH_CREW = _build_research_crew()
    return _RESEARCH_CREW


def _get_writing_crew() -> Crew:
    global _WRITING_CREW
    if _WRITING_CREW is None:
        _WRITING_CREW = _build_writing_crew()
    return _WRITING_CREW


def _get_critique_crew() -> Crew:
    global _CRITIQUE_CREW
    if _CRITIQUE_CREW is None:
        _CRITIQUE_CREW = _build_critique_crew()
    return _CRITIQUE_CREW


_CREW_FACTORIES = {
    "research_agent": _get_research_crew,
    "writing_agent": _get_writing_crew,
    "critique_agent": _get_critique_crew,
}


async def _kickoff_crew(crew: Crew, task: str) -> str:
    """Run a crew off the event loop and return its raw output."""
    # `Crew.kickoff` is synchronous and may issue blocking LLM calls; run
    # it in a worker thread so the supervisor flow keeps streaming.
    output = await asyncio.to_thread(crew.kickoff, inputs={"task": task})
    raw = getattr(output, "raw", None)
    if raw is None:
        raw = str(output)
    return str(raw)


# ---------------------------------------------------------------------------
# Supervisor tool schemas
# ---------------------------------------------------------------------------


# Each entry below is one "delegation tool" the supervisor LLM can call.
# CrewAI's hierarchical Process orchestrates sub-agents internally and
# only surfaces the final crew output to the AG-UI bridge, which would
# hide every intermediate delegation. Instead, we expose each sub-crew
# as a plain OpenAI-compatible tool schema and let the supervisor call
# them via litellm; the wrapper flow runs the matching crew on each call
# and records a Delegation entry into shared state.
def _delegation_tool(name: SubAgentName, description: str) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": {
                    "task": {
                        "type": "string",
                        "description": (
                            "The full task / brief to hand off to the "
                            "sub-agent. Include any facts or draft text "
                            "the sub-agent will need."
                        ),
                    }
                },
                "required": ["task"],
            },
        },
    }


RESEARCH_TOOL = _delegation_tool(
    "research_agent",
    (
        "Delegate a research task to the research sub-agent. Use for "
        "gathering facts, background, definitions, or statistics. "
        "Returns a bulleted list of key facts."
    ),
)
WRITING_TOOL = _delegation_tool(
    "writing_agent",
    (
        "Delegate a drafting task to the writing sub-agent. Use to "
        "produce a polished paragraph from a brief and optional facts. "
        "Pass relevant facts from prior research inside `task`."
    ),
)
CRITIQUE_TOOL = _delegation_tool(
    "critique_agent",
    (
        "Delegate a critique task to the critique sub-agent. Use to "
        "review a draft and surface 2-3 actionable improvements. Pass "
        "the draft inside `task`."
    ),
)

DELEGATION_TOOLS = [RESEARCH_TOOL, WRITING_TOOL, CRITIQUE_TOOL]
DELEGATION_TOOL_NAMES = {t["function"]["name"] for t in DELEGATION_TOOLS}
# @endregion[supervisor-delegation-tools]


SUPERVISOR_SYSTEM_PROMPT = (
    "You are a supervisor agent that coordinates three specialised "
    "sub-agents to produce high-quality deliverables.\n\n"
    "Available sub-agents (call them as tools):\n"
    "  - research_agent: gathers facts on a topic.\n"
    "  - writing_agent: turns facts + a brief into a polished draft.\n"
    "  - critique_agent: reviews a draft and suggests improvements.\n\n"
    "For most non-trivial user requests, delegate in sequence: "
    "research -> write -> critique. Pass the relevant facts/draft "
    "through the `task` argument of each tool. Keep your own messages "
    "short — explain the plan once, delegate, then return a concise "
    "summary once done. The UI shows the user a live log of every "
    "sub-agent delegation."
)


# ---------------------------------------------------------------------------
# Supervisor Flow
# ---------------------------------------------------------------------------


# Hard cap on delegation rounds per turn. Each round = one supervisor
# completion + (optionally) one sub-agent kickoff. The expected cycle
# is research -> write -> critique = 3 rounds + a final summary, so 6
# is generous head-room without leaving the door open for unbounded
# loops if the LLM keeps re-delegating.
_MAX_DELEGATION_ROUNDS = 6


class SubagentsFlow(Flow[AgentState]):
    """Supervisor flow that delegates to research / writing / critique crews."""

    @start()
    async def supervise(self) -> None:
        # Append-only across turns: prior-turn delegations are preserved
        # so follow-up messages don't blow away the user's history.
        # Matches every other backend in the cohort (langgraph-python,
        # mastra, etc.) — all treat the delegation log as cumulative.
        await copilotkit_emit_state(self.state)

        for _ in range(_MAX_DELEGATION_ROUNDS):
            messages = [
                {
                    "role": "system",
                    "content": SUPERVISOR_SYSTEM_PROMPT,
                    "id": str(uuid.uuid4()) + "-system",
                },
                *self.state.messages,
            ]

            tools = [
                *self.state.copilotkit.actions,
                *DELEGATION_TOOLS,
            ]

            response = await copilotkit_stream(
                await acompletion(
                    model=f"openai/{_LLM}",
                    messages=messages,
                    tools=tools,
                    parallel_tool_calls=False,
                    stream=True,
                )
            )

            message = response.choices[0].message
            self.state.messages.append(message)

            tool_calls = message.get("tool_calls") or []
            if not tool_calls:
                # Supervisor has produced a final assistant message;
                # we're done.
                return

            # Iterate ALL tool calls — `parallel_tool_calls=False` is set
            # on the LLM call but providers can still emit multiple under
            # certain conditions. Indexing `[0]` would silently drop the
            # rest, leaving the supervisor hung waiting for results that
            # never arrive. Defensive iteration eliminates the silent drop.
            saw_frontend_tool = False
            for tool_call in tool_calls:
                tool_call_id = tool_call["id"]
                tool_name = tool_call["function"]["name"]

                if tool_name not in DELEGATION_TOOL_NAMES:
                    # Frontend-registered action — the AG-UI client owns
                    # the round-trip for those. We must NOT append a tool
                    # result here (the client will). Mark the loop to exit
                    # after processing every tool call so the message
                    # thread stays valid for client-side resolution.
                    saw_frontend_tool = True
                    continue

                try:
                    args = json.loads(tool_call["function"]["arguments"] or "{}")
                except json.JSONDecodeError:
                    args = {}
                task_text = str(args.get("task") or "").strip()
                if not task_text:
                    # The model called the tool with no `task`; surface a
                    # tool-error message so it can recover on the next round.
                    self.state.messages.append(
                        {
                            "role": "tool",
                            "content": (
                                "Error: `task` is required and must be a "
                                "non-empty string."
                            ),
                            "tool_call_id": tool_call_id,
                        }
                    )
                    continue

                # Append a `running` delegation so the UI shows the
                # in-flight call before the crew kickoff completes.
                entry_id = str(uuid.uuid4())
                self.state.delegations.append(
                    Delegation(
                        id=entry_id,
                        sub_agent=tool_name,  # type: ignore[arg-type]
                        task=task_text,
                        status="running",
                        result="",
                    )
                )
                await copilotkit_emit_state(self.state)

                try:
                    result_text = await _kickoff_crew(
                        _CREW_FACTORIES[tool_name](),
                        task_text,
                    )
                    status: Literal["completed", "failed"] = "completed"
                except Exception as exc:  # noqa: BLE001
                    # Any failure inside a sub-crew (LLM error, kickoff
                    # error, etc.) is recorded on the delegation entry and
                    # surfaced to the supervisor as a tool error so it can
                    # try a different approach. Scrub to class name only —
                    # `repr(exc)` can leak URLs, request IDs, or partial
                    # credentials. Operators can correlate via server logs.
                    result_text = (
                        f"sub-agent call failed: {exc.__class__.__name__} "
                        "(see server logs for details)"
                    )
                    status = "failed"

                # Replace the running entry with a completed one.
                for i, d in enumerate(self.state.delegations):
                    if d.id == entry_id:
                        self.state.delegations[i] = Delegation(
                            id=entry_id,
                            sub_agent=tool_name,  # type: ignore[arg-type]
                            task=task_text,
                            status=status,
                            result=result_text,
                        )
                        break

                self.state.messages.append(
                    {
                        "role": "tool",
                        "content": result_text,
                        "tool_call_id": tool_call_id,
                    }
                )

                await copilotkit_emit_state(self.state)

            if saw_frontend_tool:
                # At least one tool call was a frontend-registered action;
                # the AG-UI client handles those round-trips. Stop the
                # supervisor loop and let the client respond on the next turn.
                return


subagents_flow = SubagentsFlow()
