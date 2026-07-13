"""
AG2 agent with weather and sales tools for CopilotKit showcase.

Uses AG2's Agent with AGUIStream to expose
the agent via the AG-UI protocol.
"""

# @region[weather-tool-backend]
from __future__ import annotations

import json
import logging
from typing import Annotated, Any

import openai
from ag2 import Agent
from ag2.config import OpenAIConfig
from ag2.ag_ui import AGUIStream
from dotenv import load_dotenv
from pydantic import Field, ValidationError

load_dotenv()

# Import shared tool implementations
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

from ._header_forwarding import get_forwarded_headers
from ._request_context import get_latest_user_message

logger = logging.getLogger(__name__)

# Module-level async client: re-used across requests (httpx connection pool is
# thread-safe). Using AsyncOpenAI inside an `async def` avoids blocking the
# ASGI event loop on the secondary LLM call.
_async_openai_client = openai.AsyncOpenAI()


# =====
# Tools
# =====
async def get_weather(
    location: Annotated[str, Field(description="City name to get weather for")],
) -> str:
    """Get current weather for a location."""
    result = get_weather_impl(location)
    # Return a JSON string (not a dict) so the frontend's
    # parseJsonResult/JSON.parse can parse the result — otherwise the weather
    # card renders "--" placeholders. Same pattern as search_flights below.
    return json.dumps(
        {
            "city": result["city"],
            "temperature": result["temperature"],
            "feels_like": result["feels_like"],
            "humidity": result["humidity"],
            "wind_speed": result["wind_speed"],
            "conditions": result["conditions"],
        }
    )


# @endregion[weather-tool-backend]


async def query_data(
    query: Annotated[str, Field(description="Natural language query for financial data")],
) -> str:
    """Query financial database for chart data."""
    # Return a JSON string (not a list) so the frontend's
    # parseJsonResult/JSON.parse can parse the result. Same pattern as
    # get_weather.
    return json.dumps(query_data_impl(query))


async def manage_sales_todos(
    todos: Annotated[list, Field(description="Complete list of sales todos")],
) -> str:
    """Manage the sales pipeline."""
    # See contract comment on query_data above — return JSON, not dict.
    # SalesTodo is a Pydantic model; coerce via model_dump for serialisability.
    result = [t.model_dump() for t in manage_sales_todos_impl(todos)]
    return json.dumps({"todos": result})


async def get_sales_todos() -> str:
    """Get the current sales pipeline."""
    # See contract comment on query_data above — return JSON, not list.
    # SalesTodo is a Pydantic model; coerce via model_dump for serialisability.
    return json.dumps([t.model_dump() for t in get_sales_todos_impl(None)])


async def schedule_meeting(
    reason: Annotated[str, Field(description="Reason for the meeting")],
) -> str:
    """Schedule a meeting with user approval."""
    # See contract comment on query_data above — return JSON, not dict.
    return json.dumps(schedule_meeting_impl(reason))


async def search_flights(
    flights: Annotated[
        list[dict[str, Any]],
        Field(description="List of flight objects to display as rich A2UI cards"),
    ],
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
    try:
        typed_flights: list[Flight] = [Flight(**f) for f in flights]
    except ValidationError as exc:
        logger.warning(
            "search_flights: invalid flight shape type=%s err=%s",
            type(exc).__name__,
            exc,
            exc_info=True,
        )
        return json.dumps({"error": f"invalid flight shape: {exc}"})
    result = search_flights_impl(typed_flights)
    return json.dumps(result)


async def generate_a2ui(
    context: Annotated[str, Field(description="Conversation context to generate UI for")],
) -> str:
    """Generate dynamic A2UI components based on the conversation.

    A secondary LLM designs the UI schema and data. The result is
    returned as an a2ui_operations container for the middleware to detect.
    """
    # A13: AsyncOpenAI inside async def (was sync openai.OpenAI which blocks
    # the ASGI event loop). Forward x-* headers via extra_headers in addition
    # to the global httpx hook so aimock context routing is explicit at the
    # call site.
    #
    # R2-A1 / A4: thread the latest user prompt from the inbound
    # RunAgentInput.messages payload (captured into a per-request ContextVar
    # by RequestUserMessageMiddleware — see agents/_request_context.py) into
    # the inner LLM call so each pill's request body is byte-distinct.
    # Without this, every pill landing on the omnibus agent (agentic-chat /
    # tool-rendering / chat-customization-css / hitl) produces an IDENTICAL
    # inner-LLM body and the aimock fixture cannot disambiguate. Falls back
    # to the original hardcoded prompt when the middleware captured nothing
    # (parse failure already logged at WARNING).
    user_prompt = get_latest_user_message() or (
        "Generate a dynamic A2UI dashboard based on the conversation."
    )
    forwarded = get_forwarded_headers()
    try:
        response = await _async_openai_client.chat.completions.create(
            model="gpt-4.1",
            messages=[
                {
                    "role": "system",
                    "content": context or "Generate a useful dashboard UI.",
                },
                {
                    "role": "user",
                    "content": user_prompt,
                },
            ],
            tools=[
                {
                    "type": "function",
                    "function": RENDER_A2UI_TOOL_SCHEMA,
                }
            ],
            tool_choice={"type": "function", "function": {"name": "render_a2ui"}},
            extra_headers=forwarded or None,
        )
    except Exception as exc:
        logger.error(
            "generate_a2ui: inner LLM call failed type=%s err=%s",
            type(exc).__name__,
            exc,
            exc_info=True,
        )
        return json.dumps({"error": f"inner LLM call failed: {type(exc).__name__}"})

    if not response.choices:
        logger.warning("generate_a2ui: LLM returned no choices")
        return json.dumps({"error": "LLM returned no choices"})

    choice = response.choices[0]
    if not choice.message.tool_calls:
        logger.warning("generate_a2ui: secondary LLM produced no render_a2ui tool call")
        return json.dumps({"error": "LLM did not call render_a2ui"})

    try:
        args = json.loads(choice.message.tool_calls[0].function.arguments)
        result = build_a2ui_operations_from_tool_call(args)
        return json.dumps(result)
    except (json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        logger.error(
            "generate_a2ui: failed to parse render_a2ui args type=%s err=%s",
            type(exc).__name__,
            exc,
            exc_info=True,
        )
        return json.dumps(
            {"error": f"failed to parse render_a2ui args: {type(exc).__name__}"}
        )


# =====
# Agent
# =====
agent = Agent(
    name="assistant",
    prompt=(
        "You are a helpful sales assistant. You can look up current weather "
        "for any city using the get_weather tool, query financial data with "
        "query_data, manage the sales pipeline with manage_sales_todos and "
        "get_sales_todos, schedule meetings with schedule_meeting, search "
        "flights and display rich A2UI cards with search_flights, and "
        "generate dynamic A2UI dashboards with generate_a2ui. "
        "When asked about the weather, always use the tool rather than guessing. "
        "Be concise and friendly in your responses."
    ),
    config=OpenAIConfig(model="gpt-4o-mini", streaming=True),
    # Guard-rationale note: the 0.x port capped tool-call loops with
    # max_consecutive_auto_reply=15 because a runaway loop floods Railway's
    # log stream (500 logs/sec rate-limit), makes the agent unresponsive to
    # health probes, and gets it killed by the watchdog. ag2 1.0 has no
    # direct per-turn auto-reply cap, so no equivalent parameter is set here.
    tools=[
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
