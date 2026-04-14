"""
Agent Server for AWS Strands

FastAPI server that hosts the Strands agent backend.
The Next.js CopilotKit runtime proxies requests here via AG-UI protocol.
"""

import os
import uvicorn
from dotenv import load_dotenv

from ag_ui_strands import create_strands_app
from agent.agent import agui_agent

load_dotenv()

# Create the FastAPI app from the AG-UI Strands integration
agent_path = os.getenv("AGENT_PATH", "/")
app = create_strands_app(agui_agent, agent_path)


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
        reload=True,
    )


if __name__ == "__main__":
    main()
