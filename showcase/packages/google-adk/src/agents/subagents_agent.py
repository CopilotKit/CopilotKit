"""Agent backing the Sub-Agents demo.

Mirrors langgraph-python/src/agents/subagents.py: a supervisor LlmAgent
delegates to three specialized "sub-agents" (research / writing / critique)
exposed as tools. Each delegation appends an entry to state["delegations"]
so the UI can render a live delegation log via useAgent.

We invoke each sub-agent via google.genai.Client.models.generate_content
with a sub-agent-specific system prompt. This is conceptually identical to
running a separate LlmAgent + single-turn Runner, with much less boilerplate.
"""

from __future__ import annotations

import functools
import logging
import uuid

from google import genai
from google.adk.agents import LlmAgent
from google.adk.tools import ToolContext
from google.genai import errors as genai_errors
from google.genai import types

logger = logging.getLogger(__name__)

_SUB_MODEL = "gemini-2.5-flash"

_RESEARCH_SYSTEM = (
    "You are a research sub-agent. Given a topic, produce a concise "
    "bulleted list of 3-5 key facts. No preamble, no closing."
)
_WRITING_SYSTEM = (
    "You are a writing sub-agent. Given a brief and optional source facts, "
    "produce a polished 1-paragraph draft. Be clear and concrete. No preamble."
)
_CRITIQUE_SYSTEM = (
    "You are an editorial critique sub-agent. Given a draft, give 2-3 crisp, "
    "actionable critiques. No preamble."
)


@functools.lru_cache(maxsize=1)
def _client() -> genai.Client:
    return genai.Client()


def _invoke_sub_agent(system_prompt: str, task: str) -> str:
    try:
        response = _client().models.generate_content(
            model=_SUB_MODEL,
            contents=[types.Content(role="user", parts=[types.Part(text=task)])],
            config=types.GenerateContentConfig(system_instruction=system_prompt),
        )
    except (genai_errors.APIError, ValueError) as exc:
        logger.exception("subagent: Gemini call failed")
        return f"(sub-agent error: {exc.__class__.__name__})"
    candidates = getattr(response, "candidates", None) or []
    if not candidates:
        return "(sub-agent returned no candidates)"
    parts = getattr(candidates[0].content, "parts", None) or []
    return "".join(getattr(p, "text", "") or "" for p in parts).strip()


def _record_delegation(
    tool_context: ToolContext, sub_agent: str, task: str, result: str
) -> None:
    delegations = list(tool_context.state.get("delegations") or [])
    delegations.append(
        {
            "id": str(uuid.uuid4()),
            "sub_agent": sub_agent,
            "task": task,
            "status": "completed",
            "result": result,
        }
    )
    tool_context.state["delegations"] = delegations


def research_agent(tool_context: ToolContext, task: str) -> dict:
    """Delegate a research task to the research sub-agent.

    Use for: gathering facts, background, definitions, statistics. Returns
    a bulleted list of key facts.
    """
    result = _invoke_sub_agent(_RESEARCH_SYSTEM, task)
    _record_delegation(tool_context, "research_agent", task, result)
    return {"result": result}


def writing_agent(tool_context: ToolContext, task: str) -> dict:
    """Delegate a drafting task to the writing sub-agent.

    Use for: producing a polished paragraph, draft, or summary. Pass
    relevant facts from prior research inside `task`.
    """
    result = _invoke_sub_agent(_WRITING_SYSTEM, task)
    _record_delegation(tool_context, "writing_agent", task, result)
    return {"result": result}


def critique_agent(tool_context: ToolContext, task: str) -> dict:
    """Delegate a critique task to the critique sub-agent.

    Use for: reviewing a draft and suggesting concrete improvements.
    """
    result = _invoke_sub_agent(_CRITIQUE_SYSTEM, task)
    _record_delegation(tool_context, "critique_agent", task, result)
    return {"result": result}


_SUPERVISOR_INSTRUCTION = (
    "You are a supervisor agent that coordinates three specialized "
    "sub-agents to produce high-quality deliverables.\n\n"
    "Available sub-agents (call them as tools):\n"
    "  - research_agent: gathers facts on a topic.\n"
    "  - writing_agent: turns facts + a brief into a polished draft.\n"
    "  - critique_agent: reviews a draft and suggests improvements.\n\n"
    "For most non-trivial user requests, delegate in sequence: research -> "
    "write -> critique. Pass the relevant facts/draft through the `task` "
    "argument of each tool. Keep your own messages short — explain the plan "
    "once, delegate, then return a concise summary once done. The UI shows "
    "the user a live log of every sub-agent delegation."
)

subagents_root_agent = LlmAgent(
    name="SubagentsSupervisor",
    model=_SUB_MODEL,
    instruction=_SUPERVISOR_INSTRUCTION,
    tools=[research_agent, writing_agent, critique_agent],
)
