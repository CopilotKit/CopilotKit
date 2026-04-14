"""
Langroid AG-UI Agent

Wraps a Langroid ChatAgent with tools behind a custom AG-UI SSE endpoint.
Langroid does not have a native AG-UI adapter, so we implement the AG-UI
protocol (SSE events) manually using the ag-ui-protocol types.

The agent supports:
  - Agentic chat (streaming text responses)
  - Backend tool execution (get_weather, query_data, manage_sales_todos, get_sales_todos)
  - Frontend tool calls (change_background, generate_haiku, schedule_meeting)
  - Human-in-the-loop via schedule_meeting (frontend-rendered meeting time picker)
"""

from __future__ import annotations

import json
import os
import sys
from typing import Annotated

import langroid as lr
import langroid.language_models as lm
from langroid.agent.tool_message import ToolMessage
from dotenv import load_dotenv

load_dotenv()

# =====================================================================
# Shared tool implementations
# =====================================================================

sys.path.insert(
    0,
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "shared", "python"),
)
from tools import (
    get_weather_impl,
    query_data_impl,
    manage_sales_todos_impl,
    get_sales_todos_impl,
    schedule_meeting_impl,
)


# =====================================================================
# Langroid Tool Definitions
# =====================================================================

class GetWeatherTool(ToolMessage):
    """Get the weather for a given location."""
    request: str = "get_weather"
    purpose: str = "Get current weather for a location."
    location: str

    def handle(self) -> str:
        result = get_weather_impl(self.location)
        return json.dumps(result)


class QueryDataTool(ToolMessage):
    """Query the database. Takes natural language."""
    request: str = "query_data"
    purpose: str = "Query the database. Always call before showing a chart or graph."
    query: str

    def handle(self) -> str:
        result = query_data_impl(self.query)
        return json.dumps(result)


class ManageSalesTodosTool(ToolMessage):
    """Replace the entire list of sales todos."""
    request: str = "manage_sales_todos"
    purpose: str = (
        "Replace the entire list of sales todos with the provided values. "
        "Always include every todo you want to keep."
    )
    todos: list[dict]

    def handle(self) -> str:
        result = manage_sales_todos_impl(self.todos)
        return json.dumps(result)


class GetSalesTodosTool(ToolMessage):
    """Get the current list of sales todos."""
    request: str = "get_sales_todos"
    purpose: str = "Get the current list of sales todos."

    def handle(self) -> str:
        result = get_sales_todos_impl()
        return json.dumps(result)


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


class ScheduleMeetingTool(ToolMessage):
    """Schedule a meeting. The user will be asked to pick a time via the UI."""
    request: str = "schedule_meeting"
    purpose: str = "Schedule a meeting. The user will be asked to pick a time via the meeting time picker UI."
    reason: str
    duration_minutes: int = 30

    def handle(self) -> str:
        result = schedule_meeting_impl(self.reason, self.duration_minutes)
        return json.dumps(result)


# =====================================================================
# Agent factory
# =====================================================================

# Tools that execute server-side (Langroid handles them directly)
BACKEND_TOOLS = [
    GetWeatherTool,
    QueryDataTool,
    ManageSalesTodosTool,
    GetSalesTodosTool,
]

# Tools that execute client-side (AG-UI adapter forwards to frontend)
FRONTEND_TOOLS = [
    ChangeBackgroundTool,
    GenerateHaikuTool,
    ScheduleMeetingTool,
]

ALL_TOOLS = BACKEND_TOOLS + FRONTEND_TOOLS

FRONTEND_TOOL_NAMES = {t.default_value("request") for t in FRONTEND_TOOLS}

SYSTEM_PROMPT = (
    "You are a helpful assistant that can: "
    "get the weather for a given location, "
    "query a database for financial/sales data, "
    "manage a list of sales todos, "
    "schedule meetings (which requires user approval via the meeting time picker), "
    "change the background color/gradient of the chat area, "
    "and generate haikus with Japanese and English text. "
    "When asked about weather, always use the get_weather tool and return the JSON result. "
    "When asked about data, charts, or graphs, use the query_data tool first. "
    "When asked to manage todos, use manage_sales_todos or get_sales_todos. "
    "When asked to schedule a meeting, use the schedule_meeting tool."
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
