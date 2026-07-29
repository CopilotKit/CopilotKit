"""Claude Agent SDK backend for the A2UI Error Recovery demo (OSS-158 / OSS-375).

Same dynamic-schema A2UI setup as ``a2ui_dynamic.py`` (declarative-gen-ui), but
with the validate->retry recovery loop made *visible*. The two aimock pills drive
the inner ``render_a2ui`` sub-agent two ways:

  - HEAL pill: the first render is structurally invalid (the ``root`` references a
    child id that no component defines) -> the validate->retry loop rejects it and
    retries; the second attempt is valid -> recovery succeeds and paints.
  - EXHAUST pill: every attempt is structurally invalid (unresolved child), so the
    loop hits the attempt cap and the tool returns the ``a2ui_recovery_exhausted``
    hard-fail envelope, which the frontend middleware surfaces as a tasteful
    ``failed`` state ("Couldn't generate the UI") — never a broken surface.

WHY THIS IS RE-IMPLEMENTED NATIVELY
-----------------------------------
The langgraph-python / langgraph-typescript / ADK siblings own ``generate_a2ui``
via ``ag_ui_langgraph.get_a2ui_tools`` (delegating to ``ag_ui_a2ui_toolkit``),
whose body runs the ``render_a2ui`` sub-agent + the toolkit validate->retry
recovery loop + the recovery-exhausted envelope IN-GRAPH. claude-sdk-python uses
its OWN adapter (``ag-ui-claude-sdk`` + ``claude-agent-sdk``) and does NOT depend
on ``ag_ui_langgraph`` / ``ag_ui_a2ui_toolkit`` — so it cannot inherit that loop.
This module re-implements the equivalent loop natively so the cell earns a REAL
green (not a shared defect):

  * ``_validate_a2ui_components`` is a behavior-faithful port of the toolkit's
    ``validate_a2ui_components`` (catalog-free structural subset: empty payload,
    missing id/type, unresolved ``child``/``children`` refs, ``no_root``) — the
    same checks the middleware uses, so the tool's retry decision and the
    middleware's paint decision agree on the demo's fixtures.
  * ``_run_render_with_recovery`` mirrors the toolkit's
    ``run_a2ui_generation_with_recovery``: attempts 1..maxAttempts, one inner
    ``render_a2ui`` Claude call PER attempt (so aimock's ``sequenceIndex`` matches
    attempt 1 vs attempt 2 for the HEAL pill), validate, retry-with-error-feedback,
    and the ``a2ui_recovery_exhausted`` envelope shape on cap.

The dedicated route (``api/copilotkit-a2ui-recovery/route.ts``) sets
``injectA2UITool: false`` (the backend owns the tool). The catalog is reused from
declarative-gen-ui ("declarative-gen-ui-catalog"); the Vantage Threads sales
dataset arrives from the frontend via App Context (declarative-gen-ui/sales-context.ts).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import traceback
from collections.abc import AsyncIterator
from textwrap import dedent
from typing import Any, Callable, Optional

import anthropic
from ag_ui.core import (
    EventType,
    RunAgentInput,
    RunFinishedEvent,
    RunStartedEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallResultEvent,
    ToolCallStartEvent,
)
from ag_ui.encoder import EventEncoder

from tools import (
    RENDER_A2UI_TOOL_SCHEMA,
    build_a2ui_operations_from_tool_call,
)
from agents._anthropic_message_safety import sanitize_unresolved_tool_uses
from agents.claude_agent_sdk_adapter import normalize_claude_model

logger = logging.getLogger(__name__)


# Keep aligned with a2ui_dynamic.SYSTEM_PROMPT and the langgraph-python
# recovery_agent SYSTEM_PROMPT: a sales analyst that answers every question by
# drawing a surface. `generate_a2ui` handles the rendering — and its automatic
# recovery — internally.
SYSTEM_PROMPT = dedent("""
    You are the embedded sales analyst for Vantage Threads, the fictional B2B
    apparel company described in your App Context. Answer every business
    question by calling `generate_a2ui` to draw a rich visual surface, and keep
    the chat reply to one short sentence. Ground every number in the sales
    dataset from your App Context. `generate_a2ui` handles the rendering — and
    its automatic recovery — for you.
