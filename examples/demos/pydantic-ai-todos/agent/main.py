"""
Main entry point for the Todo Agent web server.

This file sets up:
1. Optional Logfire integration for observability
2. The AG-UI web interface (a React-based chat UI for PydanticAI agents)
3. The uvicorn ASGI server
"""

import os
from agent import agent
from models import TodoState
from pydantic_ai.ui import StateDeps
from pydantic_ai.ui.ag_ui import AGUIAdapter
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

# Configure Logfire for agent tracing (optional - only if LOGFIRE_TOKEN is set)
# Logfire provides observability into agent runs, tool calls, and LLM interactions
logfire_token = os.getenv("LOGFIRE_TOKEN")
if logfire_token:
    import logfire

    logfire.configure(token=logfire_token)
    logfire.instrument_pydantic_ai()


async def run_agent(request: Request) -> Response:
    """Serve one AG-UI run. StateDeps wraps our TodoState for AG-UI state management.

    The deps are built fresh on every request: `dispatch_request` writes the state the
    client sent into `deps.state`, so a shared instance leaks todos between concurrent
    requests and users.
    """
    return await AGUIAdapter.dispatch_request(
        request, agent=agent, deps=StateDeps(TodoState())
    )


# AG-UI speaks HTTP: one POST endpoint that streams protocol events back as SSE
app = Starlette(routes=[Route("/", run_agent, methods=["POST"])])

if __name__ == "__main__":
    import uvicorn

    # Enable auto-reload for development (set DEBUG=true in .env)
    enable_auto_reload = os.getenv("DEBUG") == "true"
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=enable_auto_reload)
