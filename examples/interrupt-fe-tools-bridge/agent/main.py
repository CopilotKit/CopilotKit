"""Minimal agent for testing CopilotKitMiddleware(interrupt_frontend_tools=True).

Backend tool: get_time. Frontend tools (registered by the page): show_graph,
confirm_action. Each frontend call pauses on its own interrupt; the client
resumes with the result and the agent continues in the same turn.
"""

import os
from datetime import datetime, timezone

import uvicorn
from ag_ui_langgraph import add_langgraph_fastapi_endpoint
from fastapi import FastAPI
from langchain.agents import create_agent
from langchain_anthropic import ChatAnthropic
from langchain_core.tools import tool
from langgraph.checkpoint.memory import InMemorySaver

from copilotkit import CopilotKitMiddleware, LangGraphAGUIAgent


@tool
def get_time() -> str:
    """Get the current UTC time."""
    return datetime.now(timezone.utc).isoformat()


graph = create_agent(
    model=ChatAnthropic(model=os.getenv("MODEL", "claude-sonnet-5")),
    tools=[get_time],
    # The new setup, part 1: pause each frontend tool call on its own interrupt.
    middleware=[CopilotKitMiddleware(interrupt_frontend_tools=True)],
    checkpointer=InMemorySaver(),
    system_prompt=(
        "You are a test assistant. Use show_graph to chart numbers and "
        "confirm_action before doing anything the user must approve. "
        "When asked, call several tools in one turn."
    ),
)

app = FastAPI()
add_langgraph_fastapi_endpoint(
    app=app,
    agent=LangGraphAGUIAgent(
        name="default",
        graph=graph,
        # Part 2: standard AG-UI interrupts, so parallel calls resume by id.
        emit_interrupt_outcome=True,
    ),
    path="/",
)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8123")))
