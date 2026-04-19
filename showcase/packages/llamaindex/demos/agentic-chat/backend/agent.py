"""LlamaIndex agent backing the Agentic Chat demo.

Natural conversation with frontend tool execution. The backend exposes
get_weather as a server-side tool; the frontend registers change_background
as a client-side tool via CopilotKit.
"""

import json
from typing import Annotated

from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router


# --- Frontend tool declaration (executed client-side) ---

def change_background(
    background: Annotated[str, "CSS background value. Prefer gradients."],
) -> str:
    """Change the background color/gradient of the chat area."""
    return f"Background changed to {background}"


# --- Backend tool (executed server-side) ---

async def get_weather(
    location: Annotated[str, "The location to get the weather for."],
) -> str:
    """Get the weather for a given location."""
    # Deterministic placeholder weather data.
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
    frontend_tools=[change_background],
    backend_tools=[get_weather],
    system_prompt=(
        "You are a polished, professional demo assistant for CopilotKit. "
        "Keep responses brief and clear -- 1 to 2 sentences max. "
        "When asked about weather, always call the get_weather tool. "
        "When asked to change the background, call the change_background tool."
    ),
)
