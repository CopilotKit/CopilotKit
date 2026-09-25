"""
This is the main entry point for the agent.
It defines the workflow graph, state, tools, nodes and edges.
"""

from copilotkit import CopilotKitMiddleware, StateStreamingMiddleware, StateItem
from langchain.agents import create_agent

# Data & state tools
from src.query import query_data
from src.todos import AgentState, todo_tools

# A2UI tools
from src.a2ui_dynamic_schema import generate_a2ui
from src.a2ui_fixed_schema import search_flights

from langchain_openai import ChatOpenAI

model = ChatOpenAI(model="gpt-5.4-mini", model_kwargs={"parallel_tool_calls": False})

SYSTEM_PROMPT = """
        You are a polished, professional demo assistant. Keep responses to 1-2 sentences.

        Tool guidance:
        - Flights: call search_flights to show flight cards with a pre-built schema.
        - Dashboards & rich UI: call generate_a2ui to create dashboard UIs with metrics,
          charts, tables, and cards. It handles rendering automatically.
        - Charts: call query_data first, then render with the chart component.
        - Todos: enable app mode first, then manage todos.
        - Diagrams (Excalidraw): call `create_view` ONCE with 3-5 shapes and arrows.
          Give each shape and arrow a unique string `id`, and every shape a plain `label`
          with text. Connect shapes with arrows. Include ONE `cameraUpdate` at the END of
          the elements array, do not call `read_me` or refine the diagram, then reply with
          ONE short sentence describing what you drew.
        - A2UI actions: when you see a log_a2ui_event result (e.g. "view_details"),
          respond with a brief confirmation. The UI already updated on the frontend.
    """

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
    system_prompt=SYSTEM_PROMPT,
)

graph = agent
