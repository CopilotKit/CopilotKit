"""Sub-Agents demo — Langroid.

Mirrors langgraph-python/src/agents/subagents.py and the google-adk
subagents_agent.py: a top-level "supervisor" LLM orchestrates three
specialized sub-agents, exposed as tools:

  - ``research_agent``  — gathers facts (3-5 bullets)
  - ``writing_agent``   — drafts a polished paragraph
  - ``critique_agent``  — reviews a draft and gives 2-3 critiques

Each sub-agent is its own ``langroid.ChatAgent`` with a single-task
system prompt and no tools. The supervisor delegates by emitting a tool
call against one of the three names; the SSE adapter intercepts the
call, runs the matching sub-agent synchronously, records a Delegation
entry into shared state (``running`` -> ``completed`` / ``failed``),
emits a ``STATE_SNAPSHOT`` so the UI re-renders, and then re-prompts
the supervisor with the sub-agent's output so it can chain (research
-> write -> critique) or summarize.

The handler is wired up by ``agent_server.py`` at ``POST /subagents``.
"""

# @region[supervisor-delegation-tools]
# @region[subagent-setup]
from __future__ import annotations

import functools
import json
import logging
import os
import uuid
from typing import Annotated, Any, AsyncGenerator, Literal, TypedDict

from ag_ui.core import (
    EventType,
    RunAgentInput,
    RunErrorEvent,
    RunFinishedEvent,
    RunStartedEvent,
    StateSnapshotEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallStartEvent,
)
from fastapi import Request
from fastapi.responses import JSONResponse, StreamingResponse

import langroid as lr
import langroid.language_models as lm
from langroid.agent.tool_message import ToolMessage

logger = logging.getLogger(__name__)


# =====================================================================
# Shared state shape
# =====================================================================


class Delegation(TypedDict):
    id: str
    sub_agent: Literal["research_agent", "writing_agent", "critique_agent"]
    task: str
    status: Literal["running", "completed", "failed"]
    result: str


# =====================================================================
# Sub-agent system prompts (single-task, no tools)
# =====================================================================


# In Langroid, each sub-agent is a `lr.ChatAgent` with a single-task
# `system_message` and no tools. The supervisor only ever sees the
# sub-agent's final-message content — no shared memory, no shared tools.
_RESEARCH_SYSTEM = (
    "You are a research sub-agent. Given a topic, produce a concise "
    "bulleted list of 3-5 key facts. No preamble, no closing."
)
_WRITING_SYSTEM = (
    "You are a writing sub-agent. Given a brief and optional source facts, "
    "produce a polished 1-paragraph draft. Be clear and concrete. No preamble."
)
_CRITIQUE_SYSTEM = (
    "You are an editorial critique sub-agent. Given a draft, give 2-3 "
    "crisp, actionable critiques. No preamble."
)


_SUB_PROMPTS: dict[str, str] = {
    "research_agent": _RESEARCH_SYSTEM,
    "writing_agent": _WRITING_SYSTEM,
    "critique_agent": _CRITIQUE_SYSTEM,
}


def _resolve_sub_model() -> str:
    """Resolve the sub-agent model.

    Mirrors ``_resolve_a2ui_model`` in ``agents.agent``: bare model name
    (langroid passes the string literally to the OpenAI SDK, which
    rejects ``openai/gpt-4.1`` as "model not found").
    """
    return os.getenv("SUBAGENT_MODEL") or os.getenv("LANGROID_MODEL") or "gpt-4.1"


