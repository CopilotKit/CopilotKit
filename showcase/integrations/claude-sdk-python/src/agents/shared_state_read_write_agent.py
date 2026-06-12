"""Claude Agent SDK backing the Shared State (Read + Write) demo.

Demonstrates the canonical bidirectional shared-state pattern between
the UI and the Claude agent:

- **UI -> agent (write)**: The frontend owns a ``preferences`` object
  ({name, tone, language, interests}) that is written into agent state
  via ``agent.setState({preferences: ...})``. Every turn, the backend
  reads the latest preferences out of ``input_data.state`` and injects
  them into the system prompt so the LLM adapts.
- **agent -> UI (read)**: The agent calls ``set_notes`` to append/replace
  the ``notes`` slot in shared state. The UI subscribes via ``useAgent``
  and re-renders every change.

This is conceptually identical to ``langgraph-python`` /
``shared_state_read_write.py`` — we just emit AG-UI ``StateSnapshotEvent``
events directly from the streaming loop in ``agent.py``-style fashion
instead of relying on a graph framework's middleware.
"""

from __future__ import annotations

import json
import logging
import os
from collections.abc import AsyncIterator
from textwrap import dedent
from typing import Any

import anthropic
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
    ToolCallResultEvent,
    ToolCallStartEvent,
)
from ag_ui.encoder import EventEncoder

logger = logging.getLogger(__name__)

# Default Anthropic model. Pinned to a dated identifier rather than an alias
# so the demo doesn't break when Anthropic rotates aliases. Override with the
# ANTHROPIC_MODEL env var.
DEFAULT_ANTHROPIC_MODEL = "claude-3-5-sonnet-20241022"


SYSTEM_PROMPT = dedent("""
    You are a helpful, concise assistant.

    The user's preferences are supplied via shared state and added at the
    start of every turn — always respect them. Address the user by name
    when known, match the requested tone, and respond in the requested
    language.

    When the user asks you to "remember" something, or you observe
    something worth surfacing in the UI's notes panel, call the
    ``set_notes`` tool with the FULL updated list of short notes
    (existing notes + new ones, not a diff). Keep each note short
    (< 120 characters). After updating notes, briefly acknowledge what
    you remembered.
""").strip()


SET_NOTES_TOOL: dict[str, Any] = {
    "name": "set_notes",
    "description": (
        "Replace the notes array in shared state with the FULL updated "
        "list. Always include every existing note plus any new ones, "
        "not a diff. Keep each note short (< 120 chars)."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "notes": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Full list of short note strings to persist.",
            },
        },
        "required": ["notes"],
    },
}


def build_preferences_block(prefs: dict[str, Any] | None) -> str | None:
    """Render the user-supplied preferences as an injectable prompt block.

    Returns ``None`` when no recognised keys are present so the system
    prompt is left untouched.
    """
    if not isinstance(prefs, dict) or not prefs:
        return None
    lines = ["The user has shared these preferences with you:"]
    if prefs.get("name"):
        lines.append(f"- Name: {prefs['name']}")
    if prefs.get("tone"):
        lines.append(f"- Preferred tone: {prefs['tone']}")
    if prefs.get("language"):
        lines.append(f"- Preferred language: {prefs['language']}")
    interests = prefs.get("interests") or []
    if isinstance(interests, list) and interests:
        lines.append(f"- Interests: {', '.join(str(i) for i in interests)}")
    if len(lines) == 1:
        # No recognised fields — don't emit a header with no content.
        return None
    lines.append(
        "Tailor every response to these preferences. Address the user "
        "by name when appropriate."
    )
    return "\n".join(lines)


def _state_dict(state: dict[str, Any]) -> dict[str, Any]:
    """Coerce the AG-UI raw state envelope into the slots we care about."""
    return {
        "preferences": state.get("preferences") or {},
        "notes": list(state.get("notes") or []),
    }


def _convert_messages(input_data: RunAgentInput) -> list[dict[str, Any]]:
    """Flatten AG-UI messages into Anthropic Messages-API shape (text only)."""
    messages: list[dict[str, Any]] = []
    for msg in input_data.messages or []:
        role = msg.role.value if hasattr(msg.role, "value") else str(msg.role)
        if role not in ("user", "assistant"):
            continue
        raw_content = getattr(msg, "content", None)
        content = ""
        if isinstance(raw_content, str):
            content = raw_content
        elif isinstance(raw_content, list):
            parts = []
            for part in raw_content:
                if hasattr(part, "text"):
                    parts.append(part.text)
                elif isinstance(part, dict) and "text" in part:
                    parts.append(part["text"])
            content = "".join(parts)
        if content:
            messages.append({"role": role, "content": content})
    return messages


