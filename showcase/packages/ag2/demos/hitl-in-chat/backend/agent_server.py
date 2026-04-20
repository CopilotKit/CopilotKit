"""FastAPI wrapper that hosts the AG2 agent via AG-UI.

The Next.js CopilotKit runtime proxies requests here via AG-UI
protocol. Mirrors the single-cell convention used across the
per-cell Docker containers.
"""

import os
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from agent import stream

load_dotenv()

app = FastAPI(title="AG2 Agentic Chat Agent")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


# Mount AG-UI endpoint at root. Must come AFTER route definitions —
# app.mount("/") shadows all routes defined after it.
app.mount("/", stream.build_asgi())


def main():
    port = int(os.getenv("AGENT_PORT", "8000"))
    uvicorn.run(
        "agent_server:app",
        host="0.0.0.0",
        port=port,
        reload=False,
    )


if __name__ == "__main__":
    main()
