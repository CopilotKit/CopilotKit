"""
Dynamic A2UI tool: LLM-generated UI from conversation context.

Unlike the fixed-schema tools, this tool generates the entire A2UI
specification dynamically by calling a secondary LLM with the full
A2UI protocol reference. The LLM creates whatever UI best fits the
user's request.
"""

from __future__ import annotations

import json
from typing import Any

from copilotkit import a2ui
from langchain.tools import tool, ToolRuntime
from langchain_core.messages import SystemMessage
from langchain_openai import ChatOpenAI
from pathlib import Path

# Load the A2UI schema prompt from a separate file to keep this module clean
_SCHEMA_PROMPT_PATH = Path(__file__).parent / "a2ui_schema_prompt.md"
SCHEMA_PROMPT = _SCHEMA_PROMPT_PATH.read_text()


@tool()
def generate_a2ui(runtime: ToolRuntime[Any]) -> str:
    """Generate dynamic A2UI components based on the conversation.

    Calls a secondary LLM to produce A2UI operations, then wraps
    them in the standard a2ui.render() container.
    """
    # Exclude the last message (the pending tool call with no result yet)
    messages = runtime.state["messages"][:-1]

    model = ChatOpenAI(model="gpt-4.1-mini", temperature=0)
    response = model.invoke([SystemMessage(content=SCHEMA_PROMPT), *messages])

    return a2ui.render(operations=json.loads(response.content))
