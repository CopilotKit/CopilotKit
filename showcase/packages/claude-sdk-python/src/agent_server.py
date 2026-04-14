"""
Agent Server for Claude Agent SDK (Python)

FastAPI server that hosts the Claude agent backend via AG-UI protocol.
The Next.js CopilotKit runtime proxies requests here.
"""

import os

import uvicorn
from agents.agent import create_app
from dotenv import load_dotenv

load_dotenv()

app = create_app()


def main() -> None:
    """Run the uvicorn server."""
    port = int(os.getenv("AGENT_PORT", "8000"))
    uvicorn.run("agent_server:app", host="0.0.0.0", port=port, reload=True)


if __name__ == "__main__":
    main()
