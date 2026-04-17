"""
Agent Server for AG2

FastAPI server that hosts the AG2 agent backend.
The Next.js CopilotKit runtime proxies requests here via AG-UI protocol.
"""

import os
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from agent.agent import stream

load_dotenv()

app = FastAPI(title="AG2 Agent Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


# Mount the AG2 AG-UI endpoint at the root
# NOTE: must come AFTER route definitions — app.mount("/") shadows all routes defined after it
app.mount("/", stream.build_asgi())


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
