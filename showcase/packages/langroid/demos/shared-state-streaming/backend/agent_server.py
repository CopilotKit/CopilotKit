"""FastAPI server exposing the Langroid agent via AG-UI SSE.

The Next.js CopilotKit runtime proxies requests here via HttpAgent.
"""

from __future__ import annotations

import os
import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from agui_adapter import handle_run

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
    return await handle_run(request)


@app.get("/health")
async def health():
    return {"status": "ok"}


def main():
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("agent_server:app", host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
