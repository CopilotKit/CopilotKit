"""
Workflow graph, state, tools, nodes and edges.

Mirrors the canonical langgraph-python demo so the two stay aligned. The
FastAPI wrapper in main.py imports `graph` from here.
"""

from copilotkit import CopilotKitMiddleware, StateStreamingMiddleware, StateItem
from langchain.agents import create_agent
from langgraph.checkpoint.memory import MemorySaver

from src.model import create_chat_model
from src.query import query_data
from src.todos import AgentState, todo_tools

# Flight data, rendered as generative UI with render_ui
from src.flights import search_flights

# COPILOTKIT_AGENT_MODEL (e.g. "anthropic:claude-sonnet-4-5") overrides this and
# every other model site in the agent; unset, this site uses gpt-6-luna.
model = create_chat_model(
    "openai:gpt-6-luna", model_kwargs={"parallel_tool_calls": False}
)

# FastAPI-specific: langgraph-cli dev supplies its own checkpointer in the
# reference demo. Here we run under uvicorn + ag-ui-langgraph, so the graph
# needs an explicit MemorySaver for state/thread persistence within a
# process.
agent = create_agent(
    model=model,
    tools=[query_data, *todo_tools, search_flights],
    middleware=[
        CopilotKitMiddleware(),
        StateStreamingMiddleware(
            StateItem(state_key="todos", tool="manage_todos", tool_argument="todos")
        ),
    ],
    state_schema=AgentState,
    checkpointer=MemorySaver(),
    system_prompt="""
        You are a polished, professional demo assistant. Keep responses to 1-2 sentences.

        Tool guidance:
        - Flights: call search_flights, then show the flights with render_ui as a Row
          of FlightCard components.
        - Dashboards & rich UI: call render_ui to build dashboards with metrics, charts,
          tables, and cards from the generative UI catalog.
        - Charts: call query_data first, then render with the chart component.
        - Todos: enable app mode first, then manage todos.
        - Generative UI actions: a click on a button you rendered (e.g. selecting a
          flight) arrives as a user message. Respond with a brief confirmation.
    """,
)

graph = agent
