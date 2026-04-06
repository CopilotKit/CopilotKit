"""
Strands agent with proverbs state, weather tool, and HITL support.

Adapted from examples/integrations/strands-python/agent/main.py
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


# =====
# State
# =====
class ProverbsList(BaseModel):
    """A list of proverbs."""

    proverbs: List[str] = Field(description="The complete list of proverbs")


# =====
# Tools
# =====
@tool
def get_proverbs():
    """Get the current list of proverbs.

    Returns:
        Instruction to check the proverbs in context
    """
    return "Check the proverbs list provided in the context."


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


@tool
def get_weather(location: str):
    """Get the weather for a location.

    Args:
        location: The location to get weather for

    Returns:
        Weather information as JSON string
    """
    return json.dumps({
        "location": location,
        "temperature": 22,
        "conditions": "Clear skies",
        "humidity": 55,
        "wind_speed": 12,
        "feels_like": 22,
    })


@tool
def set_theme_color(theme_color: str):
    """Change the theme color of the UI.

    This is a frontend tool - it returns None as the actual
    execution happens on the frontend via useFrontendTool.

    Args:
        theme_color: The color to set as theme
    """
    return None


# =====
# State management
# =====
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


# =====
# Agent configuration
# =====
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
    "You are a helpful assistant that helps manage and discuss proverbs. "
    "The user has a list of proverbs that you can help them manage. "
    "You have tools available to add, set, or retrieve proverbs from the list. "
    "When discussing proverbs, ALWAYS use the get_proverbs tool to see the current list before "
    "mentioning, updating, or discussing proverbs with the user."
)

# Create Strands agent with tools
strands_agent = Agent(
    model=model,
    system_prompt=system_prompt,
    tools=[get_proverbs, update_proverbs, get_weather, set_theme_color],
)

# Wrap with AG-UI integration
agui_agent = StrandsAgent(
    agent=strands_agent,
    name="strands_agent",
    description="A proverbs assistant that collaborates with you to manage proverbs",
    config=shared_state_config,
)
