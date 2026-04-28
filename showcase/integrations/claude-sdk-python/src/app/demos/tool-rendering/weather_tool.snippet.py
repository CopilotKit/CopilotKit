# Docs-only snippet — not imported or executed. The runtime agent in
# `src/agents/agent.py` declares `get_weather` as one entry in a shared
# `TOOLS` list of Anthropic tool schemas and dispatches via
# `_execute_tool`, which is great for the production demo but doesn't
# read as a clean single-tool teaching example. This sibling shows the
# Claude Agent SDK idiom for "one backend tool" so the
# /generative-ui/tool-rendering docs can render real teaching code
# rather than a missing-snippet box.
#
# Why a sibling file: the bundler walks every file in the demo folder
# and extracts region markers from each, so a docs-targeted teaching
# example can live alongside the production demo without being wired
# into the route. See: showcase/scripts/bundle-demo-content.ts.

from typing import Any


# @region[weather-tool-backend]
# Anthropic tool schema — passed via the `tools` parameter on
# `client.messages.create(...)` / `.stream(...)`. Claude calls this
# tool by name; the runtime dispatches to the matching handler below.
GET_WEATHER_TOOL: dict[str, Any] = {
    "name": "get_weather",
    "description": (
        "Get the current weather for a given location. Useful on its "
        "own for weather questions, and a great companion to "
        "`search_flights` — always consider checking the weather at a "
        "destination the user is flying to."
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
}


def get_weather(location: str) -> dict[str, Any]:
    """Handler invoked when Claude calls the `get_weather` tool."""
    return {
        "city": location,
        "temperature": 68,
        "humidity": 55,
        "wind_speed": 10,
        "conditions": "Sunny",
    }
# @endregion[weather-tool-backend]
