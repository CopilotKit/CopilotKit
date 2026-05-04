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
from pydantic_ai.ag_ui import StateDeps

# Configure Logfire for agent tracing (optional - only if LOGFIRE_TOKEN is set)
# Logfire provides observability into agent runs, tool calls, and LLM interactions
logfire_token = os.getenv("LOGFIRE_TOKEN")
if logfire_token:
    import logfire
    logfire.configure(token=logfire_token)
    logfire.instrument_pydantic_ai()

# Convert PydanticAI agent to AG-UI compatible ASGI app
# AG-UI provides a web interface for chatting with the agent
# StateDeps wraps our TodoState to make it compatible with AG-UI's state management
app = agent.to_ag_ui(deps=StateDeps(TodoState()))

if __name__ == "__main__":
    import uvicorn
    # Enable auto-reload for development (set DEBUG=true in .env)
    enable_auto_reload = os.getenv("DEBUG") == "true"
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=enable_auto_reload)
