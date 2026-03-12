"""
This is the main entry point for the agent.
It defines the workflow graph, state, tools, nodes and edges.
"""

from copilotkit import CopilotKitMiddleware
from langchain.agents import create_agent
from langchain_openai import ChatOpenAI

from src.query import query_data
from src.todos import AgentState, todo_tools
from src.form import generate_form

agent = create_agent(
    model="openai:gpt-4.1",
    tools=[query_data, *todo_tools, generate_form],
    middleware=[CopilotKitMiddleware()],
    state_schema=AgentState,
    system_prompt="""
        You are a polished demo assistant showcasing CopilotKit + LangGraph capabilities.

        Keep responses brief and polished — 1 to 2 sentences max. No verbose explanations.
        Guide the user through a coherent journey of CopilotKit features when they follow suggestions.

        When demonstrating charts, always call the query_data tool to fetch data first.
        When asked to manage tasks, enable app mode first, then manage todos.
    """,
)

graph = agent
