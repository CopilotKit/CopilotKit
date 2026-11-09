"""Claude Agent SDK (Python) starter — AG-UI server.

Serves the agent (defined in ``src/agent.py``) over AG-UI using the official
adapter's FastAPI helper: ``POST /`` streams the run, ``GET /health`` reports
status. Runs on uvicorn (port 8000).
"""

from __future__ import annotations

import os

from fastapi import FastAPI
from ag_ui_claude_sdk import add_claude_fastapi_endpoint

from src.agent import adapter

app = FastAPI(title="Claude Agent SDK (Python) Starter")
# The adapter's helper mounts POST / (streams the run) — the runtime connects here.
add_claude_fastapi_endpoint(app, adapter)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("AGENT_PORT", "8000")))