""").strip()


# The outer tool the primary agent owns. Mirrors a2ui_dynamic.GENERATE_A2UI_TOOL
# but takes an `intent` arg (matching the toolkit's create/update signature and
# the a2ui-recovery aimock fixtures, whose outer emit is `{"intent": "create"}`).
GENERATE_A2UI_TOOL = {
    "name": "generate_a2ui",
    "description": (
        "Generate a dynamic A2UI surface with automatic error recovery. A "
        "secondary LLM designs the UI schema using the registered catalog; a "
        "validate->retry loop heals a malformed first attempt or fails gracefully."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "intent": {
                "type": "string",
                "description": 'Either "create" for a new surface or "update" to modify one.',
            },
        },
        "required": ["intent"],
    },
}


# Recovery attempt cap (initial try + retries). Mirrors the toolkit default and
# the reference recovery_agent's `recovery={"maxAttempts": 3}`; the renderer's
# "Retrying… (N/M)" label keys off this cap.
MAX_A2UI_ATTEMPTS = 3


# ---------------------------------------------------------------------------
# Native validation (catalog-free structural subset of the toolkit's
# validate_a2ui_components — the checks the demo fixtures exercise).
# ---------------------------------------------------------------------------
def _collect_child_refs(children: Any) -> list[str]:
    """Collect child id references from a `children` list or singular `child`.

    Mirrors the toolkit's `_collect_child_refs`: a bare string is an id ref; a
    `{"componentId": "..."}` object contributes its id.
    """
    refs: list[str] = []

    def push(v: Any) -> None:
        if isinstance(v, str):
            refs.append(v)
        elif isinstance(v, dict) and isinstance(v.get("componentId"), str):
            refs.append(v["componentId"])

    if isinstance(children, list):
        for v in children:
            push(v)
    else:
        push(children)
    return refs


def _validate_a2ui_components(components: Any) -> dict[str, Any]:
    """Structural validation of a flat A2UI v0.9 component array.

    Behavior-faithful (catalog-free) port of the toolkit's
    `validate_a2ui_components`: fails on a non-list/empty payload, components
    missing a string `id`/`component`, `child`/`children` refs that don't
    resolve to a defined id (`unresolved_child`), and a missing `root`
    (`no_root`). Returns `{"valid": bool, "errors": [{code, path, message}]}`.
    """
    errors: list[dict[str, str]] = []

    if not isinstance(components, list) or len(components) == 0:
        return {
            "valid": False,
            "errors": [
                {
                    "code": "empty_components",
                    "path": "components",
                    "message": "A2UI components must be a non-empty array",
                }
            ],
        }

    ids: set[str] = set()
    for comp in components:
        cid = comp.get("id") if isinstance(comp, dict) else None
        if isinstance(cid, str) and cid:
            ids.add(cid)

    for i, comp in enumerate(components):
        cid = comp.get("id") if isinstance(comp, dict) else None
        ctype = comp.get("component") if isinstance(comp, dict) else None

        if not isinstance(cid, str) or len(cid) == 0:
            errors.append(
                {
                    "code": "missing_id",
                    "path": f"components[{i}].id",
                    "message": f"Component at index {i} is missing a string 'id'",
                }
            )
        if not isinstance(ctype, str) or len(ctype) == 0:
            errors.append(
                {
                    "code": "missing_component_type",
                    "path": f"components[{i}].component",
                    "message": f"Component at index {i} is missing a string 'component' type",
                }
            )

        if isinstance(comp, dict):
            for ref in [
                *_collect_child_refs(comp.get("child")),
                *_collect_child_refs(comp.get("children")),
            ]:
                if ref not in ids:
                    errors.append(
                        {
                            "code": "unresolved_child",
                            "path": f"components[{i}]",
                            "message": f"Child reference '{ref}' does not match any component id",
                        }
                    )

    if not any(isinstance(c, dict) and c.get("id") == "root" for c in components):
        errors.append(
            {
                "code": "no_root",
                "path": "components",
                "message": "No component has id 'root'",
            }
        )

    return {"valid": len(errors) == 0, "errors": errors}


def _format_validation_errors(errors: list[dict[str, str]]) -> str:
    return "\n".join(f"- [{e['code']}] {e['path']}: {e['message']}" for e in errors)


def _augment_prompt_with_errors(prompt: str, errors: list[dict[str, str]]) -> str:
    if not errors:
        return prompt
    return (
        f"{prompt}\n\n## Previous attempt was invalid — fix these and regenerate:\n"
        f"{_format_validation_errors(errors)}\n"
    )


def _wrap_recovery_exhausted_envelope(
    max_attempts: int, attempts: list[dict[str, Any]]
) -> dict[str, Any]:
    """The hard-fail envelope. Shape mirrors the toolkit's
    `_wrap_recovery_exhausted_envelope` so the frontend middleware surfaces the
    tasteful `failed` state ("Couldn't generate the UI") instead of a surface.
    """
    return {
        "error": f"Failed to generate valid A2UI after {max_attempts} attempt(s)",
        "code": "a2ui_recovery_exhausted",
        "attempts": attempts,
    }


def _invoke_render_subagent(
    client: anthropic.Anthropic,
    system_prompt: str,
    conversation_messages: list[dict[str, Any]],
) -> Optional[dict[str, Any]]:
    """One inner `render_a2ui` Claude call — returns the tool-call args, or None.

    A SEPARATE call is made per recovery attempt so aimock's `sequenceIndex`
    (attempt 1 = seq 0, attempt 2 = seq 1 for the HEAL pill) disambiguates the
    responses.
    """
    render_tool_schema = {
        "name": RENDER_A2UI_TOOL_SCHEMA["name"],
        "description": RENDER_A2UI_TOOL_SCHEMA["description"],
        "input_schema": RENDER_A2UI_TOOL_SCHEMA["parameters"],
    }
    llm_messages = sanitize_unresolved_tool_uses(conversation_messages) or [
        {
            "role": "user",
            "content": "Generate a dynamic A2UI dashboard based on the conversation.",
        }
    ]
    response = client.messages.create(
        model=normalize_claude_model(os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4.6")),
        max_tokens=4096,
        system=system_prompt or "Generate a useful dashboard UI.",
        messages=llm_messages,
        tools=[render_tool_schema],
        tool_choice={"type": "tool", "name": "render_a2ui"},
    )
    for block in response.content:
        if getattr(block, "type", None) == "tool_use" and block.name == "render_a2ui":
            return dict(block.input)
    return None


def _run_render_with_recovery(
    context: str,
    conversation_messages: list[dict[str, Any]] | None = None,
    on_attempt: Optional[Callable[[dict[str, Any]], None]] = None,
) -> dict[str, Any]:
    """Drive the validate->retry loop and return either a healed
    `a2ui_operations` container or a `a2ui_recovery_exhausted` envelope.

    Mirrors the toolkit's `run_a2ui_generation_with_recovery`.
    """
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))
    messages = conversation_messages or []
    attempts: list[dict[str, Any]] = []

    for attempt in range(1, MAX_A2UI_ATTEMPTS + 1):
        errors = attempts[-1]["errors"] if attempts else []
        system_prompt = _augment_prompt_with_errors(
            context or "Generate a useful dashboard UI.", errors
        )
        args = _invoke_render_subagent(client, system_prompt, messages)

        if not args:
            record = {
                "attempt": attempt,
                "ok": False,
                "errors": [
                    {
                        "code": "empty_components",
                        "path": "components",
                        "message": "Sub-agent did not call render_a2ui",
                    }
                ],
            }
            attempts.append(record)
            if on_attempt:
                on_attempt(record)
            continue

        raw_components = args.get("components")
        components = raw_components if isinstance(raw_components, list) else []
        result = _validate_a2ui_components(components)
        record = {"attempt": attempt, "ok": result["valid"], "errors": result["errors"]}
        attempts.append(record)
        if on_attempt:
            on_attempt(record)

        if result["valid"]:
            return build_a2ui_operations_from_tool_call(args)

    return _wrap_recovery_exhausted_envelope(MAX_A2UI_ATTEMPTS, attempts)


def _log_attempt(record: dict) -> None:
    """Dev observability: log each recovery attempt (incl. rejected ones)."""
    logger.info(
        "[a2ui recovery] attempt %s: %s %s",
        record.get("attempt"),
        "valid" if record.get("ok") else "invalid",
        record.get("errors"),
    )


async def run_a2ui_recovery_agent(input_data: RunAgentInput) -> AsyncIterator[str]:
    """Stream a Claude conversation that may call `generate_a2ui` (with recovery)."""
    encoder = EventEncoder()
    client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))

    messages: list[dict[str, Any]] = []
    for msg in input_data.messages or []:
        role = msg.role.value if hasattr(msg.role, "value") else str(msg.role)
        if role not in ("user", "assistant"):
            continue
        raw = getattr(msg, "content", None)
        content = ""
        if isinstance(raw, str):
            content = raw
        elif isinstance(raw, list):
            parts = []
            for part in raw:
                if hasattr(part, "text"):
                    parts.append(part.text)
                elif isinstance(part, dict) and "text" in part:
                    parts.append(part["text"])
            content = "".join(parts)
        if content:
            messages.append({"role": role, "content": content})

    thread_id = input_data.thread_id or "default"
    run_id = input_data.run_id or "run-1"

    yield encoder.encode(
        RunStartedEvent(type=EventType.RUN_STARTED, thread_id=thread_id, run_id=run_id)
    )

    # Cap the tool loop so the run always terminates even if the model keeps
    # re-calling the tool (see a2ui_dynamic.py for the same guard).
    MAX_TOOL_ITERATIONS = 10

    for _iter in range(MAX_TOOL_ITERATIONS):
        msg_id = f"msg-{run_id}-{len(messages)}"
        yield encoder.encode(
            TextMessageStartEvent(
                type=EventType.TEXT_MESSAGE_START,
                message_id=msg_id,
                role="assistant",
            )
        )

        response_text = ""
        tool_calls: list[dict[str, Any]] = []
        try:
            async with client.messages.stream(
                model=normalize_claude_model(
                    os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4.6")
                ),
                max_tokens=2048,
                system=SYSTEM_PROMPT,
                messages=messages,
                tools=[GENERATE_A2UI_TOOL],
            ) as stream:
                current_tool_id: str | None = None
                current_tool_name: str | None = None
                current_tool_args = ""

                async for event in stream:
                    etype = type(event).__name__
                    if etype == "RawContentBlockStartEvent":
                        block = event.content_block  # type: ignore[attr-defined]
                        if block.type == "tool_use":
                            current_tool_id = block.id
                            current_tool_name = block.name
                            current_tool_args = ""
                            yield encoder.encode(
                                ToolCallStartEvent(
                                    type=EventType.TOOL_CALL_START,
                                    tool_call_id=current_tool_id,
                                    tool_call_name=current_tool_name,
                                    parent_message_id=msg_id,
                                )
                            )
                    elif etype == "RawContentBlockDeltaEvent":
                        delta = event.delta  # type: ignore[attr-defined]
                        if delta.type == "text_delta":
                            response_text += delta.text
                            yield encoder.encode(
                                TextMessageContentEvent(
                                    type=EventType.TEXT_MESSAGE_CONTENT,
                                    message_id=msg_id,
                                    delta=delta.text,
                                )
                            )
                        elif delta.type == "input_json_delta":
                            current_tool_args += delta.partial_json
                            yield encoder.encode(
                                ToolCallArgsEvent(
                                    type=EventType.TOOL_CALL_ARGS,
                                    tool_call_id=current_tool_id or "",
                                    delta=delta.partial_json,
                                )
                            )
                    elif etype in (
                        "RawContentBlockStopEvent",
                        "ParsedContentBlockStopEvent",
                    ):
                        if current_tool_id and current_tool_name:
                            yield encoder.encode(
                                ToolCallEndEvent(
                                    type=EventType.TOOL_CALL_END,
                                    tool_call_id=current_tool_id,
                                )
                            )
                            try:
                                parsed = (
                                    json.loads(current_tool_args)
                                    if current_tool_args
                                    else {}
                                )
                            except json.JSONDecodeError:
                                parsed = {}
                            tool_calls.append(
                                {
                                    "id": current_tool_id,
                                    "name": current_tool_name,
                                    "input": parsed,
                                }
                            )
                            current_tool_id = None
                            current_tool_name = None
                            current_tool_args = ""
        except Exception:
            err_text = f"Agent error: {traceback.format_exc()}"
            yield encoder.encode(
                TextMessageContentEvent(
                    type=EventType.TEXT_MESSAGE_CONTENT,
                    message_id=msg_id,
                    delta=err_text,
                )
            )

        yield encoder.encode(
            TextMessageEndEvent(
                type=EventType.TEXT_MESSAGE_END,
                message_id=msg_id,
            )
        )

        if not tool_calls:
            break

        assistant_content: list[dict[str, Any]] = []
        if response_text:
            assistant_content.append({"type": "text", "text": response_text})
        for tc in tool_calls:
            assistant_content.append(
                {
                    "type": "tool_use",
                    "id": tc["id"],
                    "name": tc["name"],
                    "input": tc["input"],
                }
            )
        messages.append({"role": "assistant", "content": assistant_content})

        tool_results: list[dict[str, Any]] = []
        for tc in tool_calls:
            if tc["name"] == "generate_a2ui":
                try:
                    # Offload the synchronous recovery loop (blocking anthropic
                    # round-trips per attempt) to a worker thread so it doesn't
                    # wedge the uvicorn event loop. Mirrors a2ui_dynamic.py.
                    result_obj = await asyncio.to_thread(
                        _run_render_with_recovery,
                        SYSTEM_PROMPT,
                        conversation_messages=messages,
                        on_attempt=_log_attempt,
                    )
                    result_text = json.dumps(result_obj)
                except Exception as exc:  # noqa: BLE001 - surface as tool result
                    result_text = json.dumps(
                        {
                            "error": "generate_a2ui failed",
                            "detail": exc.__class__.__name__,
                        }
                    )
            else:
                result_text = json.dumps({"error": f"unknown tool {tc['name']}"})
            yield encoder.encode(
                ToolCallResultEvent(
                    type=EventType.TOOL_CALL_RESULT,
                    tool_call_id=tc["id"],
                    message_id=f"{msg_id}-tool-result-{tc['id']}",
                    content=result_text,
                )
            )
            tool_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": tc["id"],
                    "content": result_text,
                }
            )
        messages.append({"role": "user", "content": tool_results})

    yield encoder.encode(
        RunFinishedEvent(
            type=EventType.RUN_FINISHED, thread_id=thread_id, run_id=run_id
        )
    )
