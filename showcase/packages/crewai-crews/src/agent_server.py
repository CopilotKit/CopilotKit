"""
Agent Server for CrewAI (Crews)

FastAPI server that hosts the CrewAI crew backend.
The Next.js CopilotKit runtime proxies requests here via AG-UI protocol.
"""

import os

# HARDENING: CrewAI's ChatWithCrewFlow.__init__ (in ag_ui_crewai.crews) makes
# blocking synchronous LLM calls via generate_crew_chat_inputs, which in turn
# calls generate_input_description_with_ai and generate_crew_description_with_ai
# from crewai.cli.crew_chat. In ag-ui-crewai <= 0.1.5 this happens at module
# import time inside add_crewai_crew_fastapi_endpoint, BEFORE uvicorn binds its
# port. Any LLM hiccup (aimock regression, OpenAI outage, network blip) will
# crash the Python process before the HTTP server is listening, which causes
# Railway/Kubernetes/ECS health checks to fail and deploys to roll back.
#
# Patch both functions to return static strings. The AI-generated descriptions
# are only cosmetic for the CrewAI chat UI (which the CopilotKit runtime does
# not use), so static defaults are functionally equivalent for our showcase.
#
# Upstream fix (deferred construction to first request) landed on ag-ui main
# but is not yet released. Remove this shim once ag-ui-crewai > 0.1.5 ships.
from crewai.cli import crew_chat as _crewai_crew_chat


def _static_input_description(input_name, *_args, **_kwargs):
    return f"Input value for '{input_name}'."


def _static_crew_description(*_args, **_kwargs):
    return "A CrewAI crew."


_crewai_crew_chat.generate_input_description_with_ai = _static_input_description
_crewai_crew_chat.generate_crew_description_with_ai = _static_crew_description

import uvicorn
from ag_ui_crewai.endpoint import add_crewai_crew_fastapi_endpoint
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from agents.crew import LatestAiDevelopment

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
