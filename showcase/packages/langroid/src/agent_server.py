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
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from dotenv import load_dotenv

from agents.agui_adapter import handle_run

load_dotenv()

app = FastAPI(title="Langroid Agent Server")


# Serve /health via middleware so it short-circuits BEFORE route resolution.
# Applied uniformly across every showcase FastAPI agent server so /health
# remains reachable even if future changes introduce a catch-all mount at "/".
class HealthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.url.path == "/health" and request.method == "GET":
            return JSONResponse({"status": "ok"})
        return await call_next(request)


app.add_middleware(HealthMiddleware)

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
