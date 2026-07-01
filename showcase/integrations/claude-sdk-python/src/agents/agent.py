"""
Claude Agent SDK (Python) -- sales assistant with weather, HITL, and generative UI.

Implements the AG-UI protocol directly using the Anthropic Python SDK.
All demo routes share this single agent instance served by agent_server.py.
"""

from __future__ import annotations

import json
import os
import random
import traceback
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
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from agents.claude_agent_sdk_adapter import (
    run_with_claude_agent_sdk,
    should_use_claude_agent_sdk,
)


# Serve /health via middleware so it short-circuits BEFORE route resolution.
# Any later catch-all mount at "/" (whether added here or by a downstream
# adapter) would shadow a plain `@app.get("/health")` decorator. Middleware
# runs above routing so the health endpoint stays reachable regardless.
class HealthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.url.path == "/health" and request.method == "GET":
            return JSONResponse({"status": "ok"})
        return await call_next(request)


load_dotenv()

DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4.6"

# Import shared tool implementations (via tools symlink -> ../../shared/python/tools)
from tools import (
    get_weather_impl,
    query_data_impl,
    manage_sales_todos_impl,
    get_sales_todos_impl,
    schedule_meeting_impl,
    search_flights_impl,
    build_a2ui_operations_from_tool_call,
    RENDER_A2UI_TOOL_SCHEMA,
)
from tools.types import Flight

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
                                "enum": [
                                    "prospect",
                                    "qualified",
                                    "proposal",
                                    "negotiation",
                                    "closed-won",
                                    "closed-lost",
                                ],
                            },
                            "value": {"type": "number"},
                            "dueDate": {"type": "string"},
                            "assignee": {"type": "string"},
                            "completed": {"type": "boolean"},
                        },
                        "required": [
                            "title",
                            "stage",
                            "value",
                            "dueDate",
                            "assignee",
                            "completed",
                        ],
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

MANAGE_TODOS_TOOL_SCHEMA: dict[str, Any] = {
    "name": "manage_todos",
    "description": (
        "Replace the beautiful-chat task manager todo list. Always include every "
        "todo that should remain visible."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "todos": {
                "type": "array",
                "description": "The complete task-manager todo list.",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "title": {"type": "string"},
                        "description": {"type": "string"},
                        "emoji": {"type": "string"},
                        "status": {
                            "type": "string",
                            "enum": ["pending", "completed"],
                        },
                    },
                    "required": ["title", "description", "emoji", "status"],
                },
            },
        },
        "required": ["todos"],
    },
}

GET_TODOS_TOOL_SCHEMA: dict[str, Any] = {
    "name": "get_todos",
    "description": "Get the current beautiful-chat task manager todo list.",
    "input_schema": {
        "type": "object",
        "properties": {},
    },
}

BEAUTIFUL_CHAT_TOOLS = [
    *TOOLS,
    MANAGE_TODOS_TOOL_SCHEMA,
    GET_TODOS_TOOL_SCHEMA,
]

# @region[backend-demo-tool-sets]
# Dedicated demo tool sets. These demos register render-only frontend
# surfaces, so their executable tools must stay backend-owned.
HEADLESS_GET_WEATHER_TOOL_SCHEMA = TOOLS[0]

HEADLESS_GET_STOCK_PRICE_TOOL_SCHEMA: dict[str, Any] = {
    "name": "get_stock_price",
    "description": (
        "Get a mock current price for a stock ticker. Returns ticker, "
        "price_usd, and change_pct."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "ticker": {
                "type": "string",
                "description": "Stock ticker symbol, e.g. AAPL.",
            },
        },
        "required": ["ticker"],
    },
}

SEARCH_FLIGHTS_SIMPLE_TOOL_SCHEMA: dict[str, Any] = {
    "name": "search_flights",
    "description": (
        "Search for mock flights between two airports. Returns origin, "
        "destination, and a list of flights."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "origin": {"type": "string", "description": "Origin airport code."},
            "destination": {
                "type": "string",
                "description": "Destination airport code.",
            },
        },
        "required": ["origin", "destination"],
    },
}

ROLL_D20_TOOL_SCHEMA: dict[str, Any] = {
    "name": "roll_d20",
    "description": (
        "Roll a 20-sided die. Accepts an optional value for deterministic demos."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "value": {
                "type": "number",
                "description": "Optional fixed result.",
            },
        },
    },
}

