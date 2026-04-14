"""
AG2 agent with weather and sales tools for CopilotKit showcase.

Uses AG2's ConversableAgent with AGUIStream to expose
the agent via the AG-UI protocol.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Annotated, Any

from autogen import ConversableAgent, LLMConfig
from autogen.ag_ui import AGUIStream
from dotenv import load_dotenv

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

# =====
# Tools
# =====
async def get_weather(
    location: Annotated[str, "City name to get weather for"],
) -> dict[str, str | float]:
    """Get current weather for a location."""
    result = get_weather_impl(location)
    return {
        "city": result["city"],
        "temperature": result["temperature"],
        "feels_like": result["feels_like"],
        "humidity": result["humidity"],
        "wind_speed": result["wind_speed"],
        "conditions": result["conditions"],
    }

async def query_data(
    query: Annotated[str, "Natural language query for financial data"],
) -> list:
    """Query financial database for chart data."""
    return query_data_impl(query)

async def manage_sales_todos(
    todos: Annotated[list, "Complete list of sales todos"],
) -> dict:
    """Manage the sales pipeline."""
    return {"todos": manage_sales_todos_impl(todos)}

async def get_sales_todos() -> list:
    """Get the current sales pipeline."""
    return get_sales_todos_impl(None)

async def schedule_meeting(
    reason: Annotated[str, "Reason for the meeting"],
) -> dict:
    """Schedule a meeting with user approval."""
    return schedule_meeting_impl(reason)

async def search_flights(
    flights: Annotated[list[dict[str, Any]], "List of flight objects to display as rich A2UI cards"],
) -> str:
    """Search for flights and display the results as rich cards. Return exactly 2 flights.

    Each flight must have: airline, airlineLogo, flightNumber, origin, destination,
    date (short readable format like "Tue, Mar 18" -- use near-future dates),
    departureTime, arrivalTime, duration (e.g. "4h 25m"),
    status (e.g. "On Time" or "Delayed"),
    statusColor (hex color for status dot),
    price (e.g. "$289"), and currency (e.g. "USD").

    For airlineLogo use Google favicon API:
    https://www.google.com/s2/favicons?domain={airline_domain}&sz=128
    """
    typed_flights: list[Flight] = [Flight(**f) for f in flights]
    result = search_flights_impl(typed_flights)
    return json.dumps(result)

async def generate_a2ui(
    context: Annotated[str, "Conversation context to generate UI for"],
) -> str:
    """Generate dynamic A2UI components based on the conversation.

    A secondary LLM designs the UI schema and data. The result is
    returned as an a2ui_operations container for the middleware to detect.
    """
    import openai

    client = openai.OpenAI()

    response = client.chat.completions.create(
        model="gpt-4.1",
        messages=[
            {"role": "system", "content": context or "Generate a useful dashboard UI."},
            {"role": "user", "content": "Generate a dynamic A2UI dashboard based on the conversation."},
        ],
        tools=[{
            "type": "function",
            "function": RENDER_A2UI_TOOL_SCHEMA,
        }],
        tool_choice={"type": "function", "function": {"name": "render_a2ui"}},
    )

    choice = response.choices[0]
    if choice.message.tool_calls:
        args = json.loads(choice.message.tool_calls[0].function.arguments)
        result = build_a2ui_operations_from_tool_call(args)
        return json.dumps(result)

    return json.dumps({"error": "LLM did not call render_a2ui"})

# =====
# Agent
# =====
agent = ConversableAgent(
    name="assistant",
    system_message=(
        "You are a helpful sales assistant. You can look up current weather "
        "for any city using the get_weather tool, query financial data with "
        "query_data, manage the sales pipeline with manage_sales_todos and "
        "get_sales_todos, schedule meetings with schedule_meeting, search "
        "flights and display rich A2UI cards with search_flights, and "
        "generate dynamic A2UI dashboards with generate_a2ui. "
        "When asked about the weather, always use the tool rather than guessing. "
        "Be concise and friendly in your responses."
    ),
    llm_config=LLMConfig({"model": "gpt-4o-mini", "stream": True}),
    human_input_mode="NEVER",
    functions=[
        get_weather,
        query_data,
        manage_sales_todos,
        get_sales_todos,
        schedule_meeting,
        search_flights,
        generate_a2ui,
    ],
)

# AG-UI stream wrapper
stream = AGUIStream(agent)
