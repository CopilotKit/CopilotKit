"""MS Agent Framework (Python) agent backing the Agentic Gen UI cell.

Minimal agent that chats; the demo exercises shared state (steps) between
agent and frontend. The agent produces a plan and the frontend renders a
TaskProgress component that reflects agent state as it streams.
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


STATE_SCHEMA: dict[str, object] = {
    "steps": {
        "type": "array",
        "items": {
            "type": "object",
            "properties": {
                "description": {"type": "string"},
                "status": {"type": "string"},
            },
        },
        "description": "Ordered list of plan steps with status.",
    }
}


def _create_agent() -> AgentFrameworkAgent:
    base_agent = Agent(
        client=_build_chat_client(),
        name="gen_ui_agent",
        instructions=dedent(
            """
            You are a planner. When the user asks for a plan, produce a list of
            steps. Keep your textual response brief; the frontend renders a rich
            TaskProgress UI from the shared state.
            """
        ).strip(),
        tools=[],
    )
    return AgentFrameworkAgent(
        agent=base_agent,
        name="CopilotKitMicrosoftAgentFrameworkAgent",
        description="Plan-producing agent with visible task progress UI.",
        require_confirmation=False,
    )


app = FastAPI(title="CopilotKit × MS Agent Framework — gen-ui-agent cell")
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