@functools.lru_cache(maxsize=8)
def _build_sub_llm_config(name: str) -> lm.OpenAIGPTConfig:
    """Build (and memoize) the immutable ``OpenAIGPTConfig`` for one sub-agent.

    Only the LLM config — which is stateless and credential-bearing — is
    cached. The ``ChatAgent`` itself is rebuilt per call (see
    ``_build_sub_agent``) because ``lr.ChatAgent`` accumulates
    ``message_history`` across ``llm_response`` / ``llm_response_async``
    calls and must NOT be shared across concurrent requests.
    """
    # ``name`` participates in the cache key indirectly via per-name
    # callsites; the config itself is identical across sub-agents today
    # but keeping the parameter makes the cache robust if a future
    # refactor varies model/temperature per sub-agent.
    del name  # currently unused — kept for cache-key shape stability
    model = _resolve_sub_model()
    return lm.OpenAIGPTConfig(
        chat_model=model,
        # Sub-agents are single-shot — non-streaming keeps the supervisor
        # turn deterministic (we want the full result before recording
        # the delegation as completed).
        stream=False,
    )


def _build_sub_agent(name: str) -> lr.ChatAgent:
    """Build a fresh ``ChatAgent`` for one sub-agent invocation.

    A new agent is constructed on every call. Caching the agent
    instance (e.g. via ``lru_cache``) would be unsafe: ``lr.ChatAgent``
    accumulates ``message_history`` across ``llm_response_async`` calls,
    so two concurrent users invoking the same sub-agent would
    cross-contaminate each other's conversation history and grow the
    token budget unboundedly across the process lifetime.

    The immutable LLM config is cached separately (see
    ``_build_sub_llm_config``) so we don't pay credential-resolution
    overhead per call.
    """
    system_prompt = _SUB_PROMPTS[name]
    llm_config = _build_sub_llm_config(name)
    agent_config = lr.ChatAgentConfig(
        llm=llm_config,
        system_message=system_prompt,
    )
    return lr.ChatAgent(agent_config)


# @endregion[subagent-setup]


async def _invoke_sub_agent(name: str, task: str) -> str:
    """Run a sub-agent on ``task`` and return its final-message content.

    Uses ``llm_response_async`` so the SSE writer stays cooperative —
    a synchronous ``sub.llm_response(task)`` would block the event loop
    for the entire LLM round-trip and stall any other concurrent SSE
    responses sharing this worker.

    Raises ``RuntimeError`` (with the exception class chained via
    ``__cause__``) on transport / SDK failures so the caller can record
    a ``failed`` delegation. The original exception is preserved
    server-side via ``logger.exception``.
    """
    sub = _build_sub_agent(name)
    try:
        response = await sub.llm_response_async(task)
    except Exception as exc:  # noqa: BLE001 — see docstring
        logger.exception("subagent %s call failed", name)
        # Match the google-adk surface: only the class name leaks; the
        # full traceback stays in server logs.
        raise RuntimeError(
            f"sub-agent call failed: {exc.__class__.__name__} "
            "(see server logs for details)"
        ) from exc

    if response is None:
        raise RuntimeError("sub-agent returned no response")
    content = getattr(response, "content", None) or ""
    if not content:
        raise RuntimeError("sub-agent returned empty content")
    return content


# =====================================================================
# Supervisor tools (langroid ToolMessage subclasses)
# =====================================================================


# In Langroid, the supervisor delegates by emitting a tool call against
# one of these `ToolMessage` subclasses. The SSE adapter intercepts the
# call (rather than letting Langroid dispatch to `.handle`), runs the
# matching sub-agent, records a `Delegation` into shared state, and
# returns the sub-agent's output as the tool result.
class _SubAgentTool(ToolMessage):
    """Base class for the three supervisor delegation tools.

    The actual sub-agent invocation happens in the SSE adapter (so we
    can record delegations into shared state); this ``handle`` is a
    placeholder that's never called in the normal flow — we intercept
    the tool call before langroid would dispatch to it. Logging here
    matches the frontend-tool pattern in ``agents.agent``.
    """

    request: str = "_subagent_base"  # overridden
    purpose: str = ""  # overridden
    task: Annotated[
        str,
        "The exact task for the sub-agent. Pass relevant facts/draft "
        "from prior delegations through this string.",
    ]

    def handle(self) -> str:
        logger.error(
            "%s.handle fired server-side — adapter dispatch regression; "
            "the supervisor sub-agent tool was not intercepted",
            self.__class__.__name__,
        )
        return f"{self.request} dispatched"


