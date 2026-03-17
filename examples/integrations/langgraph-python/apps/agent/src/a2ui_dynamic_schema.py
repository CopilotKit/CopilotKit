"""
Dynamic A2UI tool: LLM-generated UI from conversation context.

The secondary LLM generates A2UI operations via a structured tool call.
The render_a2ui tool is a real backend tool that returns a2ui.render_dynamic().
The AG-UI middleware maps its streaming tool call args to the same progressive
rendering pipeline as fixed-schema streaming surfaces.
"""

from __future__ import annotations

from typing import Any

from copilotkit import a2ui
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
    """Render a dynamic A2UI surface.

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
    # Real tool — builds and returns A2UI operations, same as fixed-schema tools.
    # The middleware also intercepts the streaming tool call args for progressive
    # rendering, so this result serves as the complete fallback/final snapshot.
    return a2ui.render_dynamic(
        surfaceId=surfaceId,
        components=components,
        root=root,
        items=items,
        actionHandlers=actionHandlers,
    )


@tool()
def generate_a2ui(runtime: ToolRuntime[Any]) -> str:
    """Generate dynamic A2UI components based on the conversation.

    The secondary LLM's tool call args stream as TOOL_CALL_ARGS events.
    The middleware maps these to progressive A2UI rendering.
    """
    # Exclude the last message (this tool call, not yet balanced with a response).
    messages = runtime.state["messages"][:-1]

    model = ChatOpenAI(model="gpt-4.1")
    model_with_tool = model.bind_tools(
        [render_a2ui],
        tool_choice="render_a2ui",
    )

    response = model_with_tool.invoke(
        [SystemMessage(content=A2UI_GENERATION_PROMPT), *messages],
    )

    # render_a2ui is a real tool — invoke it to build A2UI operations.
    tool_call = response.tool_calls[0]
    return a2ui.render_dynamic(**tool_call["args"])
