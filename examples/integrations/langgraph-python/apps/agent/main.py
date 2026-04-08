"""
This is the main entry point for the agent.
It defines the workflow graph, state, tools, nodes and edges.
"""

from copilotkit import CopilotKitMiddleware
from langchain.agents import create_agent

# Data & state tools
from src.query import query_data
from src.todos import AgentState, todo_tools

# A2UI tools (three approaches to agent-driven UI)
from src.a2ui_fixed_schema import search_flights
from src.a2ui_fixed_schema_streaming import search_flights_streaming
from src.a2ui_dynamic_schema import generate_a2ui

agent = create_agent(
    model="openai:gpt-4.1",
    tools=[query_data, *todo_tools, search_flights, search_flights_streaming, generate_a2ui],
    middleware=[CopilotKitMiddleware()],
    state_schema=AgentState,
    system_prompt="""
        You are a polished, professional demo assistant. Keep responses to 1-2 sentences.

        Tool guidance:
        - Charts: call query_data first, then render with the chart component.
        - Todos: enable app mode first, then manage todos.
        - A2UI actions: when you see a log_a2ui_event result (e.g. "book_flight"),
          respond with a brief confirmation. The UI already updated on the frontend.
        - Dynamic UI: call generate_a2ui directly. It handles rendering on its own.
    """,
)

graph = agent
