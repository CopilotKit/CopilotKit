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

from .tools import (
    get_weather_impl,
    query_data_impl,
    manage_sales_todos_impl,
    get_sales_todos_impl,
    schedule_meeting_impl,
    search_flights_impl,
    build_a2ui_operations_from_tool_call,
)

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

def search_flights(tool_context: ToolContext, flights: list[dict]) -> dict:
    """Search for flights and display the results as rich cards. Return exactly 2 flights.

    Each flight must have: airline, airlineLogo, flightNumber, origin, destination,
    date (short readable format like "Tue, Mar 18" -- use near-future dates),
    departureTime, arrivalTime, duration (e.g. "4h 25m"),
    status (e.g. "On Time" or "Delayed"),
    statusColor (hex color for status dot),
    price (e.g. "$289"), and currency (e.g. "USD").

    For airlineLogo use Google favicon API:
    https://www.google.com/s2/favicons?domain={airline_domain}&sz=128
    """
    return search_flights_impl(flights)

def generate_a2ui(tool_context: ToolContext) -> dict:
    """Generate dynamic A2UI components based on the conversation.

    A secondary LLM designs the UI schema and data. The result is
    returned as an a2ui_operations container for the middleware to detect.
    """
    from openai import OpenAI

    # Extract copilotkit context entries from session state
    copilotkit_state = tool_context.state.get("copilotkit", {})
    context_entries = copilotkit_state.get("context", []) if isinstance(copilotkit_state, dict) else []
    context_text = "\n\n".join(
        entry.get("value", "")
        for entry in context_entries
        if isinstance(entry, dict) and entry.get("value")
    )

    # Extract conversation messages from session history
    conversation_messages: list[dict] = []
    try:
        session = tool_context._invocation_context.session
        if session and hasattr(session, "events"):
            for event in session.events:
                if hasattr(event, "content") and event.content and hasattr(event.content, "parts"):
                    role_str = getattr(event.content, "role", "")
                    if role_str in ("user", "model"):
                        text_parts = []
                        for part in event.content.parts:
                            if hasattr(part, "text") and part.text:
                                text_parts.append(part.text)
                        if text_parts:
                            oai_role = "assistant" if role_str == "model" else "user"
                            conversation_messages.append({"role": oai_role, "content": "".join(text_parts)})
    except Exception:
        pass

    client = OpenAI()
    tool_schema = {
        "type": "function",
        "function": {
            "name": "render_a2ui",
            "description": "Render a dynamic A2UI v0.9 surface.",
            "parameters": {
                "type": "object",
                "properties": {
                    "surfaceId": {"type": "string"},
                    "catalogId": {"type": "string"},
                    "components": {"type": "array", "items": {"type": "object"}},
                    "data": {"type": "object"},
                },
                "required": ["surfaceId", "catalogId", "components"],
            },
        },
    }

    llm_messages: list[dict] = [
        {"role": "system", "content": context_text or "Generate a useful dashboard UI."},
    ]
    llm_messages.extend(conversation_messages)

    response = client.chat.completions.create(
        model="gpt-4.1",
        messages=llm_messages,
        tools=[tool_schema],
        tool_choice={"type": "function", "function": {"name": "render_a2ui"}},
    )

    if not response.choices[0].message.tool_calls:
        return {"error": "LLM did not call render_a2ui"}

    tool_call = response.choices[0].message.tool_calls[0]
    args = json.loads(tool_call.function.arguments)
    return build_a2ui_operations_from_tool_call(args)

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

        SEARCH FLIGHTS:
        Use the search_flights tool to search for flights and display rich A2UI cards.

        GENERATE A2UI:
        Use the generate_a2ui tool to generate dynamic A2UI dashboards from conversation context.
        """,
    tools=[get_weather, query_data, manage_sales_todos, get_sales_todos, schedule_meeting, search_flights, generate_a2ui],
    before_agent_callback=on_before_agent,
    before_model_callback=before_model_modifier,
    after_model_callback=simple_after_model_modifier,
)
