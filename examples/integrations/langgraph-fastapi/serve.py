"""
Thin wrapper to serve the LangGraph agent via AG-UI protocol.
Used in Docker where the full pyproject.toml dependency chain (which pulls
ExecutionInfo conflicts) is bypassed with --no-deps installs.
The original main.py, agent code, and pyproject.toml remain unmodified.
"""
import os
import sys

# Add the agent directory to the path so "from src.agent import graph" works
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "agent"))

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Import the original graph from the unmodified agent code
from src.agent import graph

# Use copilotkit's LangGraphAGUIAgent to serve via AG-UI
from copilotkit import LangGraphAGUIAgent
from ag_ui_langgraph import add_langgraph_fastapi_endpoint

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
        name="sample_agent",
        description="LangGraph FastAPI starter agent",
        graph=graph,
    ),
    path="/",
)

if __name__ == "__main__":
    port = int(os.getenv("AGENT_PORT", "8123"))
    uvicorn.run(app, host="0.0.0.0", port=port)
