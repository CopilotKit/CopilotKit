"""FastAPI wrapper hosting the Shared State (Reading) ADK agent over AG-UI."""

from __future__ import annotations

import os
import uvicorn
from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from agent import shared_state_read_agent

load_dotenv()

app = FastAPI(title="Google ADK — Shared State (Reading) cell")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

adk_agent = ADKAgent(
    adk_agent=shared_state_read_agent,
    user_id="demo_user",
    session_timeout_seconds=3600,
    use_in_memory_services=True,
)

add_adk_fastapi_endpoint(app, adk_agent, path="/")


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("agent_server:app", host="0.0.0.0", port=port)
