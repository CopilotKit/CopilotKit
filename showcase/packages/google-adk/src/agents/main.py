"""Google ADK Sales Pipeline Agent with shared tools."""

from __future__ import annotations

import json
from typing import Dict, Optional

from dotenv import load_dotenv
from google.adk.agents import LlmAgent
from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.adk.tools import ToolContext
from google.genai import types

import sys
import os

sys.path.insert(
    0,
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "shared", "python"),
)
from tools import get_weather_impl, query_data_impl, manage_sales_todos_impl, get_sales_todos_impl, schedule_meeting_impl

load_dotenv()


def get_weather(tool_context: ToolContext, location: str) -> dict:
    """Get the weather for a given location. Ensure location is fully spelled out."""
    return get_weather_impl(location)


def query_data(tool_context: ToolContext, query: str) -> list:
    """Query financial database for chart data. Returns data suitable for pie or bar charts."""
    return query_data_impl(query)


def manage_sales_todos(tool_context: ToolContext, todos: list[dict]) -> dict:
    """
    Manage the sales pipeline. Pass the complete list of sales todos.

    Args:
        "todos": {
            "type": "array",
            "items": {"type": "object"},
            "description": "The complete list of sales todos to maintain",
        }

    Returns:
        Dict indicating success status
    """
    result = manage_sales_todos_impl(todos)
    tool_context.state["todos"] = result
    return {"status": "updated", "count": len(result)}


def get_sales_todos(tool_context: ToolContext) -> list:
    """Get the current list of sales pipeline todos."""
    return get_sales_todos_impl(tool_context.state.get("todos"))


def schedule_meeting(tool_context: ToolContext, reason: str, duration_minutes: int = 30) -> dict:
    """Schedule a meeting. The user will be asked to pick a time via the UI."""
    return schedule_meeting_impl(reason, duration_minutes)


def on_before_agent(callback_context: CallbackContext):
    """
    Initialize sales todos state if it doesn't exist.
    """
    if "todos" not in callback_context.state:
        callback_context.state["todos"] = []

    return None


def before_model_modifier(
    callback_context: CallbackContext, llm_request: LlmRequest
) -> Optional[LlmResponse]:
    """Inspects/modifies the LLM request to include current sales pipeline state."""
    agent_name = callback_context.agent_name
    if agent_name == "SalesPipelineAgent":
        todos_json = "No sales todos yet"
        if (
            "todos" in callback_context.state
            and callback_context.state["todos"] is not None
        ):
            try:
                todos_json = json.dumps(callback_context.state["todos"], indent=2)
            except Exception as e:
                todos_json = f"Error serializing todos: {str(e)}"
        original_instruction = llm_request.config.system_instruction or types.Content(
            role="system", parts=[]
        )
        prefix = f"""You are a helpful sales assistant for managing a sales pipeline.
        This is the current state of the sales todos: {todos_json}
        When you modify the sales todos (whether to add, remove, or modify one or more todos), use the manage_sales_todos tool to update the list."""
        if not isinstance(original_instruction, types.Content):
            original_instruction = types.Content(
                role="system", parts=[types.Part(text=str(original_instruction))]
            )
        if not original_instruction.parts:
            original_instruction.parts = [types.Part(text="")]

        if original_instruction.parts and len(original_instruction.parts) > 0:
            modified_text = prefix + (original_instruction.parts[0].text or "")
            original_instruction.parts[0].text = modified_text
        llm_request.config.system_instruction = original_instruction

    return None


def simple_after_model_modifier(
    callback_context: CallbackContext, llm_response: LlmResponse
) -> Optional[LlmResponse]:
    """Stop the consecutive tool calling of the agent."""
    agent_name = callback_context.agent_name
    if agent_name == "SalesPipelineAgent":
        if llm_response.content and llm_response.content.parts:
            if (
                llm_response.content.role == "model"
                and llm_response.content.parts[0].text
            ):
                callback_context._invocation_context.end_invocation = True

        elif llm_response.error_message:
            return None
        else:
            return None
    return None


sales_pipeline_agent = LlmAgent(
    name="SalesPipelineAgent",
    model="gemini-2.5-flash",
    instruction="""
        You are a helpful sales assistant that helps manage a sales pipeline and answer questions.

        SALES TODOS:
        When a user asks you to do anything regarding sales todos or the pipeline, use the manage_sales_todos tool.
        Always pass the COMPLETE LIST of todos to the manage_sales_todos tool.
        After using the tool, provide a brief summary of what you created, removed, or changed.

        WEATHER:
        Only call the get_weather tool if the user asks about the weather.
        If the user does not specify a location, use "Everywhere ever in the whole wide world".

        QUERY DATA:
        Use the query_data tool when the user asks for financial data, charts, or analytics.
        This returns data suitable for pie charts and bar charts.

        GET SALES TODOS:
        Use the get_sales_todos tool to retrieve the current list of sales todos before discussing them.
        """,
    tools=[get_weather, query_data, manage_sales_todos, get_sales_todos, schedule_meeting],
    before_agent_callback=on_before_agent,
    before_model_callback=before_model_modifier,
    after_model_callback=simple_after_model_modifier,
)
