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


class _SubAgentError(Exception):
    """Raised by `_invoke_sub_agent` when the secondary Gemini call fails.

    Carries a user-facing message that's safe to surface to the supervisor
    LLM and the frontend delegation log. The original exception is chained
    via `__cause__` so the server-side traceback is preserved.
    """


def _invoke_sub_agent(system_prompt: str, task: str) -> str:
    """Run a single-shot Gemini call with a sub-agent system prompt.

    Catches the broad `Exception` rather than the narrow
    `(APIError, ValueError)` set so transport-layer failures (timeouts,
    `httpx.ConnectError`, `RuntimeError` from cancelled tasks) do not
    crash the supervisor's tool call. Failures are re-raised as
    `_SubAgentError` so callers can map them to `status: "failed"` in the
    delegation log instead of recording them as `"completed"`.
    """
    try:
        response = _client().models.generate_content(
            model=_SUB_MODEL,
            contents=[types.Content(role="user", parts=[types.Part(text=task)])],
            config=types.GenerateContentConfig(system_instruction=system_prompt),
        )
    except Exception as exc:
        # `logger.exception` keeps the full traceback + str(exc) server-side.
        # The user-facing message intentionally surfaces only the exception
        # CLASS name, not str(exc) — Gemini SDK errors can include URLs,
        # request IDs, partial credentials, or quota details that we should
        # not ship to the showcase frontend (manifest declares
        # \`deployed: true\`, so the public Railway URL would receive them).
        logger.exception("subagent: Gemini call failed")
        raise _SubAgentError(
            f"sub-agent call failed: {exc.__class__.__name__} "
            "(see server logs for details)"
        ) from exc

    candidates = getattr(response, "candidates", None) or []
    if not candidates:
        raise _SubAgentError("sub-agent returned no candidates (safety blocked?)")

    # `candidates[0].content` may itself be `None` on safety-blocked or
    # empty responses; guard the attribute access via `getattr` instead of
    # dotting through directly, otherwise we hit `AttributeError: 'NoneType'
    # object has no attribute 'parts'` on the inner access.
    content = getattr(candidates[0], "content", None)
    # `getattr(None, "parts", None)` already returns `None`, so the `or []`
    # tail covers both the missing-content and missing-parts cases without
    # the redundant ternary that read like a precedence bug.
    parts = getattr(content, "parts", None) or []
    text = "".join(getattr(p, "text", "") or "" for p in parts).strip()
    if not text:
        raise _SubAgentError("sub-agent returned empty text")
    return text


def _append_delegation(
    tool_context: ToolContext,
    *,
    sub_agent: str,
    task: str,
    status: str,
    result: str,
) -> str:
    """Append a delegation entry and return its id."""
    delegations = list(tool_context.state.get("delegations") or [])
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
    tool_context.state["delegations"] = delegations
    return entry_id


def _update_delegation(
    tool_context: ToolContext,
    *,
    entry_id: str,
    status: str,
    result: str,
) -> None:
    """Mutate the delegation entry with `entry_id`, replacing its status + result.

    Pure read-modify-write (the LLM is instructed to delegate sequentially,
    so concurrent updates within a single turn are not expected). If the
    entry has gone missing — e.g., another part of the system replaced
    `state["delegations"]` — we log loudly and skip rather than appending
    a synthetic entry. The frontend's `Delegation.sub_agent` type union is
    `"research_agent"|"writing_agent"|"critique_agent"`; falling back to a
    `"unknown"` value would slip past Python's untyped state writes and
    render as undefined badge text + className in `delegation-log.tsx`.
    Skipping is the honest signal: the in-flight delegation row is gone,
    and no row is more useful than a malformed row.
    """
    delegations = list(tool_context.state.get("delegations") or [])
    for entry in delegations:
        if entry.get("id") == entry_id:
            entry["status"] = status
            entry["result"] = result
            tool_context.state["delegations"] = delegations
            return
    logger.warning(
        "subagent: delegation entry %s missing on update — final %s state "
        "(result_length=%d) will not be rendered; this means another part "
        "of the system replaced state['delegations'] mid-turn",
        entry_id,
        status,
        len(result),
    )


