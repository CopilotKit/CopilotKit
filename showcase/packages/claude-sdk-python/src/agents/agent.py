"""
Claude Agent SDK (Python) — proverbs agent with weather, HITL, and generative UI.

Implements the AG-UI protocol directly using the Anthropic Python SDK.
All demo routes share this single agent instance served by agent_server.py.
"""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator
from textwrap import dedent
from typing import Any

import anthropic
from ag_ui.core import (
    EventType,
    Message,
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
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

load_dotenv()

# ============
# Tool schemas
# ============

TOOLS: list[dict[str, Any]] = [
    {
        "name": "update_proverbs",
        "description": (
            "Replace the entire list of proverbs with the provided values. "
            "Always include every proverb you want to keep."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "proverbs": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "The complete list of proverbs. "
                        "Maintain ordering and include the full list on each call."
                    ),
                }
            },
            "required": ["proverbs"],
        },
    },
    {
        "name": "get_weather",
        "description": (
            "Share a quick weather update for a location. "
            "Use this to render the frontend weather card."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "The city or region to describe. Use fully spelled out names.",
                },
                "temperature": {
                    "type": "number",
                    "description": "Temperature in Celsius.",
                },
                "conditions": {
                    "type": "string",
                    "description": "Weather conditions (e.g. 'Clear skies', 'Partly cloudy').",
                },
                "humidity": {
                    "type": "number",
                    "description": "Relative humidity percentage.",
                },
                "wind_speed": {
                    "type": "number",
                    "description": "Wind speed in mph.",
                },
                "feels_like": {
                    "type": "number",
                    "description": "Feels-like temperature in Celsius.",
                },
            },
            "required": ["location"],
        },
    },
    {
        "name": "generate_task_steps",
        "description": (
            "Propose a list of steps for the user to review and approve. "
            "Used for human-in-the-loop task planning. "
            "Always call this tool when the user asks you to plan something."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "steps": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "description": {"type": "string"},
                            "status": {
                                "type": "string",
                                "enum": ["enabled", "disabled", "executing"],
                            },
                        },
                        "required": ["description", "status"],
                    },
                    "description": "The ordered list of steps for the user to review.",
                }
            },
            "required": ["steps"],
        },
    },
    {
        "name": "generate_haiku",
        "description": (
            "Generate a haiku card displayed in the UI. "
            "Call this tool whenever the user asks for a haiku."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "japanese": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "3 lines of haiku in Japanese.",
                },
                "english": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "3 lines of haiku translated to English.",
                },
                "image_name": {
                    "type": "string",
                    "description": (
                        "One relevant image name from: "
                        "Osaka_Castle_Turret_Stone_Wall_Pine_Trees_Daytime.jpg, "
                        "Tokyo_Skyline_Night_Tokyo_Tower_Mount_Fuji_View.jpg, "
                        "Itsukushima_Shrine_Miyajima_Floating_Torii_Gate_Sunset_Long_Exposure.jpg, "
                        "Takachiho_Gorge_Waterfall_River_Lush_Greenery_Japan.jpg, "
                        "Bonsai_Tree_Potted_Japanese_Art_Green_Foliage.jpeg, "
                        "Shirakawa-go_Gassho-zukuri_Thatched_Roof_Village_Aerial_View.jpg, "
                        "Ginkaku-ji_Silver_Pavilion_Kyoto_Japanese_Garden_Pond_Reflection.jpg, "
                        "Senso-ji_Temple_Asakusa_Cherry_Blossoms_Kimono_Umbrella.jpg, "
                        "Cherry_Blossoms_Sakura_Night_View_City_Lights_Japan.jpg, "
                        "Mount_Fuji_Lake_Reflection_Cherry_Blossoms_Sakura_Spring.jpg"
                    ),
                },
                "gradient": {
                    "type": "string",
                    "description": "CSS gradient for the haiku card background.",
                },
            },
            "required": ["japanese", "english"],
        },
    },
    {
        "name": "change_background",
        "description": (
            "Change the background color or gradient of the chat UI. "
            "ONLY call this when the user explicitly asks to change the background."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "background": {
                    "type": "string",
                    "description": "CSS background value. Prefer gradients.",
                }
            },
            "required": ["background"],
        },
    },
]

