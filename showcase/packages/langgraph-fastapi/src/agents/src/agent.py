"""
LangGraph agent for the CopilotKit Showcase (FastAPI variant).

Uses langgraph.prebuilt.create_react_agent with langgraph>=1.1.0.
"""

import random

from langgraph.prebuilt import create_react_agent
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool


@tool
def get_weather(location: str):
    """Get the current weather for a location."""
    conditions = ["Clear skies", "Partly cloudy", "Overcast", "Light rain", "Sunny"]
    return {
        "city": location,
        "temperature": random.randint(10, 35),
        "humidity": random.randint(30, 90),
        "wind_speed": random.randint(5, 25),
        "feels_like": random.randint(8, 37),
        "conditions": random.choice(conditions),
    }


@tool
def query_data(query: str):
    """Query the database. Takes natural language. Always call before showing a chart."""
    categories = ["Engineering", "Marketing", "Sales", "Support", "Design"]
    return [
        {"category": cat, "value": random.randint(10000, 100000), "quarter": "Q1 2026"}
        for cat in categories
    ]


model = ChatOpenAI(model="gpt-4o-mini")

graph = create_react_agent(
    model=model,
    tools=[get_weather, query_data],
    prompt="You are a polished, professional demo assistant for CopilotKit. "
    "Keep responses brief and clear -- 1 to 2 sentences max.",
)
