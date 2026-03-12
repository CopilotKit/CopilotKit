# agent.py
import os
import sys
import warnings
from pydantic.warnings import UnsupportedFieldAttributeWarning
warnings.filterwarnings("ignore", category=UnsupportedFieldAttributeWarning)

# LOCAL_COPILOTKIT=1 → use CopilotKit Python SDK from local source (mirrors vite.config.ts)
if os.environ.get("LOCAL_COPILOTKIT"):
    _sdk_path = os.path.join(os.path.dirname(__file__), "..", "..", "CopilotKit", "sdk-python")
    _sdk_path = os.path.normpath(_sdk_path)
    if os.path.isdir(_sdk_path):
        sys.path.insert(0, _sdk_path)
        print(f"\n  🔗 LOCAL_COPILOTKIT mode — using CopilotKit Python SDK from {_sdk_path}\n")
    else:
        print(f"\n  ⚠️  LOCAL_COPILOTKIT set but SDK not found at {_sdk_path}\n")

from dotenv import load_dotenv
from deepagents import create_deep_agent
from copilotkit import CopilotKitMiddleware, LangGraphAGUIAgent
from langgraph.checkpoint.memory import MemorySaver
from langchain.tools import tool

load_dotenv()

# Canvas tools — these are frontend tools intercepted by CopilotKitMiddleware.
# The Python stubs exist so the LLM sees them in its tool list.

@tool
def canvas_markdown(content: str):
    """Add a markdown text section to the report canvas. Use this for paragraphs, headings, lists, and any formatted text."""
    return "Markdown section added."

@tool
def canvas_chart(title: str, chartType: str, labels: list[str], values: list[float]):
    """Add a chart to the report canvas. chartType must be one of: bar, line, pie."""
    return "Chart added."

@tool
def canvas_table(title: str, headers: list[str], rows: list[list[str]]):
    """Add a data table to the report canvas."""
    return "Table added."

@tool
def canvas_code(language: str, code: str, filename: str = ""):
    """Add a code block to the report canvas."""
    return "Code block added."

@tool
def canvas_clear():
    """Clear the report canvas to start a fresh report."""
    return "Canvas cleared."

@tool
def search_web(query: str):
    """Searches the web for information."""
    return f"Results for {query}: [Mock Data] CopilotKit is a framework for building AI copilots..."

@tool
def select_research_angle(topic: str, options: list[str]):
    """Present 2-3 research angles for a topic and let the user choose which direction to explore.
    Pass the topic as a string and the options as an array of strings."""
    return "Research angle presented to user."

@tool
def confirm_report(summary: str):
    """Show a summary of the research findings and ask the user to approve before writing to the canvas.
    The summary should briefly describe what will be published."""
    return "Report approved by user. Proceed with writing to canvas."

canvas_tools = [canvas_markdown, canvas_chart, canvas_table, canvas_code, canvas_clear]
standard_tools = canvas_tools + [search_web]
hitl_tools = standard_tools + [select_research_angle, confirm_report]

# --- Agent 1: Standard research agent (no HITL) ---
agent = create_deep_agent(
    model="openai:gpt-5-mini",
    tools=standard_tools,
    middleware=[CopilotKitMiddleware()],
    checkpointer=MemorySaver(),
    system_prompt="""
    You are a research assistant that builds rich, visual reports.

    ALWAYS use the canvas tools to write your findings so the user can see them:
    - canvas_markdown: for text sections (headings, paragraphs, lists)
    - canvas_chart: for data visualizations (bar, line, pie charts)
    - canvas_table: for structured data comparisons
    - canvas_code: for code examples or technical snippets
    - canvas_clear: to start a fresh report

    Build the report incrementally — add sections one at a time as you research.
    Use charts and tables when presenting comparative or numerical data.
    Don't just chat; build the report using these tools.
    """
)

# --- Agent 2: HITL research agent ---
# All three HITL tools use interrupt_on so the frontend can render approval UI
# before the tool executes. The React client uses useLangGraphInterrupt to
# catch each interrupt and render the appropriate UI.
agent_hitl = create_deep_agent(
    model="openai:gpt-5-mini",
    tools=hitl_tools,
    middleware=[CopilotKitMiddleware()],
    checkpointer=MemorySaver(),
    interrupt_on={"search_web": True, "select_research_angle": True, "confirm_report": True},
    system_prompt="""
    You are a research assistant that builds rich, visual reports.
    You work collaboratively with the user through a human-in-the-loop workflow.

    WORKFLOW:
    1. When the user asks you to research a topic, FIRST use the select_research_angle
       tool to present 2-3 research angles. Pass the topic as a string and the options
       as an array of strings, e.g. options=["angle 1", "angle 2", "angle 3"].
       The user will choose one — the tool response tells you which angle was selected.
    2. Then search the web — the user will be asked to approve each search query
       before it executes.
    3. After gathering findings, use the confirm_report tool to show a brief summary
       and get the user's approval before writing to the canvas.
    4. Once approved, use the canvas tools to build the report.

    IMPORTANT: When select_research_angle is rejected, the rejection message contains
    the user's chosen angle (e.g. "User selected research angle: ..."). Treat this as
    the user's choice and proceed accordingly — it is NOT an error.

    CANVAS TOOLS:
    - canvas_markdown: for text sections (headings, paragraphs, lists)
    - canvas_chart: for data visualizations (bar, line, pie charts)
    - canvas_table: for structured data comparisons
    - canvas_code: for code examples or technical snippets
    - canvas_clear: to start a fresh report

    Build the report incrementally — add sections one at a time.
    Use charts and tables when presenting comparative or numerical data.
    ALWAYS follow the human-in-the-loop workflow above.
    """
)

# Serve both agents via AG-UI protocol on the same FastAPI app
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from ag_ui_langgraph import add_langgraph_fastapi_endpoint

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

add_langgraph_fastapi_endpoint(
    app,
    LangGraphAGUIAgent(
        name="research_agent",
        description="A deep research agent that writes rich visual reports.",
        graph=agent,
        config={"recursion_limit": 1000},
    ),
    "/",
)

add_langgraph_fastapi_endpoint(
    app,
    LangGraphAGUIAgent(
        name="research_agent_hitl",
        description="A deep research agent with human-in-the-loop approval workflows.",
        graph=agent_hitl,
        config={"recursion_limit": 1000},
    ),
    "/hitl",
)

# --- Auto-discover and mount ticket-specific agents ---
import importlib
from pathlib import Path

tickets_dir = Path(__file__).parent / "tickets"
if tickets_dir.is_dir():
    for ticket_pkg in sorted(tickets_dir.iterdir()):
        if not ticket_pkg.is_dir() or ticket_pkg.name.startswith("_"):
            continue
        module_name = ticket_pkg.name  # e.g. "tkt_869"
        ticket_id = module_name.replace("_", "-")  # e.g. "tkt-869"
        try:
            mod = importlib.import_module(f"tickets.{module_name}")
            app.mount(f"/tickets/{ticket_id}", mod.app)
            print(f"[tickets] mounted /tickets/{ticket_id}")
        except Exception as e:
            print(f"[tickets] failed to mount {module_name}: {e}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "agent:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        reload_dirs=["."],
    )