SYSTEM_PROMPT = dedent("""
    You are a helpful assistant that manages proverbs, discusses weather, and helps with planning.

    Proverb management:
    - The current list of proverbs is provided in the conversation context.
    - When you add, remove, or reorder proverbs, call `update_proverbs` with the FULL list.
    - CRITICAL: When asked to "add" a proverb, include ALL existing proverbs + the new one.
    - When asked to "remove" a proverb, include everything EXCEPT the removed one.

    Tool usage:
    - `get_weather`: only call when the user explicitly asks about weather.
    - `generate_task_steps`: call when the user asks you to plan something step-by-step.
      Wait for approval/rejection before continuing with the plan.
    - `generate_haiku`: call whenever the user asks for a haiku.
    - `change_background`: only call when user explicitly asks to change the background.

    After executing tools, provide a brief summary of what changed.
    Keep responses concise and friendly.
""").strip()


# ===========
# AG-UI runner
# ===========

class ProverbsState(BaseModel):
    proverbs: list[str] = []


def _execute_tool(name: str, tool_input: dict[str, Any], state: ProverbsState) -> tuple[str, ProverbsState | None]:
    """Execute backend tools and return (result_text, new_state_or_None)."""
    if name == "update_proverbs":
        proverbs = tool_input.get("proverbs", [])
        state.proverbs = proverbs
        return f"Proverbs updated. Tracking {len(proverbs)} item(s).", state

    if name == "get_weather":
        location = tool_input.get("location", "unknown")
        temp = tool_input.get("temperature", 22)
        conditions = tool_input.get("conditions", "Clear skies")
        humidity = tool_input.get("humidity", 55)
        wind = tool_input.get("wind_speed", 10)
        feels = tool_input.get("feels_like", temp)
        result = {
            "city": location,
            "temperature": temp,
            "conditions": conditions,
            "humidity": humidity,
            "wind_speed": wind,
            "feels_like": feels,
        }
        return json.dumps(result), None

    if name == "generate_task_steps":
        # Frontend HITL tool — backend just acknowledges; UI handles the interaction
        steps = tool_input.get("steps", [])
        return f"Presented {len(steps)} steps for review.", None

    if name == "generate_haiku":
        # Frontend gen-UI tool — backend just acknowledges
        return "Haiku generated!", None

    if name == "change_background":
        # Frontend tool — backend just acknowledges
        return f"Background change requested: {tool_input.get('background', '')}", None

    return f"Unknown tool: {name}", None