SET_STEPS_TOOL_SCHEMA: dict[str, Any] = {
    "name": "set_steps",
    "description": (
        "Publish the current plan and step statuses. The provided list replaces "
        "the previous state."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "steps": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "title": {"type": "string"},
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
}

# @region[state-streaming-middleware]
WRITE_DOCUMENT_TOOL_SCHEMA: dict[str, Any] = {
    "name": "write_document",
    "description": (
        "Write a document into shared agent state. Use for poems, emails, "
        "summaries, explainers, and other drafted text."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "document": {
                "type": "string",
                "description": "The full document text to render in shared state.",
            },
        },
        "required": ["document"],
    },
}

SHARED_STATE_STREAMING_TOOLS = [WRITE_DOCUMENT_TOOL_SCHEMA]

SHARED_STATE_STREAMING_SYSTEM_PROMPT = dedent("""
    You are a collaborative writing assistant. Whenever the user asks you to
    write, draft, or revise text, call `write_document` with the full content
    in the `document` argument. Do not paste the document into the chat message
    directly; the UI renders shared state.
""").strip()


def _decode_partial_json_string(raw: str) -> str | None:
    """Decode the largest safe prefix of a streamed JSON string literal body."""
    while raw.endswith("\\"):
        raw = raw[:-1]
    unicode_start = raw.rfind("\\u")
    if unicode_start != -1:
        hex_digits = raw[unicode_start + 2 :]
        if len(hex_digits) < 4 or any(
            c not in "0123456789abcdefABCDEF" for c in hex_digits
        ):
            raw = raw[:unicode_start]
    try:
        return json.loads(f'"{raw}"')
    except json.JSONDecodeError:
        return None


def _partial_json_string_property(source: str, key: str) -> str | None:
    key_literal = json.dumps(key)
    key_pos = source.find(key_literal)
    if key_pos < 0:
        return None
    colon_pos = source.find(":", key_pos + len(key_literal))
    if colon_pos < 0:
        return None

    value_start = colon_pos + 1
    while value_start < len(source) and source[value_start].isspace():
        value_start += 1
    if value_start >= len(source) or source[value_start] != '"':
        return None

    raw_chars: list[str] = []
    escaped = False
    for char in source[value_start + 1 :]:
        if escaped:
            raw_chars.append("\\" + char)
            escaped = False
            continue
        if char == "\\":
            escaped = True
            continue
        if char == '"':
            break
        raw_chars.append(char)
    if escaped:
        raw_chars.append("\\")

    return _decode_partial_json_string("".join(raw_chars))


# @endregion[state-streaming-middleware]

HEADLESS_COMPLETE_TOOLS = [
    HEADLESS_GET_WEATHER_TOOL_SCHEMA,
    HEADLESS_GET_STOCK_PRICE_TOOL_SCHEMA,
]

TOOL_RENDERING_TOOLS = [
    HEADLESS_GET_WEATHER_TOOL_SCHEMA,
    HEADLESS_GET_STOCK_PRICE_TOOL_SCHEMA,
    SEARCH_FLIGHTS_SIMPLE_TOOL_SCHEMA,
    ROLL_D20_TOOL_SCHEMA,
]

GEN_UI_AGENT_TOOLS = [SET_STEPS_TOOL_SCHEMA]

HEADLESS_COMPLETE_SYSTEM_PROMPT = dedent("""
    You are a helpful, concise assistant wired into a headless chat surface.

    Routing rules:
    - If the user asks about weather, call `get_weather`.
    - If the user asks about a stock or ticker, call `get_stock_price`.
    - If the user asks you to highlight, flag, or mark a note, call the
      frontend `highlight_note` tool with text and a color.
    - Otherwise, reply in plain text.

    After a tool returns, write one short sentence summarizing the result.
    Never fabricate data a tool could provide.
""").strip()

TOOL_RENDERING_SYSTEM_PROMPT = dedent("""
    You are a helpful, concise assistant in a demo that renders every tool
    call as a branded card. Pick the right backend tool for each user question.

    Routing rules:
    - Weather questions: call `get_weather`.
    - Flight searches: call `search_flights` with origin and destination codes.
    - Stock/ticker questions: call `get_stock_price`.
    - A d20 roll: call `roll_d20`. If the user asks for several rolls, call it
      once per roll.
    - "Chain a few tools": call get_weather, search_flights, and roll_d20.

    After the tools return, write one short sentence summarizing the results.
    Never fabricate data a tool could provide.
""").strip()

