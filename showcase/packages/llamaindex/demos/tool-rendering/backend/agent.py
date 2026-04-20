"""LlamaIndex agent backing the Tool Rendering demo.

Exposes get_weather as a backend tool. The frontend uses useRenderTool to
render the returned JSON as a themed weather card.
"""

import json
from typing import Annotated

from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router


async def get_weather(
    location: Annotated[str, "The location to get the weather for."],
) -> str:
    """Get the weather for a given location. Returns temperature, conditions, humidity, wind speed, and feels-like temperature."""
    data = {
        "city": location,
        "temperature": 22,
        "conditions": "sunny",
        "humidity": 55,
        "wind_speed": 8,
        "feels_like": 23,
    }
    return json.dumps(data)


agent_router = get_ag_ui_workflow_router(
    llm=OpenAI(model="gpt-4.1"),
    frontend_tools=[],
    backend_tools=[get_weather],
    system_prompt=(
        "You are a concise weather assistant. When asked about weather, "
        "always call the get_weather tool with the requested location."
    ),
)
