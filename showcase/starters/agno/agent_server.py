"""
Agent Server for Agno

Uses AgentOS with the AG-UI interface to serve the Agno agent.
The Next.js CopilotKit runtime proxies requests here via AG-UI protocol.
"""

import os
import dotenv
from agno.os import AgentOS
from agno.os.interfaces.agui import AGUI

from agent.main import agent

dotenv.load_dotenv()

# Build AgentOS and extract the app for serving
agent_os = AgentOS(agents=[agent], interfaces=[AGUI(agent=agent)])
app = agent_os.get_app()


@app.get("/health")
async def health():
    return {"status": "ok"}


def main():
    """Run the uvicorn server."""
    port = int(os.getenv("PORT", "8000"))
    agent_os.serve(app="agent_server:app", host="0.0.0.0", port=port, reload=True)


if __name__ == "__main__":
    main()
