"""Generic AG-UI runner for Claude Agent SDK demos.

Each cell's ``agent.py`` declares TOOLS / SYSTEM_PROMPT / AgentState / execute_tool
and optionally state_from_input / system_prompt_from_state, then calls
``make_runner(...)`` to get the ``run_agent`` coroutine mounted by agent_server.py.

The loop streams Claude responses as AG-UI events, executes tool calls on the
backend, and emits StateSnapshotEvent whenever a tool returns updated state.
"""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator
from typing import Any, Callable

import anthropic
from ag_ui.core import (
    EventType,
    RunAgentInput,
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
from pydantic import BaseModel


def _extract_messages(input_data: RunAgentInput) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for msg in input_data.messages or []:
        role = msg.role.value if hasattr(msg.role, "value") else str(msg.role)
        if role not in ("user", "assistant"):
            continue
        content = ""
        if hasattr(msg, "content"):
            if isinstance(msg.content, str):
                content = msg.content
            elif isinstance(msg.content, list):
                parts: list[str] = []
                for part in msg.content:
                    if hasattr(part, "text"):
                        parts.append(part.text)
                    elif isinstance(part, dict) and "text" in part:
                        parts.append(part["text"])
                content = "".join(parts)
        if content:
            out.append({"role": role, "content": content})
    return out


def make_runner(
    *,
    tools: list[dict[str, Any]],
    system_prompt: str,
    state_cls: type[BaseModel],
    execute_tool: Callable[[str, dict[str, Any], BaseModel], tuple[str, BaseModel | None]],
    system_prompt_for_state: Callable[[str, BaseModel], str] | None = None,
) -> Callable[[RunAgentInput], AsyncIterator[str]]:
    """Build a ``run_agent`` coroutine suitable for the FastAPI wrapper."""

    async def run_agent(input_data: RunAgentInput) -> AsyncIterator[str]:
        encoder = EventEncoder()
        client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))

        state: BaseModel
        if input_data.state and isinstance(input_data.state, dict):
            try:
                state = state_cls(**input_data.state)
            except Exception:
                state = state_cls()
        else:
            state = state_cls()

        messages = _extract_messages(input_data)

        system = system_prompt
        if system_prompt_for_state is not None:
            system = system_prompt_for_state(system_prompt, state)

        thread_id = input_data.thread_id or "default"
        run_id = input_data.run_id or "run-1"

        yield encoder.encode(
            RunStartedEvent(
                type=EventType.RUN_STARTED, thread_id=thread_id, run_id=run_id
            )
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
                model=os.getenv("ANTHROPIC_MODEL", "claude-opus-4-5"),
                max_tokens=4096,
                system=system,
                messages=messages,
                tools=tools,  # type: ignore[arg-type]
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
                    elif etype == "RawContentBlockStopEvent":
                        if current_tool_id and current_tool_name:
                            yield encoder.encode(
                                ToolCallEndEvent(
                                    type=EventType.TOOL_CALL_END,
                                    tool_call_id=current_tool_id,
                                )
                            )
                            try:
                                parsed_args = (
                                    json.loads(current_tool_args)
                                    if current_tool_args
                                    else {}
                                )
                            except json.JSONDecodeError:
                                parsed_args = {}
                            tool_calls.append(
                                {
                                    "id": current_tool_id,
                                    "name": current_tool_name,
                                    "input": parsed_args,
                                }
                            )
                            current_tool_id = None
                            current_tool_name = None
                            current_tool_args = ""

            yield encoder.encode(
                TextMessageEndEvent(
                    type=EventType.TEXT_MESSAGE_END, message_id=msg_id
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
                result_text, new_state = execute_tool(tc["name"], tc["input"], state)
                if new_state is not None:
                    state = new_state
                    if system_prompt_for_state is not None:
                        system = system_prompt_for_state(system_prompt, state)
                    yield encoder.encode(
                        StateSnapshotEvent(
                            type=EventType.STATE_SNAPSHOT,
                            snapshot=state.model_dump(),
                        )
                    )
                yield encoder.encode(
                    ToolCallResultEvent(
                        type=EventType.TOOL_CALL_RESULT,
                        tool_call_id=tc["id"],
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

    return run_agent
