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
from tools import get_weather_impl, query_data_impl, schedule_meeting_impl

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


agent = Agent(
    model=OpenAIChat(id="gpt-4o"),
    tools=[
        get_weather,
        query_data,
        manage_sales_todos,
        schedule_meeting,
        change_background,
        generate_task_steps,
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
    """,
)
