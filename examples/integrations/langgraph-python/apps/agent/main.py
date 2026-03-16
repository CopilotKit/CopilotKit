"""
This is the main entry point for the agent.
It defines the workflow graph, state, tools, nodes and edges.
"""

from copilotkit import CopilotKitMiddleware
from langchain.agents import create_agent
from langchain_openai import ChatOpenAI

from src.query import query_data
from src.todos import AgentState, todo_tools
from src.a2ui_fixed_schema import search_flights
from src.a2ui_fixed_schema_streaming import search_flights_streaming
from src.a2ui_dynamic_schema import generate_a2ui

agent = create_agent(
    model="openai:gpt-4.1",
    tools=[query_data, *todo_tools, search_flights, search_flights_streaming, generate_a2ui],
    middleware=[CopilotKitMiddleware()],
    state_schema=AgentState,
    system_prompt="""
        You are a polished, professional demo assistant using CopilotKit and LangGraph. Only mention either when necessary.

        Keep responses brief and polished — 1 to 2 sentences max. No verbose explanations.

        When demonstrating charts, always call the query_data tool to fetch data first.
        When asked to manage todos, enable app mode first, then manage todos.

        When you see a log_a2ui_event tool result indicating a user action like "book_flight",
        respond with a brief confirmation message. The UI updates optimistically on the frontend.

        When asked to generate dynamic/custom UI, call generate_a2ui. It returns
        A2UI operations directly — no need to call send_a2ui_json_to_client afterward.
    """,
)

graph = agent