GEN_UI_AGENT_SYSTEM_PROMPT = dedent("""
    You are an agentic planner. For each user request, follow this exact
    sequence:
    1. Plan exactly 3 concrete steps and call `set_steps` once with all three
       steps at status "pending".
    2. Move step 1 to "in_progress", then "completed", calling `set_steps`
       after each transition.
    3. Move step 2 to "in_progress", then "completed", calling `set_steps`
       after each transition.
    4. Move step 3 to "in_progress", then "completed", calling `set_steps`
       after each transition.
    5. Send one final conversational assistant message summarizing the plan.

    Never call set_steps in parallel. Always pass the full step list.
""").strip()

# @endregion[backend-demo-tool-sets]

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

BEAUTIFUL_CHAT_SYSTEM_PROMPT = dedent("""
    You are a helpful CopilotKit demo assistant. Use tools to render rich UI
    instead of describing UI in prose.

    Routing rules:
    - Charts: call `query_data` first when the user asks for financial data,
      then use the frontend chart tool requested by the user.
    - Flights: call `search_flights` with exactly two complete flight objects
      so the A2UI flight cards can render.
    - Dashboards: call `query_data`, then `generate_a2ui`.
    - Todos: call `enableAppMode` first, then `manage_todos` with the full
      todo list.
    - Meetings and theme changes are frontend tools; call the matching
      frontend tool when requested.

    After tools complete, summarize the result in one short sentence.
""").strip()


# ===========
# AG-UI runner
# ===========


class AgentState(BaseModel):
    todos: list[dict] = []
    steps: list[dict] = []
    document: str = ""


def _coerce_beautiful_chat_todos(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    todos: list[dict[str, Any]] = []
    for raw_todo in value:
        if not isinstance(raw_todo, dict):
            continue
        todos.append(
            {
                "id": str(raw_todo.get("id") or f"todo-{random.randint(1000, 9999)}"),
                "title": str(raw_todo.get("title") or ""),
                "description": str(raw_todo.get("description") or ""),
                "emoji": str(raw_todo.get("emoji") or "*"),
                "status": (
                    "completed" if raw_todo.get("status") == "completed" else "pending"
                ),
            }
        )
    return todos


def _get_stock_price_impl(ticker: str) -> dict[str, Any]:
    return {
        "ticker": ticker.upper(),
        "price_usd": 189.42,
        "change_pct": 1.27,
    }


def _search_flights_by_route_impl(origin: str, destination: str) -> dict[str, Any]:
    return {
        "origin": origin,
        "destination": destination,
        "flights": [
            {
                "airline": "United",
                "flight": "UA231",
                "depart": "08:15",
                "arrive": "16:45",
                "price_usd": 348,
            },
            {
                "airline": "Delta",
                "flight": "DL412",
                "depart": "11:20",
                "arrive": "19:50",
                "price_usd": 312,
            },
            {
                "airline": "JetBlue",
                "flight": "B6722",
                "depart": "17:05",
                "arrive": "01:35",
                "price_usd": 289,
            },
        ],
    }


# @region[backend-tool-execution]
def _execute_tool(
    name: str,
    tool_input: dict[str, Any],
    state: AgentState,
    conversation_messages: list[dict[str, Any]] | None = None,
) -> tuple[str, AgentState | None]:
    """Execute backend tools and return (result_text, new_state_or_None)."""
    # @region[weather-tool-backend]
    if name == "get_weather":
        return json.dumps(get_weather_impl(tool_input["location"])), None
    # @endregion[weather-tool-backend]

    if name == "query_data":
        return json.dumps(query_data_impl(tool_input["query"])), None

    if name == "manage_todos":
        state.todos = _coerce_beautiful_chat_todos(tool_input.get("todos"))
        return json.dumps({"status": "updated", "count": len(state.todos)}), state

    if name == "get_todos":
        return json.dumps(_coerce_beautiful_chat_todos(state.todos)), None

    if name == "manage_sales_todos":
        result = manage_sales_todos_impl(tool_input["todos"])
        state.todos = [dict(t) for t in result]
        return json.dumps({"status": "updated", "count": len(result)}), state

    if name == "get_sales_todos":
        return json.dumps(
            get_sales_todos_impl(state.todos if state.todos else None)
        ), None

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
        if "flights" in tool_input:
            flights_data = tool_input.get("flights", [])
            typed_flights = [Flight(**f) for f in flights_data]
            result = search_flights_impl(typed_flights)
            return json.dumps(result), None
        return json.dumps(
            _search_flights_by_route_impl(
                str(tool_input.get("origin", "")),
                str(tool_input.get("destination", "")),
            )
        ), None

    if name == "get_stock_price":
        return json.dumps(
            _get_stock_price_impl(str(tool_input.get("ticker", "")))
        ), None

    if name == "roll_d20":
        value = tool_input.get("value")
        return json.dumps(
            {
                "value": int(value)
                if isinstance(value, (int, float))
                else random.randint(1, 20)
            }
        ), None

    if name == "set_steps":
        steps = tool_input.get("steps", [])
        state.steps = [dict(step) for step in steps if isinstance(step, dict)]
        return json.dumps({"status": "updated", "count": len(state.steps)}), state

    if name == "write_document":
        document = str(tool_input.get("document", ""))
        state.document = document
        return json.dumps({"status": "updated", "length": len(document)}), state

    if name == "generate_a2ui":
        context = tool_input.get("context", "")
        client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))
        render_tool_schema = {
            "name": RENDER_A2UI_TOOL_SCHEMA["name"],
            "description": RENDER_A2UI_TOOL_SCHEMA["description"],
            "input_schema": RENDER_A2UI_TOOL_SCHEMA["parameters"],
        }
        llm_messages: list[dict[str, Any]] = []
        # Pass conversation messages to the secondary LLM for context
        if conversation_messages:
            llm_messages.extend(conversation_messages)
        else:
            llm_messages.append(
                {
                    "role": "user",
                    "content": "Generate a dynamic A2UI dashboard based on the conversation.",
                }
            )
        response = client.messages.create(
            model=os.getenv("ANTHROPIC_MODEL", DEFAULT_ANTHROPIC_MODEL),
            max_tokens=4096,
            system=context or "Generate a useful dashboard UI.",
            messages=llm_messages,
            tools=[render_tool_schema],
            tool_choice={"type": "tool", "name": "render_a2ui"},
        )
        for block in response.content:
            if (
                getattr(block, "type", None) == "tool_use"
                and block.name == "render_a2ui"
            ):
                a2ui_result = build_a2ui_operations_from_tool_call(dict(block.input))
                return json.dumps(a2ui_result), None
        return json.dumps({"error": "LLM did not call render_a2ui"}), None

    return f"Unknown tool: {name}", None


