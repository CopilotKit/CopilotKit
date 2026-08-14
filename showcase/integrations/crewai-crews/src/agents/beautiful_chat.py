"""CrewAI Flow backing the Beautiful Chat flagship demo.

Mirrors `langgraph-python/src/agents/beautiful_chat.py` observable
contract for `search_flights`: emit A2UI v0.9 ops with literal
FlightCard children (United / Delta, $349 / $289).

`ChatWithCrewFlow` runs tools inside the crew and does not emit
TOOL_CALL_*, so the runtime A2UI middleware never sees
`a2ui_operations`. This module uses the same raw `Flow` loop as
`tool_rendering.py`.

MCP Apps are still omitted (NSF on this slug). Shared-state todos stay
a JSON tool result — CrewAI has no LangGraph `Command` state patch.
"""

from __future__ import annotations

import json
import uuid
from typing import Type

from crewai.flow.flow import Flow, start
from crewai.tools import BaseTool
from litellm import acompletion
from pydantic import BaseModel, Field

from ag_ui_crewai import CopilotKitState, copilotkit_stream
from agents.tools.custom_tool import (
    GenerateA2uiTool,
    GetWeatherTool,
    QueryDataTool,
    ScheduleMeetingTool,
    render_search_flights_a2ui,
)


class ManageTodosInput(BaseModel):
    todos: list[dict] = Field(
        ...,
        description=(
            "Full list of todo objects to replace the current app state. "
            "Each todo must have id, title, description, emoji, and status "
            '(one of "pending" | "completed").'
        ),
    )


class ManageTodosTool(BaseTool):
    """Surface that the shared-state 'todos' app reads from."""

    name: str = "manage_todos"
    description: str = (
        "Manage the current todos. Pass the FULL list of todos; the "
        "previous list is replaced. Each todo needs id, title, "
        "description, emoji, and status."
    )
    args_schema: Type[BaseModel] = ManageTodosInput

    def _run(self, todos: list[dict]) -> str:
        import uuid as _uuid

        for todo in todos:
            if not todo.get("id"):
                todo["id"] = str(_uuid.uuid4())
        return json.dumps({"todos": todos})


SEARCH_FLIGHTS_TOOL = {
    "type": "function",
    "function": {
        "name": "search_flights",
        "description": (
            "Search for flights and display the results as rich cards. "
            "Return exactly 2 flights. Each flight must have: airline "
            '(e.g. "United Airlines"), airlineLogo (Google favicon API), '
            "flightNumber, origin, destination, date (short readable "
            'format like "Tue, Mar 18"), departureTime, arrivalTime, '
            'duration (e.g. "4h 25m"), status (e.g. "On Time"), and '
            'price (e.g. "$289").'
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "flights": {
                    "type": "array",
                    "description": "Exactly 2 flight objects to display.",
                    "items": {"type": "object"},
                }
            },
            "required": ["flights"],
        },
    },
}

GET_WEATHER_TOOL = {
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": (
            "Get current weather for a location. Ensure location is fully spelled out."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "The location to get weather for.",
                }
            },
            "required": ["location"],
        },
    },
}

QUERY_DATA_TOOL = {
    "type": "function",
    "function": {
        "name": "query_data",
        "description": (
            "Query financial database for chart data. Returns data "
            "suitable for pie or bar charts."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The query to run against the financial database.",
                }
            },
            "required": ["query"],
        },
    },
}

SCHEDULE_MEETING_TOOL = {
    "type": "function",
    "function": {
        "name": "schedule_meeting",
        "description": (
            "Schedule a meeting with user approval. Returns available time slots."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "reason": {
                    "type": "string",
                    "description": "Reason for scheduling the meeting.",
                },
                "duration_minutes": {
                    "type": "integer",
                    "description": "Duration of the meeting in minutes.",
                },
            },
            "required": ["reason"],
        },
    },
}

GENERATE_A2UI_TOOL = {
    "type": "function",
    "function": {
        "name": "generate_a2ui",
        "description": (
            "Generate dynamic A2UI components based on the conversation. "
            "A secondary LLM designs the UI schema and data."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "context": {
                    "type": "string",
                    "description": "Conversation context to generate UI for.",
                }
            },
            "required": ["context"],
        },
    },
}

