"""Serves the ADK agent over AG-UI at http://localhost:8000/.

uv run server.py
"""

import os

import uvicorn
from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint
from fastapi import FastAPI

from agent import root_agent

adk_agent = ADKAgent(
    adk_agent=root_agent,
    app_name="a2ui_adk",
    user_id="demo",
    # One ADK session per AG-UI thread.
    use_thread_id_as_session_id=True,
)

app = FastAPI(title="A2UI ADK agent")
add_adk_fastapi_endpoint(app, adk_agent, path="/")

if __name__ == "__main__":
    uvicorn.run(
        app, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "8000"))
    )
