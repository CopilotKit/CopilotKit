"""
Tools for the showcase LangGraph agent.
"""

from langchain_core.tools import tool
import random


@tool
def query_data(query: str):
    """
    Query the database. Takes natural language.
    Always call before showing a chart or graph.
    """
    categories = ["Engineering", "Marketing", "Sales", "Support", "Design"]
    return [
        {"category": cat, "value": random.randint(10000, 100000), "quarter": "Q1 2026"}
        for cat in categories
    ]


@tool
def get_weather(location: str):
    """
    Get the current weather for a location.
    """
    conditions = ["Clear skies", "Partly cloudy", "Overcast", "Light rain", "Sunny"]
    return {
        "city": location,
        "temperature": random.randint(10, 35),
        "humidity": random.randint(30, 90),
        "wind_speed": random.randint(5, 25),
        "feels_like": random.randint(8, 37),
        "conditions": random.choice(conditions),
    }
