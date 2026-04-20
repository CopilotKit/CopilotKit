"""FastAPI server for the Strands / Agentic Chat cell.

Wraps the per-cell Strands agent in the AG-UI protocol so the Next.js
CopilotKit runtime can proxy requests to it.
"""

import os
import uvicorn
from dotenv import load_dotenv

from ag_ui_strands import create_strands_app
from agents.agent import agui_agent

load_dotenv()

agent_path = os.getenv("AGENT_PATH", "/")
app = create_strands_app(agui_agent, agent_path)


@app.get("/health")
async def health():
    return {"status": "ok"}


def main():
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(
        "agent_server:app",
        host="0.0.0.0",
        port=port,
        reload=False,
    )


if __name__ == "__main__":
    main()
