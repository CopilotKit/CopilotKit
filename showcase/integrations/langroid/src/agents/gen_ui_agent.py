"""gen-ui-agent demo — Langroid.

Mirrors ``langgraph-python/src/agents/gen_ui_agent.py`` and
``ms-agent-python/src/agents/gen_ui_agent.py``: the agent owns an explicit
``steps`` slice of shared state (each step is ``{id, title, status}``
with status in ``pending`` / ``in_progress`` / ``completed``) and walks
each step pending → in_progress → completed by repeatedly calling a
custom ``set_steps`` tool. Every ``set_steps`` call mutates the local
state dict and emits a fresh AG-UI ``STATE_SNAPSHOT`` so the frontend's
``useAgent`` subscriber re-renders the progress card in place.

Langroid does not provide a native shared-state channel — we implement
it directly on top of AG-UI's ``STATE_SNAPSHOT`` event, mirroring the
posture taken by ``shared_state_read_write.py``. The LLM is driven via
the OpenAI client directly (not langroid's ``ChatAgent``) so the
multi-turn tool-call loop has explicit control over state mutation and
event emission per iteration, and so aimock can intercept and
fixture-match each request by message history shape.

The handler is wired up by ``agent_server.py`` at ``POST /gen-ui-agent``
and reached from the frontend via the ``gen-ui-agent`` entry in
``src/app/api/copilotkit/route.ts``, which points its ``HttpAgent`` at
``${AGENT_URL}/gen-ui-agent``.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from typing import Any, AsyncGenerator

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

import openai

logger = logging.getLogger(__name__)


# =====================================================================
# State shape (mirrors the UI's AgentState.steps in
# src/app/demos/gen-ui-agent/InlineAgentStateCard.tsx).
# =====================================================================
#
# { "steps": [ { "id": str, "title": str,
#                "status": "pending" | "in_progress" | "completed" }, ... ] }
#
# Owned by the agent. The UI only READS via useAgent; it never writes
# back into this slice.

_VALID_STATUSES = frozenset({"pending", "in_progress", "completed"})


def _normalize_state(raw: Any) -> dict[str, Any]:
    """Coerce inbound RunAgentInput.state into our canonical dict.

    AG-UI types ``state`` as ``Any``. A malformed frontend (or fresh
    session shipping ``None``) is treated as "empty plan" — we don't
    try to reconstruct shape from non-dicts. Steps that aren't dicts,
    or that lack the canonical keys, are dropped silently.
    """
    if not isinstance(raw, dict):
        return {"steps": []}

    steps_raw = raw.get("steps")
    if not isinstance(steps_raw, list):
        return {"steps": []}

    steps: list[dict[str, Any]] = []
    for s in steps_raw:
        if not isinstance(s, dict):
            continue
        status = s.get("status")
        if not isinstance(status, str) or status not in _VALID_STATUSES:
            continue
        title = s.get("title")
        if not isinstance(title, str):
            continue
        step_id = s.get("id")
        if not isinstance(step_id, str) or not step_id:
            step_id = str(uuid.uuid4())
        steps.append({"id": step_id, "title": title, "status": status})

    return {"steps": steps}


def _sanitize_steps(raw: Any) -> list[dict[str, Any]] | None:
    """Coerce a ``set_steps`` argument into a clean steps list.

    Returns ``None`` if the input isn't a list at all — the caller will
    skip the snapshot emission rather than blank out the UI. Invalid
    individual entries are dropped (defense in depth — the prompt is
    strict, but a misbehaving model shouldn't break the UI).
    """
    if not isinstance(raw, list):
        return None
    out: list[dict[str, Any]] = []
    for s in raw:
        if not isinstance(s, dict):
            continue
        status = s.get("status")
        if not isinstance(status, str) or status not in _VALID_STATUSES:
            continue
        title = s.get("title")
        if not isinstance(title, str):
            continue
        step_id = s.get("id")
        if not isinstance(step_id, str) or not step_id:
            step_id = str(uuid.uuid4())
        out.append({"id": step_id, "title": title, "status": status})
    return out


# =====================================================================
# ``set_steps`` tool — OpenAI function spec.
# =====================================================================

_SET_STEPS_TOOL_SPEC: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "set_steps",
        "description": (
            "Publish the current plan and step statuses. Call this every "
            "time a step transitions (including the first enumeration of "
            "steps). Always include the FULL list of steps on each call — "
            "this REPLACES the steps array in shared state."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "steps": {
                    "type": "array",
                    "description": (
                        "The complete source of truth for the plan: every "
                        "step with id, title, and status."
                    ),
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {
                                "type": "string",
                                "description": "Stable identifier for the step.",
                            },
                            "title": {
                                "type": "string",
                                "description": "Short human-readable description.",
                            },
                            "status": {
                                "type": "string",
                                "enum": ["pending", "in_progress", "completed"],
                            },
                        },
                        "required": ["id", "title", "status"],
                    },
                },
            },
            "required": ["steps"],
        },
    },
}


_SYSTEM_PROMPT = (
    "You are an agentic planner. For each user request, follow this exact "
    "sequence:\n"
    "1. Plan exactly 3 concrete steps and call `set_steps` ONCE with all "
    'three steps at status="pending".\n'
    '2. Step 1: call `set_steps` with step 1 at status="in_progress", '
    'then call `set_steps` again with step 1 at status="completed".\n'
    '3. Step 2: call `set_steps` with step 2 at status="in_progress", '
    'then call `set_steps` again with step 2 at status="completed".\n'
    '4. Step 3: call `set_steps` with step 3 at status="in_progress", '
    'then call `set_steps` again with step 3 at status="completed".\n'
    "5. Send ONE final conversational assistant message summarizing the "
    "plan, then stop. Do not call any more tools after step 3 is "
    "completed.\n"
    "\n"
    "Rules: never call set_steps in parallel — always wait for one call "
    "to return before the next. Always send the FULL steps list on every "
    "call (this REPLACES the array). After all three steps are completed "
    "you MUST send a final assistant message and terminate."
)


# Bound on the tool-call loop. The prompt drives ~7 set_steps calls + 1
# final assistant turn, so 12 iterations gives ~70% headroom for retries
# without runaway cost if the model misbehaves.
_MAX_TOOL_ITERATIONS = 12


async def _call_openai(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
) -> Any:
    """Call the OpenAI chat completions API directly.

    Uses ``openai.AsyncOpenAI()`` which reads ``OPENAI_API_KEY`` and
    ``OPENAI_BASE_URL`` from the environment (aimock sets the base URL
    in the showcase).
    """
    model = os.getenv("LANGROID_MODEL", "gpt-4.1")
    client = openai.AsyncOpenAI()
    response = await client.chat.completions.create(
        model=model,
        messages=messages,
        tools=tools if tools else openai.NOT_GIVEN,
    )
    return response.choices[0].message


# =====================================================================
# AG-UI SSE helpers
# =====================================================================


def _sse_line(event: Any) -> str:
    if hasattr(event, "model_dump"):
        data = event.model_dump(by_alias=True, exclude_none=True)
    else:
        data = dict(event)
    return f"data: {json.dumps(data)}\n\n"


def _agui_messages_to_openai(
    messages: Any,
    system_prompt: str,
) -> list[dict[str, Any]]:
    """Convert AG-UI messages to OpenAI chat completion format.

    Mirrors ``shared_state_read_write._agui_messages_to_openai`` and the
    main ``agui_adapter`` — preserves ``tool_calls`` and ``tool_call_id``
    so aimock fixture matchers see the full multi-turn shape.
    """
    oai_msgs: list[dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
    ]

    if not messages:
        return oai_msgs

    for msg in messages:
        role = getattr(msg, "role", None)
        if not isinstance(role, str):
            if isinstance(msg, dict):
                role = msg.get("role")
            if not isinstance(role, str):
                continue

        if role == "tool":
            tool_call_id = getattr(msg, "tool_call_id", None)
            if isinstance(msg, dict):
                tool_call_id = tool_call_id or msg.get("tool_call_id")
            content = getattr(msg, "content", "") or ""
            if isinstance(msg, dict):
                content = content or msg.get("content", "")
            if tool_call_id:
                oai_msgs.append(
                    {
                        "role": "tool",
                        "tool_call_id": str(tool_call_id),
                        "content": str(content),
                    }
                )
            continue

        if role == "assistant":
            content = getattr(msg, "content", None)
            if isinstance(msg, dict):
                content = content or msg.get("content")
            tool_calls_raw = getattr(msg, "tool_calls", None)
            if isinstance(msg, dict):
                tool_calls_raw = tool_calls_raw or msg.get("tool_calls")

            oai_msg: dict[str, Any] = {"role": "assistant"}
            if content:
                oai_msg["content"] = str(content)
            if tool_calls_raw:
                oai_tcs = []
                for tc in tool_calls_raw:
                    tc_id = getattr(tc, "id", None)
                    fn = getattr(tc, "function", None)
                    if fn is None and isinstance(tc, dict):
                        fn_name = tc.get("function", {}).get("name", "")
                        fn_args = tc.get("function", {}).get("arguments", "")
                        tc_id = tc_id or tc.get("id", "")
                    else:
                        fn_name = getattr(fn, "name", "") if fn else ""
                        fn_args = getattr(fn, "arguments", "") if fn else ""
                    if tc_id and fn_name:
                        oai_tcs.append(
                            {
                                "id": str(tc_id),
                                "type": "function",
                                "function": {
                                    "name": str(fn_name),
                                    "arguments": str(fn_args),
                                },
                            }
                        )
                if oai_tcs:
                    oai_msg["tool_calls"] = oai_tcs
                    if "content" not in oai_msg:
                        oai_msg["content"] = None
            else:
                if "content" not in oai_msg:
                    oai_msg["content"] = ""
            oai_msgs.append(oai_msg)
            continue

        if role in ("user", "system", "developer"):
            content = getattr(msg, "content", None)
            if isinstance(msg, dict):
                content = content or msg.get("content")
            if content is not None:
                oai_msgs.append(
                    {
                        "role": role,
                        "content": str(content),
                    }
                )
            continue

    return oai_msgs


def _extract_set_steps_calls(
    response: Any,
) -> list[tuple[str, list[dict[str, Any]] | None, str]]:
    """Return ``(tool_call_id, sanitized_steps, raw_args_str)`` per
    ``set_steps`` call in the response.

    Non-set_steps tool calls are skipped (defense — the model only has
    one tool, but if it ever hallucinates another we'd rather ignore
    than crash). ``sanitized_steps`` is ``None`` if the args couldn't
    be coerced into a steps list — caller skips snapshot emission for
    that entry.
    """
    out: list[tuple[str, list[dict[str, Any]] | None, str]] = []
    tool_calls = getattr(response, "tool_calls", None) or []
    for tc in tool_calls:
        fn = getattr(tc, "function", None)
        name = getattr(fn, "name", None) if fn is not None else None
        if name != "set_steps":
            continue
        tc_id = getattr(tc, "id", None) or str(uuid.uuid4())
        raw_args = getattr(fn, "arguments", None) if fn is not None else None
        args_str = raw_args if isinstance(raw_args, str) else json.dumps(raw_args or {})
        parsed: Any = raw_args
        if isinstance(raw_args, (str, bytes, bytearray)):
            try:
                parsed = json.loads(raw_args)
            except (ValueError, TypeError):
                out.append((str(tc_id), None, args_str))
                continue
        if not isinstance(parsed, dict):
            out.append((str(tc_id), None, args_str))
            continue
        sanitized = _sanitize_steps(parsed.get("steps"))
        out.append((str(tc_id), sanitized, args_str))
    return out


# =====================================================================
# AG-UI SSE handler
# =====================================================================


async def handle_run(request: Request) -> StreamingResponse:
    """Handle one AG-UI ``/gen-ui-agent`` request.

    Drives a bounded multi-turn loop with the LLM: each ``set_steps``
    tool call updates local state and emits a fresh ``STATE_SNAPSHOT``
    plus ``TOOL_CALL_*`` events, then feeds the tool result back to the
    model for the next turn. The loop terminates when the model emits a
    final text response (or, defensively, after ``_MAX_TOOL_ITERATIONS``
    iterations).
    """
    error_id = str(uuid.uuid4())
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError) as exc:
        logger.exception("gen-ui-agent: failed to parse body (error_id=%s)", error_id)
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
    except Exception as exc:  # noqa: BLE001 — pydantic.ValidationError surfaces here
        logger.exception("gen-ui-agent: invalid RunAgentInput (error_id=%s)", error_id)
        return JSONResponse(
            {
                "error": "Invalid RunAgentInput payload",
                "errorId": error_id,
                "class": exc.__class__.__name__,
            },
            status_code=422,
        )

    state = _normalize_state(run_input.state)
    oai_messages = _agui_messages_to_openai(run_input.messages or [], _SYSTEM_PROMPT)
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

        # Initial baseline snapshot so a fresh session always sees the
        # empty (or restored) steps array before the agent writes the
        # plan. Mirrors shared_state_read_write's initial snapshot.
        yield _sse_line(
            StateSnapshotEvent(
                type=EventType.STATE_SNAPSHOT,
                snapshot=state,
            )
        )

        messages = list(oai_messages)

        for _ in range(_MAX_TOOL_ITERATIONS):
            try:
                response = await _call_openai(messages, [_SET_STEPS_TOOL_SPEC])
            except Exception as exc:  # noqa: BLE001 — surface as RunError + finish
                logger.exception("gen-ui-agent: _call_openai failed")
                yield _sse_line(
                    RunErrorEvent(
                        type=EventType.RUN_ERROR,
                        message=f"Agent run failed: {exc.__class__.__name__}",
                    )
                )
                yield _sse_line(
                    RunFinishedEvent(
                        type=EventType.RUN_FINISHED,
                        thread_id=thread_id,
                        run_id=run_id,
                    )
                )
                return

            if response is None:
                break

            calls = _extract_set_steps_calls(response)

            if not calls:
                # No tool call this turn — stream any text and finish.
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

            # Apply each set_steps call: update state, emit TOOL_CALL_*
            # + STATE_SNAPSHOT, and accumulate the assistant + tool
            # result messages for the follow-up LLM turn.
            assistant_tool_calls: list[dict[str, Any]] = []
            tool_result_msgs: list[dict[str, Any]] = []

            for call_id, sanitized, raw_args_str in calls:
                if sanitized is None:
                    logger.warning(
                        "gen-ui-agent: skipping set_steps call %s — args could "
                        "not be parsed as steps list",
                        call_id,
                    )
                    # Still record the tool result so the model's message
                    # history stays coherent and it can retry.
                    assistant_tool_calls.append(
                        {
                            "id": call_id,
                            "type": "function",
                            "function": {
                                "name": "set_steps",
                                "arguments": raw_args_str,
                            },
                        }
                    )
                    tool_result_msgs.append(
                        {
                            "role": "tool",
                            "tool_call_id": call_id,
                            "content": "Invalid steps payload — please retry with a list of steps.",
                        }
                    )
                    continue

                state["steps"] = sanitized

                yield _sse_line(
                    ToolCallStartEvent(
                        type=EventType.TOOL_CALL_START,
                        tool_call_id=call_id,
                        tool_call_name="set_steps",
                    )
                )
                yield _sse_line(
                    ToolCallArgsEvent(
                        type=EventType.TOOL_CALL_ARGS,
                        tool_call_id=call_id,
                        delta=json.dumps({"steps": sanitized}),
                    )
                )
                yield _sse_line(
                    ToolCallEndEvent(
                        type=EventType.TOOL_CALL_END,
                        tool_call_id=call_id,
                    )
                )
                yield _sse_line(
                    StateSnapshotEvent(
                        type=EventType.STATE_SNAPSHOT,
                        snapshot=state,
                    )
                )

                assistant_tool_calls.append(
                    {
                        "id": call_id,
                        "type": "function",
                        "function": {
                            "name": "set_steps",
                            "arguments": raw_args_str,
                        },
                    }
                )
                tool_result_msgs.append(
                    {
                        "role": "tool",
                        "tool_call_id": call_id,
                        "content": f"Published {len(sanitized)} step(s).",
                    }
                )

            # Append the assistant turn (with its tool_calls) + the tool
            # results, so the next LLM call sees the full conversation
            # and can decide to transition the next step or finalize.
            messages.append(
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": assistant_tool_calls,
                }
            )
            messages.extend(tool_result_msgs)
        else:
            logger.warning(
                "gen-ui-agent: hit _MAX_TOOL_ITERATIONS=%d without a final "
                "text turn — terminating the run",
                _MAX_TOOL_ITERATIONS,
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
