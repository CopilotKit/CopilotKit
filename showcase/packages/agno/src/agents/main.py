"""Agno Sales Pipeline Agent with shared tools for showcase demos."""

import json

from agno.agent.agent import Agent
from agno.models.openai import OpenAIChat
from agno.tools import tool
from dotenv import load_dotenv

import sys
import os

sys.path.insert(
    0,
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "shared", "python"),
)
from tools import (
    get_weather_impl,
    query_data_impl,
    schedule_meeting_impl,
    search_flights_impl,
    build_a2ui_operations_from_tool_call,
    RENDER_A2UI_TOOL_SCHEMA,
)
from tools.types import Flight

load_dotenv()


@tool
def get_weather(location: str):
    """
    Get the weather for a given location. Ensure location is fully spelled out.

    Args:
        location (str): The location to get the weather for.

    Returns:
        str: Weather data as JSON.
    """
    return json.dumps(get_weather_impl(location))


@tool
def query_data(query: str):
    """
    Query financial database for chart data. Returns data suitable for pie or bar charts.

    Args:
        query (str): The query to run against the financial database.

    Returns:
        str: Query results as JSON.
    """
    return json.dumps(query_data_impl(query))


@tool(external_execution=True)
def manage_sales_todos(todos: list[dict]):
    """
    Manage the sales pipeline. Pass the complete list of sales todos.
    Always pass the COMPLETE list of todos.

    Args:
        todos (list[dict]): The complete list of sales todos to maintain.
    """


@tool
def schedule_meeting(reason: str):
    """
    Schedule a meeting with user approval. Returns available time slots.

    Args:
        reason (str): Reason for scheduling the meeting.

    Returns:
        str: Meeting scheduling data as JSON.
    """
    return json.dumps(schedule_meeting_impl(reason))


@tool(external_execution=True)
def change_background(background: str):
    """
    Change the background color of the chat.
    ONLY call this tool when the user explicitly asks to change the background.
    Never call it proactively or as part of another response.
    Can be anything that the CSS background attribute accepts. Prefer gradients.

    Args:
        background (str): The CSS background value. Prefer gradients.
    """


@tool(external_execution=True)
def generate_task_steps(steps: list[dict]):
    """
    Generates a list of steps for the user to perform.
    Each step should have a description and status.

    Args:
        steps (list[dict]): A list of step objects, each with 'description' (str)
                            and 'status' ('enabled' or 'disabled').
    """


@tool
def search_flights(flights: list[dict]):
    """
    Search for flights and display the results as rich A2UI cards.
    Return exactly 2 flights.

    Each flight must have: airline, airlineLogo, flightNumber, origin, destination,
    date (short readable format like "Tue, Mar 18"),
    departureTime, arrivalTime, duration (e.g. "4h 25m"),
    status (e.g. "On Time" or "Delayed"),
    statusColor (hex color for status dot),
    price (e.g. "$289"), and currency (e.g. "USD").

    For airlineLogo use Google favicon API:
    https://www.google.com/s2/favicons?domain={airline_domain}&sz=128

    Args:
        flights (list[dict]): List of flight objects to display.

    Returns:
        str: A2UI operations as JSON.
    """
    typed_flights = [Flight(**f) for f in flights]
    result = search_flights_impl(typed_flights)
    return json.dumps(result)


@tool
def generate_a2ui(context: str):
    """
    Generate dynamic A2UI components based on the conversation.

    A secondary LLM designs the UI schema and data. The result is
    returned as an a2ui_operations container for the middleware to detect.

    Args:
        context (str): Conversation context to generate UI for.

    Returns:
        str: A2UI operations as JSON.
    """
    import openai

    client = openai.OpenAI()

    response = client.chat.completions.create(
        model="gpt-4.1",
        messages=[
            {"role": "system", "content": context or "Generate a useful dashboard UI."},
            {"role": "user", "content": "Generate a dynamic A2UI dashboard based on the conversation."},
        ],
        tools=[{
            "type": "function",
            "function": RENDER_A2UI_TOOL_SCHEMA,
        }],
        tool_choice={"type": "function", "function": {"name": "render_a2ui"}},
    )

    choice = response.choices[0]
    if choice.message.tool_calls:
        args = json.loads(choice.message.tool_calls[0].function.arguments)
        result = build_a2ui_operations_from_tool_call(args)
        return json.dumps(result)

    return json.dumps({"error": "LLM did not call render_a2ui"})


agent = Agent(
    model=OpenAIChat(id="gpt-4o"),
    tools=[
        get_weather,
        query_data,
        manage_sales_todos,
        schedule_meeting,
        change_background,
        generate_task_steps,
        search_flights,
        generate_a2ui,
    ],
    description="You are a helpful sales assistant for the CopilotKit showcase demos.",
    instructions="""
        SALES PIPELINE:
        When a user asks you to do anything regarding sales todos or the pipeline,
        use the manage_sales_todos tool. Always pass the COMPLETE LIST of todos.
        Be helpful in managing sales pipeline items.
        After using the tool, provide a brief summary of what you created, removed, or changed.

        WEATHER:
        Only call the get_weather tool if the user asks about the weather.
        If the user does not specify a location, use "Everywhere ever in the whole wide world".

        QUERY DATA:
        Use the query_data tool when the user asks for financial data, charts, or analytics.

        SCHEDULE MEETING:
        Use the schedule_meeting tool when the user wants to schedule a meeting.

        BACKGROUND:
        Only call change_background when the user explicitly asks to change colors/background.

        TASK STEPS (HITL):
        When asked to plan something, use the generate_task_steps tool with a list of steps.
        Each step should have a description and status of "enabled".

        FLIGHT SEARCH:
        Use search_flights when the user asks about flights. Generate 2 realistic flights.

        DYNAMIC A2UI:
        Use generate_a2ui when the user asks for a dashboard or dynamic UI.
    """,
)
