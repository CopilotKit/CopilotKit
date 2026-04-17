"""
Agent Server for Langroid

FastAPI server that hosts the Langroid agent backend.
The Next.js CopilotKit runtime proxies requests here via AG-UI protocol.

Langroid does not have a native AG-UI adapter, so we implement a custom
SSE endpoint that translates between Langroid's ChatAgent and the AG-UI
event stream.
"""

import os
import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from agent.agui_adapter import handle_run

load_dotenv()

app = FastAPI(title="Langroid Agent Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/")
async def run_agent(request: Request):
    """AG-UI /run endpoint — streams SSE events."""
    return await handle_run(request)


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
