"""FastAPI server exposing the per-cell LlamaIndex AG-UI agent.

The Next.js CopilotKit runtime proxies requests here via the AG-UI protocol.
"""

import os
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from agent import agent_router

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
    )


if __name__ == "__main__":
    main()
