"""Strands AG-UI Integration Example - Proverbs Agent.

This example demonstrates a Strands agent integrated with AG-UI, featuring:
- Shared state management between agent and UI
- Backend tool execution (get_weather, update_proverbs)
- Frontend tools (set_theme_color)
- Generative UI rendering
"""

import json
import os
from typing import List

from ag_ui_strands import (
    StrandsAgent,
    StrandsAgentConfig,
    ToolBehavior,
    create_strands_app,
)
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from strands import Agent, tool
from strands.models.openai import OpenAIModel

load_dotenv()


class ProverbsList(BaseModel):
    """A list of proverbs."""

    proverbs: List[str] = Field(description="The complete list of proverbs")


@tool
def get_weather(location: str):
    """Get the weather for a location.

    Args:
        location: The location to get weather for

    Returns:
        Weather information as JSON string
    """
    return json.dumps({"location": "70 degrees"})


@tool
def set_theme_color(theme_color: str):
    """Change the theme color of the UI.

    This is a frontend tool - it returns None as the actual
    execution happens on the frontend via useFrontendTool.

    Args:
        theme_color: The color to set as theme
    """
    return None


@tool
def update_proverbs(proverbs_list: ProverbsList):
    """Update the complete list of proverbs.

    IMPORTANT: Always provide the entire list, not just new proverbs.

    Args:
        proverbs_list: The complete updated proverbs list

    Returns:
        Success message
    """
    return "Proverbs updated successfully"


def build_proverbs_prompt(input_data, user_message: str) -> str:
    """Inject the current proverbs state into the prompt."""
    state_dict = getattr(input_data, "state", None)
    if isinstance(state_dict, dict) and "proverbs" in state_dict:
        proverbs_json = json.dumps(state_dict["proverbs"], indent=2)
        return (
            f"Current proverbs list:\n{proverbs_json}\n\nUser request: {user_message}"
        )
    return user_message


async def proverbs_state_from_args(context):
    """Extract proverbs state from tool arguments.

    This function is called when update_proverbs tool is executed
    to emit a state snapshot to the UI.

    Args:
        context: ToolResultContext containing tool execution details

    Returns:
        dict: State snapshot with proverbs array, or None on error
    """
    try:
        tool_input = context.tool_input
        if isinstance(tool_input, str):
            tool_input = json.loads(tool_input)

        proverbs_data = tool_input.get("proverbs_list", tool_input)

        # Extract proverbs array
        if isinstance(proverbs_data, dict):
            proverbs_array = proverbs_data.get("proverbs", [])
        else:
            proverbs_array = []

        return {"proverbs": proverbs_array}
    except Exception:
        return None


# Configure agent behavior
shared_state_config = StrandsAgentConfig(
    state_context_builder=build_proverbs_prompt,
    tool_behaviors={
        "update_proverbs": ToolBehavior(
            skip_messages_snapshot=True,
            state_from_args=proverbs_state_from_args,
        )
    },
)

# Initialize OpenAI model
api_key = os.getenv("OPENAI_API_KEY", "")
model = OpenAIModel(
    client_args={"api_key": api_key},
    model_id="gpt-4o",
)

system_prompt = (
    "You are a helpful and wise assistant that helps manage a collection of proverbs."
)

# Create Strands agent with tools
# Note: Frontend tools (set_theme_color, hitl_test) return None - actual execution happens in the UI
strands_agent = Agent(
    model=model,
    system_prompt=system_prompt,
    tools=[update_proverbs, get_weather, set_theme_color],
)

# Wrap with AG-UI integration
agui_agent = StrandsAgent(
    agent=strands_agent,
    name="proverbs_agent",
    description="A proverbs assistant that collaborates with you to manage proverbs",
    config=shared_state_config,
)

# Create the FastAPI app
agent_path = os.getenv("AGENT_PATH", "/")
app = create_strands_app(agui_agent, agent_path)

if __name__ == "__main__":
    import uvicorn

    port  = int(os.getenv("AGENT_PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