class ResearchAgentTool(_SubAgentTool):
    request: str = "research_agent"
    purpose: str = (
        "Delegate a research task to the research sub-agent. Use for: "
        "gathering facts, background, definitions, statistics. Returns a "
        "bulleted list of key facts."
    )


class WritingAgentTool(_SubAgentTool):
    request: str = "writing_agent"
    purpose: str = (
        "Delegate a drafting task to the writing sub-agent. Use for: "
        "producing a polished paragraph, draft, or summary. Pass relevant "
        "facts from prior research inside `task`."
    )


class CritiqueAgentTool(_SubAgentTool):
    request: str = "critique_agent"
    purpose: str = (
        "Delegate a critique task to the critique sub-agent. Use for: "
        "reviewing a draft and suggesting concrete improvements."
    )


_SUPERVISOR_TOOLS: tuple[type[ToolMessage], ...] = (
    ResearchAgentTool,
    WritingAgentTool,
    CritiqueAgentTool,
)
# @endregion[supervisor-delegation-tools]

_SUB_AGENT_NAMES: frozenset[str] = frozenset(
    t.default_value("request") for t in _SUPERVISOR_TOOLS
)


_SUPERVISOR_PROMPT = (
    "You are a supervisor agent that coordinates three specialized "
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
    "sub-agent delegation, including the in-flight `running` state."
)


def _create_supervisor() -> lr.ChatAgent:
    model = os.getenv("LANGROID_MODEL", "gpt-4.1")
    llm_config = lm.OpenAIGPTConfig(chat_model=model, stream=False)
    agent_config = lr.ChatAgentConfig(llm=llm_config, system_message=_SUPERVISOR_PROMPT)
    agent = lr.ChatAgent(agent_config)
    agent.enable_message(list(_SUPERVISOR_TOOLS))
    return agent


# =====================================================================
# AG-UI SSE handler
# =====================================================================


def _sse_line(event: Any) -> str:
    if hasattr(event, "model_dump"):
        data = event.model_dump(by_alias=True, exclude_none=True)
    else:
        data = dict(event)
    return f"data: {json.dumps(data)}\n\n"


