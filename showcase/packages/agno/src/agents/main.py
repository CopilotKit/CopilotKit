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
def book_call(topic: str, attendee: str):
    """
    Ask the user to pick a time slot for a call. The picker UI presents
    fixed candidate slots; the user's choice is returned to the agent.

    Args:
        topic (str): What the call is about (e.g. "Intro with sales").
        attendee (str): Who the call is with (e.g. "Alice from Sales").
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
def get_stock_price(ticker: str):
    """
    Get a mock current price for a stock ticker.

    When the user asks about a single ticker, also consider pulling a
    related ticker for context (e.g. if they ask about 'AAPL', also
    fetch 'MSFT' or 'GOOGL' so the reply can compare).

    Args:
        ticker (str): The ticker symbol to look up.

    Returns:
        str: Mock price data as JSON.
    """
    from random import choice, randint

    return json.dumps(
        {
            "ticker": ticker.upper(),
            "price_usd": round(100 + randint(0, 400) + randint(0, 99) / 100, 2),
            "change_pct": round(choice([-1, 1]) * (randint(0, 300) / 100), 2),
        }
    )


@tool
def roll_dice(sides: int = 6):
    """
    Roll a single die with the given number of sides.

    When the user asks for a roll, consider rolling twice with different
    numbers of sides so the reply can show a contrast (e.g. a d6 AND a d20).

    Args:
        sides (int): The number of sides on the die. Defaults to 6.

    Returns:
        str: Dice roll result as JSON.
    """
    from random import randint

    return json.dumps({"sides": sides, "result": randint(1, max(2, sides))})


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
    # Raise the HTTP timeout so requests routed through aimock don't time out
    # under normal load.  The default httpx timeout is too short when aimock
    # is proxying to the upstream LLM — observed "Request timed out" errors
    # that crash the agent run and trigger watchdog restarts.
    model=OpenAIChat(id="gpt-4o", timeout=120),
    tools=[
        get_weather,
        query_data,
        manage_sales_todos,
        schedule_meeting,
        change_background,
        book_call,
        generate_task_steps,
        search_flights,
        get_stock_price,
        roll_dice,
        generate_a2ui,
    ],
    # Prevent runaway tool-call loops — same guard as the ag2 package.
    tool_call_limit=15,
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

        BOOK CALL (HITL):
        When the user asks to book a call / schedule an intro / 1:1, call
        book_call with the topic and attendee. The frontend renders a time
        picker; the user's choice is returned as the tool result.

        TASK STEPS (HITL):
        When asked to plan something, use the generate_task_steps tool with a list of steps.
        Each step should have a description and status of "enabled".

        FLIGHT SEARCH:
        Use search_flights when the user asks about flights. Generate 2 realistic flights.

        STOCK PRICES:
        Use get_stock_price when the user asks about a ticker. Consider
        fetching a second related ticker for comparison when helpful.

        DICE:
        Use roll_dice when the user asks to roll a die. Consider rolling a
        second time with a different number of sides for contrast.

        DYNAMIC A2UI:
        Use generate_a2ui when the user asks for a dashboard or dynamic UI.
    """,
)
