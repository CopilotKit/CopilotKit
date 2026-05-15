"""Agent backing the Sub-Agents demo.

Mirrors langgraph-python/src/agents/subagents.py: a supervisor LlmAgent
delegates to three specialized "sub-agents" (research / writing / critique)
exposed as tools. Each delegation appends one entry (with `status: "completed"`)
to state["delegations"] so the UI can render a live delegation log via useAgent.

We invoke each sub-agent via google.genai.Client.models.generate_content
with a sub-agent-specific system prompt. This is conceptually identical to
running a separate LlmAgent + single-turn Runner, with much less boilerplate.

Delegation-log behaviour mirrors LP's frontend contract: only completed
entries are appended (no `running` placeholder). Sub-agent failures are
still recorded as `status: "completed"` with the error message in `result`,
so the LP frontend's completion-only renderer stays 1:1.
"""

# @region[subagent-setup]
# @region[supervisor-delegation-tools]
from __future__ import annotations

import functools
import logging
import os
import uuid

from google import genai
from google.adk.agents import LlmAgent
from google.adk.tools import ToolContext
from google.genai import types

from agents.shared_chat import get_model, stop_on_terminal_text

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
    base_url = os.environ.get("GOOGLE_GEMINI_BASE_URL")
    if base_url:
        return genai.Client(http_options={"base_url": base_url})
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
    `_SubAgentError` so callers can surface a useful error message in
    the delegation log without crashing the supervisor.
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


def _append_completed_delegation(
    tool_context: ToolContext,
    *,
    sub_agent: str,
    task: str,
    result: str,
) -> None:
    """Append a completed delegation entry to shared state.

    LP-parity: the LP frontend renders the delegation log on `status:
    "completed"` only. We never emit a "running" placeholder, so the log
    grows by exactly one entry per sub-agent call when it finishes.
    Failures still write a `"completed"` entry whose `result` is the
    user-facing error string — the renderer keeps a single visual treatment
    instead of needing a separate failed-state branch.
    """
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


_SUB_AGENT_ERROR_PREFIX = "[sub-agent error] "


def _delegate(
    tool_context: ToolContext, *, sub_agent: str, system_prompt: str, task: str
) -> str:
    """Common delegation flow: invoke sub-agent → append completed entry → return text.

    The frontend's delegation log subscribes to `state["delegations"]` and
    the supervisor LLM reads the returned string as the tool result. We
    only append AFTER the sub-agent returns so the log mirrors LP's
    completion-only behaviour. Sub-agent failures are surfaced as a plain
    error string prefixed with `[sub-agent error]` — the supervisor LLM
    can detect this and apologise instead of fabricating an answer, and
    the frontend renders the prefixed error inline alongside successful
    outputs.
    """
    try:
        result = _invoke_sub_agent(system_prompt, task)
    except _SubAgentError as exc:
        # LP-parity: failures still surface as a `completed` entry. We
        # return plain text (with an error prefix) so the supervisor LLM
        # and the frontend renderer see the same shape on success and
        # failure, just like LP's ToolMessage(content=result, ...).
        error_message = f"{_SUB_AGENT_ERROR_PREFIX}{exc}"
        _append_completed_delegation(
            tool_context,
            sub_agent=sub_agent,
            task=task,
            result=error_message,
        )
        return error_message

    _append_completed_delegation(
        tool_context,
        sub_agent=sub_agent,
        task=task,
        result=result,
    )
    return result


def research_agent(tool_context: ToolContext, task: str) -> str:
    """Delegate a research task to the research sub-agent.

    Use for: gathering facts, background, definitions, statistics. Returns
    the sub-agent's plain-text response, or an `[sub-agent error] …`
    string on failure — surface either to the user without rephrasing.
    """
    return _delegate(
        tool_context,
        sub_agent="research_agent",
        system_prompt=_RESEARCH_SYSTEM,
        task=task,
    )


def writing_agent(tool_context: ToolContext, task: str) -> str:
    """Delegate a drafting task to the writing sub-agent.

    Use for: producing a polished paragraph, draft, or summary. Pass the
    brief (and any relevant facts) through `task`. Same return shape as
    research_agent.
    """
    return _delegate(
        tool_context,
        sub_agent="writing_agent",
        system_prompt=_WRITING_SYSTEM,
        task=task,
    )


def critique_agent(tool_context: ToolContext, task: str) -> str:
    """Delegate a critique task to the critique sub-agent.

    Use for: reviewing a draft and suggesting concrete improvements. Pass
    the draft through `task`. Same return shape as research_agent.
    """
    return _delegate(
        tool_context,
        sub_agent="critique_agent",
        system_prompt=_CRITIQUE_SYSTEM,
        task=task,
    )


# @endregion[supervisor-delegation-tools]


_SUPERVISOR_INSTRUCTION = (
    "You are a supervisor agent that coordinates three specialized "
    "sub-agents to produce high-quality deliverables.\n\n"
    "Available sub-agents (call them as tools):\n"
    "  - research_agent(task): gathers facts on a topic.\n"
    "  - writing_agent(task): turns facts + a brief into a polished draft.\n"
    "  - critique_agent(task): reviews a draft and suggests improvements.\n\n"
    "For every non-trivial user request, delegate in sequence: "
    "research_agent -> writing_agent -> critique_agent. "
    "IMPORTANT: call EACH sub-agent EXACTLY ONCE per user request. "
    "After critique_agent returns, do NOT call any sub-agent "
    "again — return a concise final answer to the user that "
    "incorporates the critique. Pass the relevant facts/draft "
    "through the `task` argument of each tool. Each tool returns the "
    "sub-agent's plain-text output. If the result is prefixed with "
    "`[sub-agent error]`, surface the failure briefly to the user "
    "(don't fabricate a result) and decide whether to retry. "
    "Keep your own messages short — explain the plan once, delegate, "
    "then return a concise summary once done. The UI shows the user a "
    "live log of every sub-agent delegation."
)

subagents_root_agent = LlmAgent(
    name="SubagentsSupervisor",
    model=get_model(_SUB_MODEL),
    instruction=_SUPERVISOR_INSTRUCTION,
    tools=[research_agent, writing_agent, critique_agent],
    after_model_callback=stop_on_terminal_text,
)
# @endregion[subagent-setup]
