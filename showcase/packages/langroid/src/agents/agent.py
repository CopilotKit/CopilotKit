"""
Langroid AG-UI Agent

Wraps a Langroid ChatAgent with tools behind a custom AG-UI SSE endpoint.
Langroid does not have a native AG-UI adapter, so we implement the AG-UI
protocol (SSE events) manually using the ag-ui-protocol types.

The agent supports:
  - Agentic chat (streaming text responses)
  - Backend tool execution (get_weather)
  - Frontend tool calls (change_background, add_proverb, generate_haiku, generate_task_steps)
  - Human-in-the-loop via generate_task_steps (frontend-rendered approval UI)
"""

from __future__ import annotations

import json
import os
import uuid
from typing import Annotated, Any

import langroid as lr
import langroid.language_models as lm
from langroid.agent.tool_message import ToolMessage
from dotenv import load_dotenv

load_dotenv()


# =====================================================================
# Langroid Tool Definitions
# =====================================================================

class GetWeatherTool(ToolMessage):
    """Get the weather for a given location."""
    request: str = "get_weather"
    purpose: str = "Get current weather for a location."
    location: str

    def handle(self) -> str:
        return json.dumps({
            "city": self.location,
            "temperature": 22,
            "conditions": "Clear skies",
            "humidity": 55,
            "wind_speed": 12,
            "feels_like": 24,
        })


# Frontend tools — the agent "calls" them but they execute client-side.
# We define them so Langroid's LLM knows the tool schemas; the AG-UI
# adapter intercepts the call and forwards it to the frontend.

class ChangeBackgroundTool(ToolMessage):
    """Change the background color/gradient of the chat area."""
    request: str = "change_background"
    purpose: str = "Change the background color/gradient of the chat area. ONLY call this when the user explicitly asks."
    background: Annotated[str, "CSS background value. Prefer gradients."]

    def handle(self) -> str:
        return f"Background changed to {self.background}"


class AddProverbTool(ToolMessage):
    """Add a proverb to the list of proverbs."""
    request: str = "add_proverb"
    purpose: str = "Add a proverb to the list of proverbs."
    proverb: Annotated[str, "The proverb to add. Make it witty, short and concise."]

    def handle(self) -> str:
        return f"Added proverb: {self.proverb}"


class GenerateHaikuTool(ToolMessage):
    """Generate a haiku with Japanese text, English translation, and a background image."""
    request: str = "generate_haiku"
    purpose: str = "Generate a haiku with Japanese text, English translation, and a background image."
    japanese: list[str]
    english: list[str]
    image_name: str
    gradient: str

    def handle(self) -> str:
        return "Haiku generated!"


class GenerateTaskStepsTool(ToolMessage):
    """Generate a list of task steps for the user to review and approve."""
    request: str = "generate_task_steps"
    purpose: str = "Generate a list of task steps for the user to review and approve."
    steps: list[dict[str, str]]

    def handle(self) -> str:
        return f"Generated {len(self.steps)} steps for review"


# =====================================================================
# Agent factory
# =====================================================================

# Tools that execute server-side (Langroid handles them directly)
BACKEND_TOOLS = [GetWeatherTool]

# Tools that execute client-side (AG-UI adapter forwards to frontend)
FRONTEND_TOOLS = [
    ChangeBackgroundTool,
    AddProverbTool,
    GenerateHaikuTool,
    GenerateTaskStepsTool,
]

ALL_TOOLS = BACKEND_TOOLS + FRONTEND_TOOLS

FRONTEND_TOOL_NAMES = {t.default_value("request") for t in FRONTEND_TOOLS}

SYSTEM_PROMPT = (
    "You are a helpful assistant that can: "
    "add proverbs to a list, get the weather for a given location, "
    "change the background color/gradient of the chat area, "
    "generate haikus with Japanese and English text, "
    "and generate task step plans for user review. "
    "When asked about weather, always use the get_weather tool and return the JSON result. "
    "When asked to plan or create steps, use the generate_task_steps tool."
)


def create_agent() -> lr.ChatAgent:
    """Create a Langroid ChatAgent configured with all showcase tools."""
    model = os.getenv("LANGROID_MODEL", "openai/gpt-4.1")

    llm_config = lm.OpenAIGPTConfig(
        chat_model=model,
        stream=True,
    )

    agent_config = lr.ChatAgentConfig(
        llm=llm_config,
        system_message=SYSTEM_PROMPT,
    )

    agent = lr.ChatAgent(agent_config)
    agent.enable_message(ALL_TOOLS)
    return agent
