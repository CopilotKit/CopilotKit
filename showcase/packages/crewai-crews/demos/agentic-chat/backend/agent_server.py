"""Agent server for the CrewAI (Crews) × Agentic Chat cell.

Hosts a single CrewAI crew and exposes it via the AG-UI HTTP protocol so
the Next.js CopilotKit runtime can proxy /api/copilotkit requests to it.
"""

import logging
import os

# ---------------------------------------------------------------------------
# HARDENING: defer blocking LLM calls that ag_ui_crewai <= 0.1.5 makes at
# import time (see upstream issue crewAIInc/crewAI#5510). Replace the two
# description generators with static strings before any import of
# ag_ui_crewai.endpoint. Without this, any LLM hiccup crashes the process
# BEFORE uvicorn binds its port, causing health-check rollbacks.
# ---------------------------------------------------------------------------
from crewai.cli import crew_chat as _crewai_crew_chat

for _attr in ("generate_input_description_with_ai", "generate_crew_description_with_ai"):
    if not hasattr(_crewai_crew_chat, _attr):
        raise RuntimeError(
            f"crewai upstream drift: crewai.cli.crew_chat.{_attr} no longer exists. "
            "The import-time hardening shim in agent_server.py would silently no-op."
        )


def _static_input_description(input_name, *_a, **_kw):
    return f"Input value for '{input_name}'."


def _static_crew_description(*_a, **_kw):
    return "A CrewAI crew."


_crewai_crew_chat.generate_input_description_with_ai = _static_input_description
_crewai_crew_chat.generate_crew_description_with_ai = _static_crew_description

import uvicorn
from ag_ui_crewai.endpoint import add_crewai_crew_fastapi_endpoint
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from crew import AgenticChatCrew

load_dotenv()

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="CrewAI × Agentic Chat")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

add_crewai_crew_fastapi_endpoint(app, AgenticChatCrew(), "/")


@app.get("/health")
async def health():
    return {"status": "ok"}


def main():
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("agent_server:app", host="0.0.0.0", port=port, reload=False)


if __name__ == "__main__":
    main()