def _delegate(
    tool_context: ToolContext, *, sub_agent: str, system_prompt: str, task: str
) -> dict:
    """Common delegation flow: append running entry → invoke → update final.

    The frontend's delegation log subscribes to `state["delegations"]` and
    shows entries with `status: "running"` while the secondary Gemini call
    is in flight, then flips them to `"completed"` or `"failed"` once we
    return.
    """
    entry_id = _append_delegation(
        tool_context,
        sub_agent=sub_agent,
        task=task,
        status="running",
        result="",
    )
    try:
        result = _invoke_sub_agent(system_prompt, task)
    except _SubAgentError as exc:
        _update_delegation(
            tool_context,
            entry_id=entry_id,
            status="failed",
            result=str(exc),
        )
        # Surface the failure to the supervisor LLM so it can decide whether
        # to retry, fall back to a different sub-agent, or apologise to the
        # user. The fail-loud return shape contrasts with the prior
        # behaviour, which masked failures as `result: "(sub-agent error: …)"`
        # under `status: "completed"`.
        return {"status": "failed", "error": str(exc)}

    _update_delegation(
        tool_context,
        entry_id=entry_id,
        status="completed",
        result=result,
    )
    return {"status": "completed", "result": result}


def research_agent(tool_context: ToolContext, task: str) -> dict:
    """Delegate a research task to the research sub-agent.

    Use for: gathering facts, background, definitions, statistics. Returns
    a dict of {status, result} on success or {status: "failed", error} on
    sub-agent failure — read both keys before continuing.
    """
    return _delegate(
        tool_context,
        sub_agent="research_agent",
        system_prompt=_RESEARCH_SYSTEM,
        task=task,
    )


def writing_agent(tool_context: ToolContext, task: str) -> dict:
    """Delegate a drafting task to the writing sub-agent.

    Use for: producing a polished paragraph, draft, or summary. Pass
    relevant facts from prior research inside `task`. Same return shape
    as research_agent.
    """
    return _delegate(
        tool_context,
        sub_agent="writing_agent",
        system_prompt=_WRITING_SYSTEM,
        task=task,
    )


def critique_agent(tool_context: ToolContext, task: str) -> dict:
    """Delegate a critique task to the critique sub-agent.

    Use for: reviewing a draft and suggesting concrete improvements. Same
    return shape as research_agent.
    """
    return _delegate(
        tool_context,
        sub_agent="critique_agent",
        system_prompt=_CRITIQUE_SYSTEM,
        task=task,
    )


_SUPERVISOR_INSTRUCTION = (
    "You are a supervisor agent that coordinates three specialized "
    "sub-agents to produce high-quality deliverables.\n\n"
    "Available sub-agents (call them as tools):\n"
    "  - research_agent: gathers facts on a topic.\n"
    "  - writing_agent: turns facts + a brief into a polished draft.\n"
    "  - critique_agent: reviews a draft and suggests improvements.\n\n"
    "For most non-trivial user requests, delegate in sequence: research -> "
    "write -> critique. Pass the relevant facts/draft through the `task` "
    "argument of each tool. Each tool returns a dict shaped "
    "`{status: 'completed' | 'failed', result?: str, error?: str}`. If a "
    "sub-agent fails, surface the failure briefly to the user (don't "
    "fabricate a result) and decide whether to retry. Keep your own "
    "messages short — explain the plan once, delegate, then return a "
    "concise summary once done. The UI shows the user a live log of "
    "every sub-agent delegation, including the in-flight 'running' state."
)

subagents_root_agent = LlmAgent(
    name="SubagentsSupervisor",
    model=_SUB_MODEL,
    instruction=_SUPERVISOR_INSTRUCTION,
    tools=[research_agent, writing_agent, critique_agent],
)
