"""
Claude Agent SDK (Python) -- sales assistant with weather, HITL, and generative UI.

Implements the AG-UI protocol directly using the Anthropic Python SDK.
All demo routes share this single agent instance served by agent_server.py.
"""

from __future__ import annotations

import json
import os
import sys
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

# Import shared tool implementations
from .tools import (
    get_weather_impl,
    query_data_impl,
    manage_sales_todos_impl,
    get_sales_todos_impl,
    schedule_meeting_impl,
    search_flights_impl,
    build_a2ui_operations_from_tool_call,
    RENDER_A2UI_TOOL_SCHEMA,
)
from .tools.types import Flight

# ============
# Tool schemas
# ============

TOOLS: list[dict[str, Any]] = [
    {
        "name": "get_weather",
        "description": (
            "Get current weather for a location. "
            "Use this to render the frontend weather card."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "The city or region to get weather for.",
                },
            },
            "required": ["location"],
        },
    },
    {
        "name": "query_data",
        "description": (
            "Query the financial database for chart data. "
            "Always call before showing a chart or graph."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Natural language query for financial data.",
                },
            },
            "required": ["query"],
        },
    },
    {
        "name": "manage_sales_todos",
        "description": (
            "Replace the entire list of sales todos with the provided values. "
            "Always include every todo you want to keep."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "todos": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "title": {"type": "string"},
                            "stage": {
                                "type": "string",
                                "enum": ["prospect", "qualified", "proposal", "negotiation", "closed-won", "closed-lost"],
                            },
                            "value": {"type": "number"},
                            "dueDate": {"type": "string"},
                            "assignee": {"type": "string"},
                            "completed": {"type": "boolean"},
                        },
                        "required": ["title", "stage", "value", "dueDate", "assignee", "completed"],
                    },
                    "description": "The complete list of sales todos.",
                },
            },
            "required": ["todos"],
        },
    },
    {
        "name": "get_sales_todos",
        "description": "Get the current sales pipeline todos.",
        "input_schema": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "name": "schedule_meeting",
        "description": (
            "Schedule a meeting with the user. Requires human approval. "
            "Call this when the user wants to schedule or book a meeting."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "reason": {
                    "type": "string",
                    "description": "Reason for the meeting.",
                },
            },
            "required": ["reason"],
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
    {
        "name": "search_flights",
        "description": (
            "Search for flights and display the results as rich A2UI cards. "
            "Return exactly 2 flights. Each flight must have: airline, airlineLogo, "
            "flightNumber, origin, destination, date, departureTime, arrivalTime, "
            "duration, status, statusColor, price, currency. "
            "For airlineLogo use: https://www.google.com/s2/favicons?domain={airline_domain}&sz=128"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "flights": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "airline": {"type": "string"},
                            "airlineLogo": {"type": "string"},
                            "flightNumber": {"type": "string"},
                            "origin": {"type": "string"},
                            "destination": {"type": "string"},
                            "date": {"type": "string"},
                            "departureTime": {"type": "string"},
                            "arrivalTime": {"type": "string"},
                            "duration": {"type": "string"},
                            "status": {"type": "string"},
                            "statusColor": {"type": "string"},
                            "price": {"type": "string"},
                            "currency": {"type": "string"},
                        },
                    },
                    "description": "List of flight objects to display.",
                },
            },
            "required": ["flights"],
        },
    },
    {
        "name": "generate_a2ui",
        "description": (
            "Generate dynamic A2UI components based on the conversation. "
            "A secondary LLM designs the UI schema and data."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "context": {
                    "type": "string",
                    "description": "Conversation context to generate UI for.",
                },
            },
            "required": ["context"],
        },
    },
]

SYSTEM_PROMPT = dedent("""
    You are a helpful sales assistant that manages a sales pipeline, discusses weather,
    queries financial data, schedules meetings, and helps with planning.

    Sales pipeline management:
    - The current list of sales todos is provided in the conversation context.
    - When you add, remove, or update todos, call `manage_sales_todos` with the FULL list.
    - CRITICAL: When asked to "add" a todo, include ALL existing todos + the new one.
    - When asked to "remove" a todo, include everything EXCEPT the removed one.

    Tool usage:
    - `get_weather`: only call when the user explicitly asks about weather.
    - `query_data`: call when the user asks about financial data, charts, or graphs.
    - `manage_sales_todos`: call to update the sales pipeline.
    - `get_sales_todos`: call to retrieve current sales pipeline.
    - `schedule_meeting`: call when the user wants to schedule a meeting.
    - `generate_task_steps`: call when the user asks you to plan something step-by-step.
      Wait for approval/rejection before continuing with the plan.
    - `change_background`: only call when user explicitly asks to change the background.
    - `search_flights`: call when the user asks about flights. Generate 2 realistic flights.
    - `generate_a2ui`: call when the user asks for a dashboard or dynamic UI.

    After executing tools, provide a brief summary of what changed.
    Keep responses concise and friendly.
""").strip()

