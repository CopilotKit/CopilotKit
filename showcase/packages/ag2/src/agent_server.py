"""
Agent Server for AG2

FastAPI server that hosts the AG2 agent backend.
The Next.js CopilotKit runtime proxies requests here via AG-UI protocol.
"""

import os
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from dotenv import load_dotenv

from agents.agent import stream

load_dotenv()

app = FastAPI(title="AG2 Agent Server")


# Serve /health via middleware so it short-circuits BEFORE route resolution.
# A plain `@app.get("/health")` decorator is shadowed by the subsequent
# `app.mount("/", ...)` call: Starlette's Mount at "/" matches every path
# (including /health) and the decorated route never fires. Middleware runs
# above the routing layer, so the health endpoint stays reachable regardless
# of what the framework-specific AG-UI adapter mounts at root.
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


# Mount the AG2 AG-UI endpoint at the root.
# `app.mount("/", ...)` is a catch-all Mount that shadows any later route
# decorators, which is why /health is served by HealthMiddleware above
# rather than a `@app.get("/health")` handler registered here.
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
