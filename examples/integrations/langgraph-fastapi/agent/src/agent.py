"""
Workflow graph, state, tools, nodes and edges.

Mirrors the canonical langgraph-python demo so the two stay aligned. The
FastAPI wrapper in main.py imports `graph` from here.
"""

from copilotkit import CopilotKitMiddleware, StateStreamingMiddleware, StateItem
from langchain.agents import create_agent
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver

from src.a2ui_dynamic_schema import generate_a2ui
from src.a2ui_fixed_schema import search_flights
from src.query import query_data
from src.todos import AgentState, todo_tools

model = ChatOpenAI(model="gpt-5.4", model_kwargs={"parallel_tool_calls": False})

# FastAPI-specific: langgraph-cli dev supplies its own checkpointer in the
# reference demo. Here we run under uvicorn + ag-ui-langgraph, so the graph
# needs an explicit MemorySaver for state/thread persistence within a
# process.
agent = create_agent(
    model=model,
    tools=[query_data, *todo_tools, generate_a2ui, search_flights],
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
        - Flights: call search_flights to show flight cards with a pre-built schema.
        - Dashboards & rich UI: call generate_a2ui to create dashboard UIs with metrics,
          charts, tables, and cards. It handles rendering automatically.
        - Charts: call query_data first, then render with the chart component.
        - Todos: enable app mode first, then manage todos.
        - A2UI actions: when you see a log_a2ui_event result (e.g. "view_details"),
          respond with a brief confirmation. The UI already updated on the frontend.
    """,
)

graph = agent
