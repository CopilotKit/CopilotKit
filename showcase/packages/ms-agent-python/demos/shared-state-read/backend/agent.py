"""MS Agent Framework (Python) agent backing the Shared State (Read) cell.

Minimal agent; the frontend reads/writes a recipe via the agent's shared
state. State schema describes the recipe.
"""

from __future__ import annotations

import os
from textwrap import dedent

import uvicorn
from agent_framework import Agent, BaseChatClient
from agent_framework.openai import OpenAIChatClient
from agent_framework_ag_ui import AgentFrameworkAgent, add_agent_framework_fastapi_endpoint
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()


def _build_chat_client() -> BaseChatClient:
    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY environment variable is required")
    return OpenAIChatClient(
        model=os.getenv("OPENAI_CHAT_MODEL_ID", "gpt-4o-mini"),
        api_key=os.getenv("OPENAI_API_KEY"),
    )


def _create_agent() -> AgentFrameworkAgent:
    base_agent = Agent(
        client=_build_chat_client(),
        name="shared_state_read",
        instructions=dedent(
            """
            You help the user improve their recipe. Read the current recipe from
            the shared state and propose improvements through conversation.
            """
        ).strip(),
        tools=[],
    )
    return AgentFrameworkAgent(
        agent=base_agent,
        name="CopilotKitMicrosoftAgentFrameworkAgent",
        description="Recipe-improvement agent with shared state.",
        require_confirmation=False,
    )


app = FastAPI(title="CopilotKit × MS Agent Framework — shared-state-read cell")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
add_agent_framework_fastapi_endpoint(app=app, agent=_create_agent(), path="/")


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run("agent:app", host="0.0.0.0", port=int(os.getenv("AGENT_PORT", "8000")))
