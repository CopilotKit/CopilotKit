"""The Claude Agent SDK agent — backend tools + the official AG-UI adapter.

Three backend tools live in their own modules (``src/query.py``,
``src/a2ui_fixed_schema.py``, ``src/a2ui_dynamic_schema.py``). The official
``ClaudeAgentAdapter`` does everything else: it drives Claude via the Claude
Agent SDK, bridges CopilotKit frontend tools + human-in-the-loop, and manages
the shared ``todos`` state via its built-in ``ag_ui_update_state`` tool.
"""

from __future__ import annotations

from pathlib import Path
from textwrap import dedent

from dotenv import load_dotenv
from ag_ui_claude_sdk import ClaudeAgentAdapter
from claude_agent_sdk import create_sdk_mcp_server

from src.model import resolve_model
from src.query import query_data
from src.a2ui_fixed_schema import search_flights
from src.a2ui_dynamic_schema import generate_a2ui

# Load .env from the starter root before building the adapter (which reads the
# model from the environment); fall back to the current working directory.
for _env in (Path(__file__).resolve().parents[2] / ".env", Path(".env")):
    if _env.is_file():
        load_dotenv(_env)
        break
else:
    load_dotenv()

SYSTEM_PROMPT = dedent(
    """
    You are a polished, professional demo assistant. Keep responses to 1-2 sentences.

    - Flights: call search_flights to show flight cards.
    - Dashboards: call generate_a2ui to build a rich dashboard UI; it renders itself.
    - Charts: call query_data first, then render with the chart component.
    - Todos: the todo board is shared state under `todos`; call ag_ui_update_state
      with the COMPLETE list to add or change todos.
    """
).strip()

# The Claude Agent SDK exposes custom tools through an in-process MCP server
# (create_sdk_mcp_server). The model calls them as mcp__<server>__<tool>, and
# `allowed_tools` pre-approves those names so they run without a permission prompt.
# (`tools` is a different field — Claude Code's BUILT-IN toolset; `[]` disables it
# so the model only uses ours + the AG-UI protocol tools.)
SERVER_NAME = "copilotkit"
BACKEND_TOOLS = [query_data, search_flights, generate_a2ui]

adapter = ClaudeAgentAdapter(
    name="claude-sdk-python",
    description="CopilotKit × Claude Agent SDK (Python) starter",
    options={
        "model": resolve_model(),
        "system_prompt": SYSTEM_PROMPT,
        "mcp_servers": {
            SERVER_NAME: create_sdk_mcp_server(
                SERVER_NAME, "1.0.0", tools=BACKEND_TOOLS
            ),
        },
        "allowed_tools": [f"mcp__{SERVER_NAME}__{tool.name}" for tool in BACKEND_TOOLS],
        "tools": [],
    },
)
