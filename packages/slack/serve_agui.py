"""
Thin AG-UI server for the beautiful_chat showcase graph.

Imports the *unmodified* graph from the copied showcase under ./agent/ and
exposes it over the AG-UI protocol so the Slack bridge's @ag-ui/client
HttpAgent can talk to it directly (no Next.js / CopilotRuntime in between).
"""

import os
import sys
from pathlib import Path

# Make the agent's source importable as if we were running inside ./agent/.
_HERE = Path(__file__).parent
_AGENT_DIR = _HERE / "agent"
sys.path.insert(0, str(_AGENT_DIR))

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Import the unmodified showcase graphs verbatim. beautiful_chat is the
# main demo; interrupt_agent backs the Slack `useInterrupt` flow;
# a2ui_fixed backs the flight-card surface demo.
from src.agents.beautiful_chat import graph
from src.agents.interrupt_agent import graph as interrupt_graph
from src.agents.a2ui_fixed import graph as a2ui_fixed_graph

from langgraph.checkpoint.memory import MemorySaver
from copilotkit import LangGraphAGUIAgent
from ag_ui_langgraph import add_langgraph_fastapi_endpoint

if not hasattr(graph, "checkpointer") or graph.checkpointer is None:
    graph = graph.copy()
    graph.checkpointer = MemorySaver()

# LangGraph `interrupt()` requires a checkpointer to be configured —
# without one, the runtime has nowhere to persist the paused-graph state.
if not hasattr(interrupt_graph, "checkpointer") or interrupt_graph.checkpointer is None:
    interrupt_graph = interrupt_graph.copy()
    interrupt_graph.checkpointer = MemorySaver()

# Same requirement for a2ui_fixed: the LangGraphAGUIAgent reads state via
# `graph.aget_state(config)`, which throws "No checkpointer set" when the
# graph was built without one.
if (
    not hasattr(a2ui_fixed_graph, "checkpointer")
    or a2ui_fixed_graph.checkpointer is None
):
    a2ui_fixed_graph = a2ui_fixed_graph.copy()
    a2ui_fixed_graph.checkpointer = MemorySaver()

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


add_langgraph_fastapi_endpoint(
    app=app,
    agent=LangGraphAGUIAgent(
        name="beautiful_chat",
        description="Beautiful Chat showcase agent",
        graph=graph,
    ),
    path="/",
)

# Second endpoint — the interrupt_agent (schedule_meeting + LangGraph
# `interrupt()`). The Slack bridge points at this URL when testing the
# `useInterrupt` flow; production stays on beautiful_chat at "/".
add_langgraph_fastapi_endpoint(
    app=app,
    agent=LangGraphAGUIAgent(
        name="interrupt_agent",
        description="LangGraph interrupt() showcase agent",
        graph=interrupt_graph,
    ),
    path="/interrupt",
)

# Third endpoint — a2ui_fixed (flight-search surface via A2UI). The
# graph emits a TOOL_CALL_RESULT whose content is the
# `{"a2ui_operations": [...]}` JSON; the bridge wraps its HttpAgent
# with `A2UIMiddleware` from `@ag-ui/a2ui-middleware`, which extracts
# the operations and re-emits them as ActivitySnapshotEvent.
add_langgraph_fastapi_endpoint(
    app=app,
    agent=LangGraphAGUIAgent(
        name="a2ui_fixed",
        description="A2UI fixed-schema flight surface showcase agent",
        graph=a2ui_fixed_graph,
    ),
    path="/a2ui-fixed",
)


if __name__ == "__main__":
    port = int(os.getenv("AGUI_PORT", "8200"))
    uvicorn.run(app, host="0.0.0.0", port=port)