# @endregion[backend-tool-execution]


# @region[frontend-tools-setup]
def _build_frontend_tools(input_data: RunAgentInput) -> list[dict[str, Any]]:
    """Extract frontend-defined tools from the AG-UI request.

    The CopilotKit runtime forwards frontend tool definitions (registered
    via ``useFrontendTool``, ``useHumanInTheLoop``, etc.) in
    ``input_data.tools``. We convert them to the Anthropic ``tools``
    schema so the LLM can call them. The runtime intercepts the resulting
    tool-call events and routes them to the frontend for resolution.
    """
    out: list[dict[str, Any]] = []
    for t in input_data.tools or []:
        name = getattr(t, "name", None) or (
            t.get("name") if isinstance(t, dict) else None
        )
        description = getattr(t, "description", None) or (
            t.get("description", "") if isinstance(t, dict) else ""
        )
        parameters = getattr(t, "parameters", None) or (
            t.get("parameters", {}) if isinstance(t, dict) else {}
        )
        if not name:
            continue
        out.append(
            {
                "name": name,
                "description": description or "",
                "input_schema": parameters or {"type": "object", "properties": {}},
            }
        )
    return out


# @endregion[frontend-tools-setup]


async def run_agent(
    input_data: RunAgentInput,
    *,
    system_prompt_override: str | None = None,
    disable_tools: bool = False,
    preprocess_user_parts: Any = None,
    tools_override: list[dict[str, Any]] | None = None,
    frontend_tool_names_allowlist: set[str] | None = None,
    latest_user_message_only: bool = False,
) -> AsyncIterator[str]:
    """Run the Claude agent and yield AG-UI SSE events.

    Keyword arguments let dedicated demo endpoints reuse this streaming
    loop with targeted overrides:

    - ``system_prompt_override`` — replace the shared ``SYSTEM_PROMPT``
      (e.g. BYOC demos emit a JSON envelope, so the sales-assistant
      prompt is irrelevant).
    - ``disable_tools`` — run the model with no tool schemas. Useful for
      BYOC / pure-text demos where tool calls would derail the output.
    - ``preprocess_user_parts`` — a ``callable(part) -> part`` applied to
      each content part of every user message before they are sent to
      Claude. Used by the multimodal demo to convert AG-UI
      ``image``/``document`` parts into Claude's Messages API shape
      (``{"type": "image", "source": {...}}``) and to flatten PDFs to
      text via ``pypdf``.
    """
    encoder = EventEncoder()
    client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))

    # Extract state
    state = AgentState()
    if input_data.state and isinstance(input_data.state, dict):
        state = AgentState(**input_data.state)

    # Convert AG-UI messages to Anthropic format. When a preprocessor is
    # supplied we preserve the structured content list (image blocks,
    # document text, etc.) — otherwise we collapse to a flat string for
    # the text-only happy path used by most demos.
    #
    # AG-UI delivers three message roles:
    #   - "user"      → plain user text
    #   - "assistant" → assistant text + optional tool_use blocks
    #   - "tool"      → tool result from a resolved frontend tool
    #
    # Anthropic's Messages API represents tool results as a "user" role
    # message with content blocks of type "tool_result". We must convert
    # AG-UI "tool" messages into that shape so the LLM sees the resolved
    # result and aimock's ``hasToolResult`` matcher fires correctly.
    messages: list[dict[str, Any]] = []
    for msg in input_data.messages or []:
        role = msg.role.value if hasattr(msg.role, "value") else str(msg.role)

        # Handle tool result messages from AG-UI (resolved frontend tools).
        # Convert to Anthropic's format: role="user" with tool_result blocks.
        if role == "tool":
            tool_call_id = getattr(msg, "tool_call_id", None) or (
                getattr(msg, "toolCallId", None)
            )
            raw_content = getattr(msg, "content", None)
            result_text = ""
            if isinstance(raw_content, str):
                result_text = raw_content
            elif isinstance(raw_content, list):
                parts = []
                for part in raw_content:
                    if hasattr(part, "text"):
                        parts.append(part.text)
                    elif isinstance(part, dict) and "text" in part:
                        parts.append(part["text"])
                parts_text = "".join(parts)
                if parts_text:
                    result_text = parts_text
                else:
                    result_text = json.dumps(raw_content)
            if tool_call_id:
                # Anthropic expects the assistant message containing the
                # tool_use to precede this tool_result message. The runtime
                # ensures message ordering, so we just need to emit the
                # tool_result in the right shape.
                messages.append(
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "tool_result",
                                "tool_use_id": tool_call_id,
                                "content": result_text,
                            }
                        ],
                    }
                )
            continue

        if role not in ("user", "assistant"):
            continue

        raw_content = getattr(msg, "content", None)

        if (
            preprocess_user_parts is not None
            and role == "user"
            and isinstance(raw_content, list)
        ):
            converted_parts: list[Any] = []
            for part in raw_content:
                # AG-UI emits pydantic models; normalise to a plain dict
                # before handing to the converter so the demo-specific
                # code can rely on ``.get(...)`` semantics.
                if hasattr(part, "model_dump"):
                    part_dict = part.model_dump()
                elif isinstance(part, dict):
                    part_dict = part
                else:
                    part_dict = part
                converted = preprocess_user_parts(part_dict)
                if converted is not None:
                    converted_parts.append(converted)
            if converted_parts:
                messages.append({"role": role, "content": converted_parts})
            continue

        # For assistant messages, check if there are tool calls (AG-UI's
        # AssistantMessage stores them in `tool_calls`, not in `content`).
        # Anthropic requires tool_use blocks in the assistant content so
        # the subsequent tool_result can pair with them.
        if role == "assistant":
            msg_tool_calls = getattr(msg, "tool_calls", None)
            text_content = ""
            if isinstance(raw_content, str):
                text_content = raw_content
            elif isinstance(raw_content, list):
                for part in raw_content:
                    if hasattr(part, "text"):
                        text_content += part.text
                    elif isinstance(part, dict) and "text" in part:
                        text_content += part["text"]

            if msg_tool_calls:
                content_blocks: list[dict[str, Any]] = []
                if text_content:
                    content_blocks.append({"type": "text", "text": text_content})
                for tc in msg_tool_calls:
                    # AG-UI ToolCall: {id, function: {name, arguments}}
                    tc_id = getattr(tc, "id", None) or (
                        tc.get("id") if isinstance(tc, dict) else None
                    )
                    func = getattr(tc, "function", None) or (
                        tc.get("function") if isinstance(tc, dict) else None
                    )
                    if func:
                        tc_name = getattr(func, "name", None) or (
                            func.get("name") if isinstance(func, dict) else "unknown"
                        )
                        tc_args_str = getattr(func, "arguments", None) or (
                            func.get("arguments", "{}")
                            if isinstance(func, dict)
                            else "{}"
                        )
                    else:
                        tc_name = "unknown"
                        tc_args_str = "{}"
                    try:
                        tc_args = (
                            json.loads(tc_args_str)
                            if isinstance(tc_args_str, str)
                            else tc_args_str
                        )
                    except json.JSONDecodeError:
                        tc_args = {}
                    content_blocks.append(
                        {
                            "type": "tool_use",
                            "id": tc_id or "unknown",
                            "name": tc_name,
                            "input": tc_args,
                        }
                    )
                messages.append({"role": "assistant", "content": content_blocks})
                continue
            elif text_content:
                messages.append({"role": "assistant", "content": text_content})
                continue
            # Fall through to the generic handler if nothing matched

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

    if latest_user_message_only:
        latest_user_message = next(
            (m for m in reversed(messages) if m.get("role") == "user"),
            None,
        )
        messages = [latest_user_message] if latest_user_message else []

    # Inject sales pipeline state into system prompt if state exists
    if system_prompt_override is not None:
        system = system_prompt_override
    else:
        system = SYSTEM_PROMPT
        if state.todos:
            todos_json = json.dumps(state.todos, indent=2)
            system = f"{SYSTEM_PROMPT}\n\nCurrent sales pipeline:\n{todos_json}"

    # @region[agent-context-setup]
    context_entries = getattr(input_data, "context", None) or []
    if context_entries:
        context_lines: list[str] = []
        for entry in context_entries:
            if isinstance(entry, dict):
                description = entry.get("description")
                value = entry.get("value")
            else:
                description = getattr(entry, "description", None)
                value = getattr(entry, "value", None)
            if description:
                context_lines.append(f"{description}: {value}")
        if context_lines:
            system = f"{system}\n\nContext:\n" + "\n".join(context_lines)
    # @endregion[agent-context-setup]

    sdk_backend_tools = (
        []
        if disable_tools
        else (tools_override if tools_override is not None else TOOLS)
    )
    sdk_frontend_tools = [] if disable_tools else _build_frontend_tools(input_data)
    if frontend_tool_names_allowlist is not None:
        sdk_frontend_tools = [
            t for t in sdk_frontend_tools if t["name"] in frontend_tool_names_allowlist
        ]
    sdk_backend_tool_names = {t["name"] for t in sdk_backend_tools}
    sdk_frontend_only_tool_names = {
        t["name"] for t in sdk_frontend_tools if t["name"] not in sdk_backend_tool_names
    }
    if should_use_claude_agent_sdk(
        input_data=input_data,
        backend_tools=sdk_backend_tools,
        frontend_tool_names=sdk_frontend_only_tool_names,
        preprocess_user_parts=preprocess_user_parts,
    ):
        async for chunk in run_with_claude_agent_sdk(
            input_data,
            system_prompt=system,
            tools=sdk_backend_tools,
            state=state,
            model=os.getenv("ANTHROPIC_MODEL", DEFAULT_ANTHROPIC_MODEL),
            execute_tool=_execute_tool,
        ):
            yield chunk
        return

    thread_id = input_data.thread_id or "default"
    run_id = input_data.run_id or "run-1"

    yield encoder.encode(
        RunStartedEvent(type=EventType.RUN_STARTED, thread_id=thread_id, run_id=run_id)
    )

    # Agentic loop -- keep calling Claude until no more tool calls
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

        # Build the combined tools list: backend TOOLS + any frontend-
        # defined tools forwarded by the CopilotKit runtime in
        # input_data.tools. Frontend tools (registered via useFrontendTool,
        # useHumanInTheLoop, etc.) are included so the LLM can call them;
        # the runtime intercepts the resulting events and routes them to
        # the frontend for resolution. Backend tools are executed locally.
        backend_tools = tools_override if tools_override is not None else TOOLS
        backend_tool_names = {t["name"] for t in backend_tools}
        frontend_tools = _build_frontend_tools(input_data)
        if frontend_tool_names_allowlist is not None:
            frontend_tools = [
                t for t in frontend_tools if t["name"] in frontend_tool_names_allowlist
            ]
        # Merge: backend tools first, then frontend tools that don't
        # shadow a backend tool (frontend wins when names collide, because
        # the frontend registration means the runtime should intercept).
        frontend_tool_names = {t["name"] for t in frontend_tools}
        combined_tools: list[dict[str, Any]] = []
        for t in backend_tools:
            if t["name"] not in frontend_tool_names:
                combined_tools.append(t)
        combined_tools.extend(frontend_tools)

        stream_kwargs: dict[str, Any] = {
            "model": os.getenv("ANTHROPIC_MODEL", DEFAULT_ANTHROPIC_MODEL),
            "max_tokens": 4096,
            "system": system,
            "messages": messages,
        }
        if not disable_tools:
            stream_kwargs["tools"] = combined_tools  # type: ignore[assignment]

        try:
            async with client.messages.stream(**stream_kwargs) as stream:
                current_tool_id: str | None = None
                current_tool_name: str | None = None
                current_tool_args = ""
                last_streamed_document = state.document

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
                            if current_tool_name == "write_document":
                                streamed_document = _partial_json_string_property(
                                    current_tool_args,
                                    "document",
                                )
                                if (
                                    streamed_document is not None
                                    and streamed_document != last_streamed_document
                                ):
                                    state.document = streamed_document
                                    last_streamed_document = streamed_document
                                    yield encoder.encode(
                                        StateSnapshotEvent(
                                            type=EventType.STATE_SNAPSHOT,
                                            snapshot=state.model_dump(),
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
        except Exception:
            # Surface the error as visible text in the chat so D5
            # probes see a non-empty assistant response instead of a
            # silent broken SSE stream. Full traceback is logged
            # server-side by FastAPI's exception handler.
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

        # No tool calls -- we're done
        if not tool_calls:
            break

        # Separate tool calls into backend (locally executed) and frontend
        # (deferred to the CopilotKit runtime / frontend for resolution).
        # A tool whose name was registered on the frontend (present in
        # frontend_tool_names) is a frontend tool even if the backend also
        # defines it — the frontend registration takes precedence because
        # hooks like useHumanInTheLoop rely on intercepting the tool call.
        has_frontend_tool = any(tc["name"] in frontend_tool_names for tc in tool_calls)

        if has_frontend_tool:
            # At least one tool call targets a frontend tool. Break the
            # agentic loop: the CopilotKit runtime will intercept the
            # pending frontend tool call(s), route them to the frontend
            # for user interaction, and re-invoke the agent with the
            # resolved tool result(s) in a subsequent request.
            #
            # We do NOT emit ToolCallResultEvent for frontend tools and
            # we do NOT add them to the message history — the runtime
            # owns the continuation from here.
            break

        # All tool calls are backend-only — execute locally and continue
        # the agentic loop.
        # Add assistant turn with tool calls to message history
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

        # Execute tools and build tool-result turn
        tool_results: list[dict[str, Any]] = []
        for tc in tool_calls:
            result_text, new_state = _execute_tool(
                tc["name"], tc["input"], state, conversation_messages=messages
            )
            if new_state is not None:
                state = new_state
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


def create_app() -> FastAPI:
    """Create the FastAPI app with AG-UI endpoint."""
    # Local import to avoid a top-level ``agents._header_forwarding``
    # dependency in this module (kept agnostic so unit tests that import
    # individual handlers don't need the starlette middleware shape).
    from agents._header_forwarding import HeaderForwardingHTTPMiddleware

    app = FastAPI(title="Claude Agent SDK (Python) Agent Server")

    app.add_middleware(HealthMiddleware)

    # Capture inbound CopilotKit ``x-*`` headers (e.g. ``x-aimock-context``)
    # into a per-request ContextVar so any outbound LLM/provider httpx call
    # made inside the request scope copies them onto its outbound request.
    # Paired with ``install_global_httpx_hook`` at the top of agent_server.py.
    app.add_middleware(HeaderForwardingHTTPMiddleware)

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

    return app
