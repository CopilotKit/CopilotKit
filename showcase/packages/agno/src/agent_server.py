"""
Agent Server for Agno

Uses AgentOS with the AG-UI interface to serve the Agno agent.
The Next.js CopilotKit runtime proxies requests here via AG-UI protocol.
"""

import os
import dotenv
from agno.os import AgentOS
from agno.os.interfaces.agui import AGUI
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from agents.main import agent

dotenv.load_dotenv()

# Build AgentOS and extract the app for serving
agent_os = AgentOS(agents=[agent], interfaces=[AGUI(agent=agent)])
app = agent_os.get_app()


# Serve /health via middleware so it short-circuits BEFORE route resolution.
# AgentOS mounts its own endpoints on `app`, some of which can register a
# catch-all at "/" (depending on version / interface). Middleware guarantees
# /health reaches the Next.js /api/health probe regardless of how AgentOS
# wires its routes.
class HealthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.url.path == "/health" and request.method == "GET":
            return JSONResponse({"status": "ok"})
        return await call_next(request)


app.add_middleware(HealthMiddleware)


def main():
    """Run the uvicorn server."""
    port = int(os.getenv("PORT", "8000"))
    agent_os.serve(app="agent_server:app", host="0.0.0.0", port=port, reload=True)


if __name__ == "__main__":
    main()
