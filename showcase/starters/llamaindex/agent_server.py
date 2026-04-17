"""
Agent Server for LlamaIndex

FastAPI server that hosts the LlamaIndex agent backend.
The Next.js CopilotKit runtime proxies requests here via AG-UI protocol.

LlamaIndex's get_ag_ui_workflow_router() returns a FastAPI APIRouter that
implements the AG-UI protocol, so we just include it directly.
"""

import os
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from agent.agent import agent_router

load_dotenv()

app = FastAPI(title="LlamaIndex Agent Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(agent_router)


@app.get("/health")
async def health():
    return {"status": "ok"}


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
