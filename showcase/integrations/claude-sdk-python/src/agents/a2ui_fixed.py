"""Claude Agent SDK backend for the A2UI Fixed Schema demo.

The component tree (schema) is authored ahead of time as JSON and shipped
with the backend. The agent only streams *data* into the data model at
runtime via the `display_flight` tool, which emits an `a2ui_operations`
container the runtime A2UI middleware detects in tool results and forwards
to the frontend renderer.

Mirrors the langgraph-python and ag2 references. The dedicated runtime
route at `api/copilotkit-a2ui-fixed-schema/route.ts` runs with
`injectA2UITool: false` because the backend owns the rendering tool.
"""

from __future__ import annotations

import json
import os
import traceback
from collections.abc import AsyncIterator
from pathlib import Path
from textwrap import dedent
from typing import Any

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


CATALOG_ID = "copilotkit://flight-fixed-catalog"
SURFACE_ID = "flight-fixed-schema"

_SCHEMAS_DIR = Path(__file__).parent / "a2ui_schemas"


def _load_schema(filename: str) -> list[dict]:
    with open(_SCHEMAS_DIR / filename, "r", encoding="utf-8") as fh:
        return json.load(fh)


FLIGHT_SCHEMA = _load_schema("flight_schema.json")


SYSTEM_PROMPT = dedent("""
    You help users find flights. When asked about a flight, call
    `display_flight` with origin (3-letter code), destination (3-letter
    code), airline, and price (e.g. '$289'). Keep any chat reply to one
    short sentence.
""").strip()


DISPLAY_FLIGHT_TOOL = {
    "name": "display_flight",
    "description": (
        "Show a flight card for the given trip. Emits an a2ui_operations "
        "container the runtime A2UI middleware detects and forwards to the "
        "frontend renderer."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "origin": {
                "type": "string",
                "description": "Origin airport code, e.g. 'SFO'",
            },
            "destination": {
                "type": "string",
                "description": "Destination airport code, e.g. 'JFK'",
            },
            "airline": {"type": "string", "description": "Airline name, e.g. 'United'"},
            "price": {"type": "string", "description": "Price string, e.g. '$289'"},
        },
        "required": ["origin", "destination", "airline", "price"],
    },
}


def _display_flight_operations(
    origin: str, destination: str, airline: str, price: str
) -> dict[str, Any]:
    return {
        "a2ui_operations": [
            {
                "type": "create_surface",
                "surfaceId": SURFACE_ID,
                "catalogId": CATALOG_ID,
            },
            {
                "type": "update_components",
                "surfaceId": SURFACE_ID,
                "components": FLIGHT_SCHEMA,
            },
            {
                "type": "update_data_model",
                "surfaceId": SURFACE_ID,
                "data": {
                    "origin": origin,
                    "destination": destination,
                    "airline": airline,
                    "price": price,
                },
            },
        ]
    }


async def run_a2ui_fixed_agent(input_data: RunAgentInput) -> AsyncIterator[str]:
    """Stream a Claude conversation that may call `display_flight`."""
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

    while True:
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
                model=os.getenv("ANTHROPIC_MODEL", "claude-opus-4-5"),
                max_tokens=2048,
                system=SYSTEM_PROMPT,
                messages=messages,
                tools=[DISPLAY_FLIGHT_TOOL],
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
            if tc["name"] == "display_flight":
                args = tc["input"]
                result_obj = _display_flight_operations(
                    origin=args.get("origin", ""),
                    destination=args.get("destination", ""),
                    airline=args.get("airline", ""),
                    price=args.get("price", ""),
                )
                result_text = json.dumps(result_obj)
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