def _normalize_state(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {"delegations": []}
    delegations = raw.get("delegations")
    if not isinstance(delegations, list):
        delegations = []
    return {"delegations": list(delegations)}


def _build_conversation(messages: Any) -> str:
    parts: list[str] = []
    if not messages:
        return ""
    for msg in messages:
        role = (
            getattr(msg, "role", None)
            if hasattr(msg, "role")
            else (msg.get("role") if isinstance(msg, dict) else None)
        )
        content = (
            getattr(msg, "content", None)
            if hasattr(msg, "content")
            else (msg.get("content") if isinstance(msg, dict) else None)
        )
        if isinstance(role, str) and isinstance(content, str):
            parts.append(f"{role}: {content}")
    return "\n".join(parts)


def _extract_sub_agent_calls(response: Any) -> list[tuple[str, str, str]]:
    """Pull supervisor sub-agent tool calls out of an LLMResponse.

    Returns a list of (call_id, sub_agent_name, task). Skips any call
    that doesn't target one of the three sub-agents or that has a
    malformed ``task`` argument.
    """
    out: list[tuple[str, str, str]] = []
    tool_calls = getattr(response, "oai_tool_calls", None) or []
    for tc in tool_calls:
        fn = getattr(tc, "function", None)
        name = getattr(fn, "name", None) if fn is not None else None
        if name not in _SUB_AGENT_NAMES:
            continue
        raw_args = getattr(fn, "arguments", None) if fn is not None else None
        args: Any = raw_args
        if isinstance(raw_args, (str, bytes, bytearray)):
            try:
                args = json.loads(raw_args)
            except (ValueError, TypeError):
                continue
        if not isinstance(args, dict):
            continue
        task = args.get("task")
        if not isinstance(task, str) or not task:
            continue
        call_id = getattr(tc, "id", None) or str(uuid.uuid4())
        out.append((call_id, name, task))
    return out


def _append_delegation(state: dict[str, Any], *, sub_agent: str, task: str) -> str:
    entry_id = str(uuid.uuid4())
    entry: Delegation = {
        "id": entry_id,
        "sub_agent": sub_agent,  # type: ignore[typeddict-item]
        "task": task,
        "status": "running",
        "result": "",
    }
    state["delegations"] = [*state.get("delegations", []), entry]
    return entry_id


def _update_delegation(
    state: dict[str, Any], *, entry_id: str, status: str, result: str
) -> None:
    delegations = list(state.get("delegations") or [])
    for entry in delegations:
        if entry.get("id") == entry_id:
            entry["status"] = status
            entry["result"] = result
            state["delegations"] = delegations
            return
    logger.warning(
        "subagents: delegation entry %s missing on update — final %s state "
        "(result_length=%d) will not be rendered",
        entry_id,
        status,
        len(result),
    )


# Maximum number of supervisor turns per request. Belt-and-suspenders:
# the prompt already nudges the supervisor to delegate sequentially and
# return a summary, but a stuck loop (model keeps re-delegating without
# converging) would otherwise burn quota indefinitely.
_MAX_SUPERVISOR_TURNS = 6


async def handle_run(request: Request) -> StreamingResponse:
    error_id = str(uuid.uuid4())
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError) as exc:
        logger.exception("subagents: failed to parse body (error_id=%s)", error_id)
        return JSONResponse(
            {
                "error": "Invalid JSON body",
                "errorId": error_id,
                "class": exc.__class__.__name__,
            },
            status_code=400,
        )
    try:
        run_input = RunAgentInput(**body)
    except Exception as exc:  # noqa: BLE001
        logger.exception("subagents: invalid RunAgentInput (error_id=%s)", error_id)
        return JSONResponse(
            {
                "error": "Invalid RunAgentInput payload",
                "errorId": error_id,
                "class": exc.__class__.__name__,
            },
            status_code=422,
        )

    state = _normalize_state(run_input.state)
    supervisor = _create_supervisor()
    user_message = _build_conversation(run_input.messages)
    thread_id = run_input.thread_id or str(uuid.uuid4())

    async def event_stream() -> AsyncGenerator[str, None]:
        run_id = str(uuid.uuid4())

        yield _sse_line(
            RunStartedEvent(
                type=EventType.RUN_STARTED,
                thread_id=thread_id,
                run_id=run_id,
            )
        )
        yield _sse_line(
            StateSnapshotEvent(
                type=EventType.STATE_SNAPSHOT,
                snapshot=state,
            )
        )

        prompt = user_message
        for turn in range(_MAX_SUPERVISOR_TURNS):
            try:
                response = await supervisor.llm_response_async(prompt)
            except Exception as exc:  # noqa: BLE001
                logger.exception(
                    "subagents: supervisor.llm_response_async failed (turn=%d)",
                    turn,
                )
                # Use RunErrorEvent (the proper AG-UI primitive) so the UI
                # can surface a real error state instead of rendering a raw
                # JSON blob inside a chat bubble.
                yield _sse_line(
                    RunErrorEvent(
                        type=EventType.RUN_ERROR,
                        message=f"Supervisor failed: {exc.__class__.__name__}",
                    )
                )
                break

            if response is None:
                break

            calls = _extract_sub_agent_calls(response)
            if not calls:
                # Plain text — supervisor finished, stream and stop.
                content = getattr(response, "content", None) or ""
                if content:
                    msg_id = str(uuid.uuid4())
                    yield _sse_line(
                        TextMessageStartEvent(
                            type=EventType.TEXT_MESSAGE_START,
                            message_id=msg_id,
                        )
                    )
                    yield _sse_line(
                        TextMessageContentEvent(
                            type=EventType.TEXT_MESSAGE_CONTENT,
                            message_id=msg_id,
                            delta=content,
                        )
                    )
                    yield _sse_line(
                        TextMessageEndEvent(
                            type=EventType.TEXT_MESSAGE_END,
                            message_id=msg_id,
                        )
                    )
                break

            # Run each delegation in order. We stream a `running` snapshot
            # before invoking the sub-agent and a `completed` / `failed`
            # snapshot after, so the UI shows the in-flight row.
            results: list[str] = []
            for call_id, sub_name, task in calls:
                # Emit the supervisor's tool call first — useful for any UI
                # that wants to render the call envelope itself.
                yield _sse_line(
                    ToolCallStartEvent(
                        type=EventType.TOOL_CALL_START,
                        tool_call_id=call_id,
                        tool_call_name=sub_name,
                    )
                )
                yield _sse_line(
                    ToolCallArgsEvent(
                        type=EventType.TOOL_CALL_ARGS,
                        tool_call_id=call_id,
                        delta=json.dumps({"task": task}),
                    )
                )
                yield _sse_line(
                    ToolCallEndEvent(
                        type=EventType.TOOL_CALL_END,
                        tool_call_id=call_id,
                    )
                )

                entry_id = _append_delegation(state, sub_agent=sub_name, task=task)
                yield _sse_line(
                    StateSnapshotEvent(
                        type=EventType.STATE_SNAPSHOT,
                        snapshot=state,
                    )
                )

                try:
                    sub_result = await _invoke_sub_agent(sub_name, task)
                except RuntimeError as exc:
                    _update_delegation(
                        state,
                        entry_id=entry_id,
                        status="failed",
                        result=str(exc),
                    )
                    yield _sse_line(
                        StateSnapshotEvent(
                            type=EventType.STATE_SNAPSHOT,
                            snapshot=state,
                        )
                    )
                    results.append(f"[{sub_name} failed: {exc}]")
                    continue

                _update_delegation(
                    state,
                    entry_id=entry_id,
                    status="completed",
                    result=sub_result,
                )
                yield _sse_line(
                    StateSnapshotEvent(
                        type=EventType.STATE_SNAPSHOT,
                        snapshot=state,
                    )
                )
                results.append(f"[{sub_name} result]\n{sub_result}")

            # Re-prompt the supervisor with all delegation outputs so it
            # can chain (research -> write -> critique) or summarize.
            prompt = (
                "The sub-agents you delegated to returned the following:\n\n"
                + "\n\n".join(results)
                + "\n\nDecide whether to delegate further or, if the work "
                "is done, write a brief final summary for the user."
            )
        else:
            # Loop finished without ``break`` — we hit the turn cap.
            msg_id = str(uuid.uuid4())
            cap_msg = (
                "Supervisor reached the delegation cap "
                f"({_MAX_SUPERVISOR_TURNS} turns) without finalizing. "
                "Showing partial results; please refine your request."
            )
            yield _sse_line(
                TextMessageStartEvent(
                    type=EventType.TEXT_MESSAGE_START, message_id=msg_id
                )
            )
            yield _sse_line(
                TextMessageContentEvent(
                    type=EventType.TEXT_MESSAGE_CONTENT,
                    message_id=msg_id,
                    delta=cap_msg,
                )
            )
            yield _sse_line(
                TextMessageEndEvent(type=EventType.TEXT_MESSAGE_END, message_id=msg_id)
            )

        yield _sse_line(
            RunFinishedEvent(
                type=EventType.RUN_FINISHED,
                thread_id=thread_id,
                run_id=run_id,
            )
        )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