async def run_agent(input_data: RunAgentInput) -> AsyncIterator[str]:
    """Run the Claude agent and yield AG-UI SSE events."""
    encoder = EventEncoder()
    client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))

    # Extract state
    state = ProverbsState()
    if input_data.state and isinstance(input_data.state, dict):
        state = ProverbsState(**input_data.state)

    # Convert AG-UI messages to Anthropic format
    messages: list[dict[str, Any]] = []
    for msg in (input_data.messages or []):
        role = msg.role.value if hasattr(msg.role, "value") else str(msg.role)
        if role in ("user", "assistant"):
            content = ""
            if hasattr(msg, "content"):
                if isinstance(msg.content, str):
                    content = msg.content
                elif isinstance(msg.content, list):
                    parts = []
                    for part in msg.content:
                        if hasattr(part, "text"):
                            parts.append(part.text)
                        elif isinstance(part, dict) and "text" in part:
                            parts.append(part["text"])
                    content = "".join(parts)
            if content:
                messages.append({"role": role, "content": content})

    # Inject proverbs state into system prompt if state exists
    system = SYSTEM_PROMPT
    if state.proverbs:
        proverbs_json = json.dumps(state.proverbs, indent=2)
        system = f"{SYSTEM_PROMPT}\n\nCurrent proverbs list:\n{proverbs_json}"

    thread_id = input_data.thread_id or "default"
    run_id = input_data.run_id or "run-1"

    yield encoder.encode(RunStartedEvent(type=EventType.RUN_STARTED, thread_id=thread_id, run_id=run_id))

    # Agentic loop — keep calling Claude until no more tool calls
    while True:
        response_text = ""
        tool_calls: list[dict[str, Any]] = []
        msg_id = f"msg-{run_id}-{len(messages)}"

        yield encoder.encode(TextMessageStartEvent(
            type=EventType.TEXT_MESSAGE_START,
            message_id=msg_id,
            role="assistant",
        ))

        # Stream Claude response
        async with client.messages.stream(
            model=os.getenv("ANTHROPIC_MODEL", "claude-opus-4-5"),
            max_tokens=4096,
            system=system,
            messages=messages,
            tools=TOOLS,  # type: ignore[arg-type]
        ) as stream:
            current_tool_id: str | None = None
            current_tool_name: str | None = None
            current_tool_args = ""

            async for event in stream:
                etype = type(event).__name__

                if etype == "RawContentBlockStartEvent":
                    block = event.content_block  # type: ignore[attr-defined]
                    if block.type == "text":
                        pass  # streaming text chunks follow
                    elif block.type == "tool_use":
                        current_tool_id = block.id
                        current_tool_name = block.name
                        current_tool_args = ""
                        yield encoder.encode(ToolCallStartEvent(
                            type=EventType.TOOL_CALL_START,
                            tool_call_id=current_tool_id,
                            tool_call_name=current_tool_name,
                            parent_message_id=msg_id,
                        ))

                elif etype == "RawContentBlockDeltaEvent":
                    delta = event.delta  # type: ignore[attr-defined]
                    if delta.type == "text_delta":
                        response_text += delta.text
                        yield encoder.encode(TextMessageContentEvent(
                            type=EventType.TEXT_MESSAGE_CONTENT,
                            message_id=msg_id,
                            delta=delta.text,
                        ))
                    elif delta.type == "input_json_delta":
                        current_tool_args += delta.partial_json
                        yield encoder.encode(ToolCallArgsEvent(
                            type=EventType.TOOL_CALL_ARGS,
                            tool_call_id=current_tool_id or "",
                            delta=delta.partial_json,
                        ))

                elif etype == "RawContentBlockStopEvent":
                    if current_tool_id and current_tool_name:
                        yield encoder.encode(ToolCallEndEvent(
                            type=EventType.TOOL_CALL_END,
                            tool_call_id=current_tool_id,
                        ))
                        try:
                            parsed_args = json.loads(current_tool_args) if current_tool_args else {}
                        except json.JSONDecodeError:
                            parsed_args = {}
                        tool_calls.append({
                            "id": current_tool_id,
                            "name": current_tool_name,
                            "input": parsed_args,
                        })
                        current_tool_id = None
                        current_tool_name = None
                        current_tool_args = ""

        yield encoder.encode(TextMessageEndEvent(
            type=EventType.TEXT_MESSAGE_END,
            message_id=msg_id,
        ))

        # No tool calls — we're done
        if not tool_calls:
            break

        # Add assistant turn with tool calls to message history
        assistant_content: list[dict[str, Any]] = []
        if response_text:
            assistant_content.append({"type": "text", "text": response_text})
        for tc in tool_calls:
            assistant_content.append({
                "type": "tool_use",
                "id": tc["id"],
                "name": tc["name"],
                "input": tc["input"],
            })
        messages.append({"role": "assistant", "content": assistant_content})

        # Execute tools and build tool-result turn
        tool_results: list[dict[str, Any]] = []
        for tc in tool_calls:
            result_text, new_state = _execute_tool(tc["name"], tc["input"], state)
            if new_state is not None:
                state = new_state
                yield encoder.encode(StateSnapshotEvent(
                    type=EventType.STATE_SNAPSHOT,
                    snapshot=state.model_dump(),
                ))
            yield encoder.encode(ToolCallResultEvent(
                type=EventType.TOOL_CALL_RESULT,
                tool_call_id=tc["id"],
                content=result_text,
            ))
            tool_results.append({
                "type": "tool_result",
                "tool_use_id": tc["id"],
                "content": result_text,
            })
        messages.append({"role": "user", "content": tool_results})

    yield encoder.encode(RunFinishedEvent(type=EventType.RUN_FINISHED, thread_id=thread_id, run_id=run_id))


def create_app() -> FastAPI:
    """Create the FastAPI app with AG-UI endpoint."""
    app = FastAPI(title="Claude Agent SDK (Python) Agent Server")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.post("/")
    async def run_agent_endpoint(request: Request) -> StreamingResponse:
        body = await request.json()
        input_data = RunAgentInput(**body)

        async def event_stream() -> AsyncIterator[str]:
            async for chunk in run_agent(input_data):
                yield chunk

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app