# ===========
# AG-UI runner
# ===========

class AgentState(BaseModel):
    todos: list[dict] = []

def _execute_tool(name: str, tool_input: dict[str, Any], state: AgentState, conversation_messages: list[dict[str, Any]] | None = None) -> tuple[str, AgentState | None]:
    """Execute backend tools and return (result_text, new_state_or_None)."""
    if name == "get_weather":
        return json.dumps(get_weather_impl(tool_input["location"])), None

    if name == "query_data":
        return json.dumps(query_data_impl(tool_input["query"])), None

    if name == "manage_sales_todos":
        result = manage_sales_todos_impl(tool_input["todos"])
        state.todos = [dict(t) for t in result]
        return json.dumps({"status": "updated", "count": len(result)}), state

    if name == "get_sales_todos":
        return json.dumps(get_sales_todos_impl(state.todos if state.todos else None)), None

    if name == "schedule_meeting":
        return json.dumps(schedule_meeting_impl(tool_input["reason"])), None

    if name == "generate_task_steps":
        # Frontend HITL tool -- backend just acknowledges; UI handles the interaction
        steps = tool_input.get("steps", [])
        return f"Presented {len(steps)} steps for review.", None

    if name == "change_background":
        # Frontend tool -- backend just acknowledges
        return f"Background change requested: {tool_input.get('background', '')}", None

    if name == "search_flights":
        flights_data = tool_input.get("flights", [])
        typed_flights = [Flight(**f) for f in flights_data]
        result = search_flights_impl(typed_flights)
        return json.dumps(result), None

    if name == "generate_a2ui":
        context = tool_input.get("context", "")
        import openai
        client = openai.OpenAI()
        llm_messages: list[dict[str, Any]] = [
            {"role": "system", "content": context or "Generate a useful dashboard UI."},
        ]
        # Pass conversation messages to the secondary LLM for context
        if conversation_messages:
            llm_messages.extend(conversation_messages)
        else:
            llm_messages.append({"role": "user", "content": "Generate a dynamic A2UI dashboard based on the conversation."})
        response = client.chat.completions.create(
            model="gpt-4.1",
            messages=llm_messages,
            tools=[{"type": "function", "function": RENDER_A2UI_TOOL_SCHEMA}],
            tool_choice={"type": "function", "function": {"name": "render_a2ui"}},
        )
        choice = response.choices[0]
        if choice.message.tool_calls:
            args = json.loads(choice.message.tool_calls[0].function.arguments)
            a2ui_result = build_a2ui_operations_from_tool_call(args)
            return json.dumps(a2ui_result), None
        return json.dumps({"error": "LLM did not call render_a2ui"}), None

    return f"Unknown tool: {name}", None

async def run_agent(input_data: RunAgentInput) -> AsyncIterator[str]:
    """Run the Claude agent and yield AG-UI SSE events."""
    encoder = EventEncoder()
    client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))

    # Extract state
    state = AgentState()
    if input_data.state and isinstance(input_data.state, dict):
        state = AgentState(**input_data.state)

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

    # Inject sales pipeline state into system prompt if state exists
    system = SYSTEM_PROMPT
    if state.todos:
        todos_json = json.dumps(state.todos, indent=2)
        system = f"{SYSTEM_PROMPT}\n\nCurrent sales pipeline:\n{todos_json}"

    thread_id = input_data.thread_id or "default"
    run_id = input_data.run_id or "run-1"

    yield encoder.encode(RunStartedEvent(type=EventType.RUN_STARTED, thread_id=thread_id, run_id=run_id))

    # Agentic loop -- keep calling Claude until no more tool calls
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

        # No tool calls -- we're done
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
            result_text, new_state = _execute_tool(tc["name"], tc["input"], state, conversation_messages=messages)
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