async def run_shared_state_read_write_agent(
    input_data: RunAgentInput,
) -> AsyncIterator[str]:
    """Run the shared-state-read-write Claude agent and yield AG-UI events."""
    encoder = EventEncoder()
    client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))

    state = _state_dict(input_data.state if isinstance(input_data.state, dict) else {})

    # @region[shared-state-prefs-injection]
    # Read UI-supplied preferences out of agent state every turn and
    # prepend them onto the system prompt. This is the agent-side half of
    # the bidirectional shared-state pattern: the UI writes via
    # ``agent.setState({preferences: ...})``, the backend reads here.
    prefs_block = build_preferences_block(state["preferences"])
    system = SYSTEM_PROMPT
    if prefs_block:
        system = f"{prefs_block}\n\n{SYSTEM_PROMPT}"
    # @endregion[shared-state-prefs-injection]

    messages = _convert_messages(input_data)

    thread_id = input_data.thread_id or "default"
    run_id = input_data.run_id or "run-1"

    yield encoder.encode(
        RunStartedEvent(type=EventType.RUN_STARTED, thread_id=thread_id, run_id=run_id)
    )

    # Echo the current state at the start so the UI sees the snapshot we
    # are operating on (helpful when the agent decides not to call any
    # tool — the UI still gets a confirmation event).
    yield encoder.encode(
        StateSnapshotEvent(type=EventType.STATE_SNAPSHOT, snapshot=state)
    )

    while True:
        response_text = ""
        tool_calls: list[dict[str, Any]] = []
        msg_id = f"msg-{run_id}-{len(messages)}"

        yield encoder.encode(
            TextMessageStartEvent(
                type=EventType.TEXT_MESSAGE_START,
                message_id=msg_id,
                role="assistant",
            )
        )

        async with client.messages.stream(
            model=os.getenv("ANTHROPIC_MODEL", DEFAULT_ANTHROPIC_MODEL),
            max_tokens=2048,
            system=system,
            messages=messages,
            tools=[SET_NOTES_TOOL],
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
                        parsed_args: dict[str, Any] | None
                        try:
                            parsed_args = (
                                json.loads(current_tool_args)
                                if current_tool_args
                                else {}
                            )
                        except json.JSONDecodeError as exc:
                            # Surface malformed tool args loudly instead of
                            # silently substituting an empty dict — for
                            # set_notes, an empty dict would clear the user's
                            # notes with no error feedback.
                            logger.warning(
                                "shared_state_read_write: failed to parse "
                                "tool args for %s (id=%s): %s; raw=%r",
                                current_tool_name,
                                current_tool_id,
                                exc,
                                current_tool_args,
                            )
                            yield encoder.encode(
                                RunErrorEvent(
                                    type=EventType.RUN_ERROR,
                                    message=(
                                        f"Failed to parse arguments for tool "
                                        f"'{current_tool_name}': {exc}"
                                    ),
                                    code="TOOL_ARGS_PARSE_ERROR",
                                )
                            )
                            parsed_args = None

                        if parsed_args is not None:
                            tool_calls.append(
                                {
                                    "id": current_tool_id,
                                    "name": current_tool_name,
                                    "input": parsed_args,
                                }
                            )
                        # else: skip this tool call entirely rather than
                        # invoking it with an empty/dropped argument set.
                        current_tool_id = None
                        current_tool_name = None
                        current_tool_args = ""

        yield encoder.encode(
            TextMessageEndEvent(type=EventType.TEXT_MESSAGE_END, message_id=msg_id)
        )

        if not tool_calls:
            break

        # Append assistant turn to message history for the next iteration.
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

        # @region[shared-state-set-notes]
        # Execute set_notes by mutating shared state and emitting a
        # StateSnapshotEvent so the UI re-renders the agent-authored
        # notes. This is the agent-side half of the WRITE direction.
        tool_results: list[dict[str, Any]] = []
        for tc in tool_calls:
            if tc["name"] == "set_notes":
                notes = tc["input"].get("notes") or []
                if isinstance(notes, list):
                    state["notes"] = [str(n) for n in notes]
                result_text = json.dumps({"status": "ok", "count": len(state["notes"])})
                yield encoder.encode(
                    StateSnapshotEvent(type=EventType.STATE_SNAPSHOT, snapshot=state)
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
        # @endregion[shared-state-set-notes]

    yield encoder.encode(
        RunFinishedEvent(
            type=EventType.RUN_FINISHED, thread_id=thread_id, run_id=run_id
        )
    )
