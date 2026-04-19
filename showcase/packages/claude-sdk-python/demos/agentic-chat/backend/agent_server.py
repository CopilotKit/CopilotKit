"""FastAPI wrapper for this cell's Claude agent.

Exposes the AG-UI protocol on POST / with a /health probe. The Next.js
CopilotKit runtime running in the same container proxies requests here
over localhost:8000.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator

import uvicorn
from agent import run_agent
from ag_ui.core import RunAgentInput
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

load_dotenv()


def create_app() -> FastAPI:
    app = FastAPI(title="Claude Agent SDK (Python) -- per-cell agent")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.post("/")
    async def run_agent_endpoint(request: Request) -> StreamingResponse:
        body = await request.json()
        input_data = RunAgentInput(**body)

        async def event_stream() -> AsyncIterator[str]:
            async for chunk in run_agent(input_data):
                yield chunk

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()


if __name__ == "__main__":
    port = int(os.getenv("AGENT_PORT", "8000"))
    uvicorn.run("agent_server:app", host="0.0.0.0", port=port)
