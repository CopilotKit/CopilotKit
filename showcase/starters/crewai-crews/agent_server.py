"""
Agent Server for CrewAI (Crews)

FastAPI server that hosts the CrewAI crew backend.
The Next.js CopilotKit runtime proxies requests here via AG-UI protocol.
"""

import os
import uvicorn
from ag_ui_crewai.endpoint import add_crewai_crew_fastapi_endpoint
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from agent.crew import LatestAiDevelopment

load_dotenv()

app = FastAPI(title="CrewAI (Crews) Agent Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

add_crewai_crew_fastapi_endpoint(app, LatestAiDevelopment(), "/")


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
