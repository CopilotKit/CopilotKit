"""Langroid agent backing the HITL cell.

Surfaces a `generate_task_steps` frontend tool which the UI renders
via useHumanInTheLoop for user approval.
"""

from __future__ import annotations

import os
from typing import Any

import langroid as lr
import langroid.language_models as lm
from langroid.agent.tool_message import ToolMessage
from dotenv import load_dotenv

load_dotenv()


class GenerateTaskStepsTool(ToolMessage):
    """Generate a plan as a list of steps for user review."""
    request: str = "generate_task_steps"
    purpose: str = (
        "Generate a list of plan steps for the user to review. "
        "Each step has a description and a status ('enabled', 'disabled', or 'executing'). "
        "The user will approve/reject the plan in the UI."
    )
    steps: list[dict[str, Any]]

    def handle(self) -> str:
        return "Awaiting user approval"


BACKEND_TOOLS: list[type[ToolMessage]] = []
FRONTEND_TOOLS = [GenerateTaskStepsTool]
ALL_TOOLS = BACKEND_TOOLS + FRONTEND_TOOLS
FRONTEND_TOOL_NAMES = {t.default_value("request") for t in FRONTEND_TOOLS}


SYSTEM_PROMPT = (
    "You are a helpful planning assistant. When the user asks for a plan, "
    "use the generate_task_steps tool with a list of concise, actionable steps. "
    "Each step should be a dict with 'description' (string) and 'status' "
    "('enabled' by default). The user will review and approve the plan before "
    "execution."
)


def create_agent() -> lr.ChatAgent:
    model = os.getenv("LANGROID_MODEL", "openai/gpt-4.1")
    llm_config = lm.OpenAIGPTConfig(chat_model=model, stream=True)
    agent_config = lr.ChatAgentConfig(
        llm=llm_config,
        system_message=SYSTEM_PROMPT,
    )
    agent = lr.ChatAgent(agent_config)
    agent.enable_message(ALL_TOOLS)
    return agent
