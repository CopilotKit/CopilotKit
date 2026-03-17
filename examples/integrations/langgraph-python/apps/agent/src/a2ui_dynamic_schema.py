"""
Dynamic A2UI tool: LLM-generated UI from conversation context.

The secondary LLM generates A2UI operations via a structured tool call.
Operations stream as TOOL_CALL_ARGS events. The middleware extracts
complete operations progressively and auto-injects beginRendering so
the surface renders as soon as the schema is ready.
"""

from __future__ import annotations

import json
from typing import Any

from langchain.tools import tool, ToolRuntime
from langchain_core.messages import SystemMessage
from langchain_core.tools import tool as lc_tool
from langchain_openai import ChatOpenAI

from copilotkit.a2ui import a2ui_prompt

A2UI_GENERATION_PROMPT = a2ui_prompt()


@lc_tool
def render_a2ui(
    surfaceId: str,
    components: list[dict],
    root: str,
    items: list[dict],
    actionHandlers: dict | None = None,
) -> str:
    """Render a dynamic A2UI surface with progressive streaming.

    Args:
        surfaceId: Unique surface identifier.
        components: A2UI component array (the schema). Use a List with
            template/dataBinding="/items" for repeating cards.
        root: ID of the root component.
        items: Plain JSON array of data objects. Each object's keys
            correspond to the path bindings in the template components.
        actionHandlers: Optional dict mapping action names to arrays of
            A2UI operations for optimistic UI updates on button click.
    """
    return "rendered"


@tool()
def generate_a2ui(runtime: ToolRuntime[Any]) -> str:
    """Generate dynamic A2UI components based on the conversation.

    The secondary LLM's tool call args stream as TOOL_CALL_ARGS events.
    The middleware extracts complete operations progressively.
    """
    messages = runtime.state["messages"][:-1]

    model = ChatOpenAI(model="gpt-4.1", temperature=0)
    model_with_tool = model.bind_tools(
        [render_a2ui],
        tool_choice="render_a2ui",
    )

    response = model_with_tool.invoke(
        [SystemMessage(content=A2UI_GENERATION_PROMPT), *messages],
    )

    # Extract the render_a2ui tool call arguments and format a readable summary.
    tool_call = response.tool_calls[0]
    args = tool_call["args"]

    return (
        f"Rendered A2UI on the client.\n"
        f"Arguments: {json.dumps(args, indent=2)}\n"
        f"Return value: rendered"
    )