MANAGE_TODOS_TOOL = {
    "type": "function",
    "function": {
        "name": "manage_todos",
        "description": (
            "Manage the current todos. Pass the FULL list of todos; the "
            "previous list is replaced."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "todos": {
                    "type": "array",
                    "description": "Full list of todo objects.",
                    "items": {"type": "object"},
                }
            },
            "required": ["todos"],
        },
    },
}

_BACKEND_TOOL_SCHEMAS = [
    SEARCH_FLIGHTS_TOOL,
    GET_WEATHER_TOOL,
    QUERY_DATA_TOOL,
    SCHEDULE_MEETING_TOOL,
    GENERATE_A2UI_TOOL,
    MANAGE_TODOS_TOOL,
]

_get_weather = GetWeatherTool()
_query_data = QueryDataTool()
_schedule_meeting = ScheduleMeetingTool()
_generate_a2ui = GenerateA2uiTool()
_manage_todos = ManageTodosTool()


def _run_backend_tool(tool_name: str, args: dict) -> str:
    if tool_name == "search_flights":
        return render_search_flights_a2ui(args.get("flights") or [])
    if tool_name == "get_weather":
        return _get_weather._run(args.get("location", "Unknown"))
    if tool_name == "query_data":
        return _query_data._run(args.get("query", ""))
    if tool_name == "schedule_meeting":
        return _schedule_meeting._run(
            args.get("reason", ""),
            args.get("duration_minutes", 30),
        )
    if tool_name == "generate_a2ui":
        return _generate_a2ui._run(args.get("context", ""))
    if tool_name == "manage_todos":
        return _manage_todos._run(args.get("todos") or [])
    return json.dumps({"error": f"unknown tool {tool_name}"})


_BACKEND_TOOL_NAMES = {
    "search_flights",
    "get_weather",
    "query_data",
    "schedule_meeting",
    "generate_a2ui",
    "manage_todos",
}

_SYSTEM_PROMPT = (
    "You are a polished, professional demo assistant. Keep responses to "
    "1-2 sentences.\n"
    "Tool guidance:\n"
    "- Flights: call search_flights to show flight cards with a "
    "pre-built schema.\n"
    "- Dashboards & rich UI: call generate_a2ui to create dashboard "
    "UIs with metrics, charts, tables, and cards.\n"
    "- Charts: call query_data first, then render with the chart "
    "component.\n"
    "- Todos: call manage_todos with the new full todos list when the "
    "user asks to add, complete, or remove todos.\n"
    "- Meetings: call schedule_meeting when the user wants to book time.\n"
    "- Weather: call get_weather when asked about the weather."
)

_MAX_ITERATIONS = 5


class BeautifulChatState(CopilotKitState):
    """Conversation-only state. Todos travel as a tool result."""

    pass


class BeautifulChatFlow(Flow[BeautifulChatState]):
    """Chat flow that emits search_flights TOOL_CALL_* + A2UI cards."""

    @start()
    async def chat(self) -> None:
        system_message = {
            "role": "system",
            "content": _SYSTEM_PROMPT,
            "id": str(uuid.uuid4()) + "-system",
        }

        tools = [
            *self.state.copilotkit.actions,
            *_BACKEND_TOOL_SCHEMAS,
        ]

        for _iteration in range(_MAX_ITERATIONS):
            messages = [system_message, *self.state.messages]

            response = await copilotkit_stream(
                await acompletion(
                    model="openai/gpt-4o-mini",
                    messages=messages,
                    tools=tools,
                    parallel_tool_calls=False,
                    stream=True,
                )
            )

            message = response.choices[0].message
            self.state.messages.append(message)

            tool_calls = message.get("tool_calls") or []
            if not tool_calls:
                return

            for tool_call in tool_calls:
                tool_call_id = tool_call["id"]
                tool_name = tool_call["function"]["name"]

                if tool_name not in _BACKEND_TOOL_NAMES:
                    # Frontend action (barChart / pieChart / scheduleTime /
                    # toggleTheme). End the run so CopilotKit owns HITL
                    # and client-side renderers. Do not invent a result.
                    return

                try:
                    args = json.loads(tool_call["function"]["arguments"] or "{}")
                except json.JSONDecodeError:
                    args = {}
                result_str = _run_backend_tool(tool_name, args)
                self.state.messages.append(
                    {
                        "role": "tool",
                        "content": result_str,
                        "tool_call_id": tool_call_id,
                    }
                )


# Module-level singleton -- deepcopied per request by the endpoint.
beautiful_chat_flow = BeautifulChatFlow()
