"""FastAPI server exposing one AG-UI agent for the /declarative demo.

  POST /declarative/  - stocks dashboard agent (A2UI surfaces)

Run with:  uvicorn main:app --port 8123 --reload
"""
from __future__ import annotations

import os

import uvicorn
from ag_ui_langgraph import add_langgraph_fastapi_endpoint
from copilotkit import LangGraphAGUIAgent
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

from src.stocks_agent import graph as stocks_graph  # noqa: E402

app = FastAPI(title="Agent Design System · Python Agents")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_AGENT_CONFIG = {"recursion_limit": 50}

add_langgraph_fastapi_endpoint(
    app=app,
    agent=LangGraphAGUIAgent(
        name="declarative",
        description="Stocks dashboard agent. Emits A2UI surfaces.",
        graph=stocks_graph,
        config=_AGENT_CONFIG,
    ),
    path="/declarative",
)


@app.get("/")
def root():
    return {"ok": True, "agents": {"declarative": "/declarative/"}}


def main():
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "8123")),
        reload=True,
    )


if __name__ == "__main__":
    main()
