"""Production-like FastAPI entrypoint for the Cloudplot AG-UI agent."""

from __future__ import annotations

import os

from ag_ui_langgraph import add_langgraph_fastapi_endpoint
from copilotkit import LangGraphAGUIAgent
from fastapi import FastAPI
from fastapi.responses import JSONResponse

from main import graph


def assert_supported_persistence() -> None:
    """Fail if a deploy requests durability this demo does not provide."""

    if os.getenv("CLOUDPLOT_REQUIRE_DURABLE_THREADS") == "1":
        raise RuntimeError(
            "Cloudplot uses process-memory thread state. Durable threads require "
            "an external checkpointer, which is outside this simulation demo's scope."
        )


assert_supported_persistence()

app = FastAPI(title="Cloudplot Agent")


@app.get("/health")
async def health() -> JSONResponse:
    if not os.getenv("OPENAI_API_KEY", "").strip():
        return JSONResponse(
            status_code=503,
            content={
                "status": "not_ready",
                "service": "cloudplot-agent",
                "missing": ["OPENAI_API_KEY"],
            },
        )

    return JSONResponse(
        content={
            "status": "ok",
            "service": "cloudplot-agent",
            "persistence": "process-memory",
        }
    )


add_langgraph_fastapi_endpoint(
    app=app,
    agent=LangGraphAGUIAgent(
        name="cloudplot_agent",
        description="Designs simulated AWS architecture diagrams.",
        graph=graph,
    ),
    path="/",
)
