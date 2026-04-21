"""
This is the main entry point for the agent.
It defines the workflow graph, state, tools, nodes and edges.
"""

from copilotkit import CopilotKitMiddleware
from langchain.agents import create_agent

# Data & state tools
from src.query import query_data
from src.todos import AgentState, todo_tools

agent = create_agent(
    model="openai:gpt-4.1",
    tools=[query_data, *todo_tools],
    middleware=[CopilotKitMiddleware()],
    state_schema=AgentState,
    system_prompt="""
        You are a polished, professional demo assistant. Keep responses to 1-2 sentences.

        Tool guidance:
        - Charts: call query_data first, then render with the chart component.
        - Todos: enable app mode first, then manage todos.
    """,
)

graph = agent
