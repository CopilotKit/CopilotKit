"""Thin Agno agent for the Beautiful Chat demo.

LGP keeps frontend chart / theme / meeting tools on the page. Agno only
forwards a tool call when the name is on the agent, so those four names
are declared external_execution. search_flights stays a backend tool so
the already-green search-flights cell keeps working after the path move.
"""

import json

from agno.agent.agent import Agent
from agno.models.openai import OpenAIChat
from agno.tools import tool
from dotenv import load_dotenv

from tools import search_flights_impl
from tools.types import Flight

load_dotenv()


@tool(external_execution=True)
def barChart(title: str, description: str = "", data: list = None):
    """Display data as a bar chart.

    Args:
        title (str): Chart title.
        description (str): Brief subtitle.
        data (list): [{label, value}, ...].
    """


@tool(external_execution=True)
def pieChart(title: str, description: str = "", data: list = None):
    """Display data as a pie chart.

    Args:
        title (str): Chart title.
        description (str): Brief subtitle.
        data (list): [{label, value}, ...].
    """


@tool(external_execution=True, external_execution_silent=True)
def scheduleTime(reasonForScheduling: str, meetingDuration: int = 30):
    """Ask the user to pick a meeting time.

    Args:
        reasonForScheduling (str): Very brief reason.
        meetingDuration (int): Duration in minutes.
    """


@tool(external_execution=True)
def toggleTheme():
    """Toggle the app theme between light and dark."""


@tool
def search_flights(flights: list[dict]):
    """Search for flights and display the results as rich cards.

    Args:
        flights (list): Two flight objects.

    Returns:
        str: A2UI operations as JSON.
    """
    typed_flights = [Flight(**f) for f in flights]
    return json.dumps(search_flights_impl(typed_flights))


agent = Agent(
    model=OpenAIChat(id="gpt-4o", timeout=120),
    tools=[barChart, pieChart, scheduleTime, toggleTheme, search_flights],
    tool_call_limit=8,
    description="You are a polished, professional demo assistant.",
    instructions="""
        Keep replies to 1-2 sentences.
        Charts: call barChart or pieChart with title, description, and data.
        Meetings: call scheduleTime.
        Theme: call toggleTheme.
        Flights: call search_flights with exactly 2 flights.
        Do not call query_data for these chart probes.
    """,
)
