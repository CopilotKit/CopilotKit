"""Claude Agent SDK (Python) backing the Agentic Chat demo.

Exposes two tools:
  - get_weather (backend-executed; frontend renders the result card)
  - change_background (frontend-executed; backend only acknowledges)
"""

from __future__ import annotations

import json
import random
from textwrap import dedent
from typing import Any

from ag_ui_runner import make_runner
from pydantic import BaseModel


TOOLS: list[dict[str, Any]] = [
    {
        "name": "get_weather",
        "description": "Get current weather for a location. Frontend renders the result.",
        "input_schema": {
            "type": "object",
            "properties": {"location": {"type": "string"}},
            "required": ["location"],
        },
    },
    {
        "name": "change_background",
        "description": (
            "Change the chat background. Frontend tool; only call when the user "
            "explicitly asks to change the background."
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


SYSTEM_PROMPT = dedent(
    """
    You are a helpful, concise assistant.

    Tool usage:
    - Call `get_weather` whenever the user asks about the weather in a location.
    - Call `change_background` only when the user explicitly asks to change the background.

    Keep replies short and friendly.
    """
).strip()


class AgentState(BaseModel):
    pass


_CONDITIONS = [
    "Sunny",
    "Partly Cloudy",
    "Cloudy",
    "Overcast",
    "Light Rain",
    "Heavy Rain",
    "Thunderstorm",
    "Snow",
    "Foggy",
    "Windy",
]


def _get_weather(city: str) -> dict[str, Any]:
    rng = random.Random(city.lower())
    temperature = rng.randint(20, 95)
    return {
        "city": city,
        "temperature": temperature,
        "humidity": rng.randint(30, 90),
        "wind_speed": rng.randint(2, 30),
        "feels_like": temperature + rng.randint(-5, 5),
        "conditions": rng.choice(_CONDITIONS),
    }


def execute_tool(name: str, tool_input: dict[str, Any], state: AgentState) -> tuple[str, AgentState | None]:
    if name == "get_weather":
        return json.dumps(_get_weather(tool_input["location"])), None
    if name == "change_background":
        return f"Background change requested: {tool_input.get('background', '')}", None
    return f"Unknown tool: {name}", None


run_agent = make_runner(
    tools=TOOLS,
    system_prompt=SYSTEM_PROMPT,
    state_cls=AgentState,
    execute_tool=execute_tool,
)
