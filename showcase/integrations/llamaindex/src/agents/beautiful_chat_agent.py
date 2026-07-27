"""LlamaIndex agent backing the Beautiful Chat demo.

This is a polished starter chat — a basic agentic-chat agent with a friendly
system prompt and the same backend tools as the canonical shared agent
(weather, simple chat). The frontend wraps it with brand styling, suggestion
pills, and a side canvas — see src/app/demos/beautiful-chat/page.tsx.

Mirrors `langgraph-python/src/agents/beautiful_chat.py` but in simplified
form (the LangGraph version bundles a full A2UI catalog, MCP wiring, and
shared-state todos; this LlamaIndex port keeps the surface focused on the
"polished agentic chat starter" use case).

NOTE: deliberately NO ``from __future__ import annotations`` here. The
future import stringifies ``get_weather``'s annotations; pydantic's
signature-derived tool model then fails to resolve ``Annotated`` at
schema-build time ("`get_weather` is not fully defined… call
`get_weather.model_rebuild()`"), erroring every run of this agent.
"""

import json
import os
from typing import Annotated

from llama_index.llms.openai import OpenAI

from agents._request_tools import make_request_aware_router
from tools import get_weather_impl, search_flights_impl


async def get_weather(
    location: Annotated[str, "The location to get the weather for."],
) -> str:
    """Get the weather for a given location."""
    return json.dumps(get_weather_impl(location))


async def search_flights(
    flights: Annotated[
        list,
        "List of flight objects to search and display as rich cards. "
        "Return exactly 2 flights.",
    ],
) -> str:
    """Search for flights and display the results as rich A2UI cards.

    Each flight must have: airline, airlineLogo, flightNumber, origin,
    destination, date, departureTime, arrivalTime, duration, status,
    statusColor, price, currency.
    """
    return json.dumps(search_flights_impl(flights))


SYSTEM_PROMPT = """You are a polished, friendly demo assistant powering the
"Beautiful Chat" showcase. You are deliberately concise — keep answers to
1-2 sentences when possible.

You can:
- Chat naturally with the user
- Get weather for a location via the get_weather tool
- Search flights and display rich flight cards via the search_flights tool
- Render charts the page provides (pieChart / barChart frontend components)
- Toggle the app theme via the toggleTheme frontend tool
- Schedule a meeting with the user via the scheduleTime frontend tool
  (human-in-the-loop time picker)

When asked to search or show flights, always call search_flights with exactly
two flights. Be warm, pithy, and helpful. Avoid filler — let the chat surface
itself do the talking."""


_openai_kwargs = {}
if os.environ.get("OPENAI_BASE_URL"):
    _openai_kwargs["api_base"] = os.environ["OPENAI_BASE_URL"]

# The page registers frontend tools/components at request time via React hooks
# (toggleTheme, pieChart, barChart, scheduleTime — see
# src/app/demos/beautiful-chat/hooks/use-generative-ui-examples.tsx). The
# request-aware router forwards those injected tools to the LLM so the request
# shape matches the recorded aimock fixture; without it the LLM never sees the
# injected tools, the request 404s in aimock, and the run emits RUN_ERROR
# (sse-missing) instead of RUN_FINISHED. See agents/_request_tools.py.
beautiful_chat_router = make_request_aware_router(
    llm=OpenAI(model="gpt-4o-mini", **_openai_kwargs),
    frontend_tools=[],
    # search_flights is a backend tool the page's "Search Flights" pill exercises
    # (mirrors langgraph-python/beautiful_chat.py). The page-injected frontend
    # tools (toggleTheme, pieChart, barChart, scheduleTime) are forwarded at
    # request time by make_request_aware_router. See agents/_request_tools.py.
    backend_tools=[get_weather, search_flights],
    system_prompt=SYSTEM_PROMPT,
    initial_state={},
)
