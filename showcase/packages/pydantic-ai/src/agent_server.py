"""
Agent Server for PydanticAI

FastAPI server that hosts the PydanticAI agent backend.
The Next.js CopilotKit runtime proxies requests here via AG-UI protocol.
"""

import os
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from agents.agent import SalesTodosState, StateDeps, agent

load_dotenv()

app = FastAPI(title="PydanticAI Agent Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Health endpoint MUST be registered BEFORE app.mount("/") — mount creates a catch-all
@app.get("/health")
async def health():
    return {"status": "ok"}

# Mount the PydanticAI AG-UI endpoint at the root
ag_ui_app = agent.to_ag_ui(deps=StateDeps(SalesTodosState()))
app.mount("/", ag_ui_app)


def main():
    """Run the uvicorn server."""
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(
        "agent_server:app",
        host="0.0.0.0",
        port=port,
        reload=True,
    )


if __name__ == "__main__":
    main()
