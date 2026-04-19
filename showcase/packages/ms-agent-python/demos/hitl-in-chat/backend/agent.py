"""MS Agent Framework (Python) agent backing the Human-in-the-Loop cell.

The agent exposes a `generate_task_steps` tool that asks the frontend to
review/approve a list of steps. The frontend uses `useHumanInTheLoop` to
render an approval UI and respond to the tool call.
"""

from __future__ import annotations

import os
from textwrap import dedent
from typing import Annotated

import uvicorn
from agent_framework import Agent, BaseChatClient, tool
from agent_framework.openai import OpenAIChatClient
from agent_framework_ag_ui import AgentFrameworkAgent, add_agent_framework_fastapi_endpoint
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import Field

load_dotenv()


@tool(
    name="generate_task_steps",
    description=(
        "Generate a list of steps for the user to perform. Each step must have a "
        "description and a status of 'enabled', 'disabled', or 'executing'."
    ),
)
def generate_task_steps(
    steps: Annotated[
        list[dict],
        Field(description="List of step objects with description and status fields."),
    ],
) -> str:
    """Return the step list; actual approval happens on the frontend."""
    return f"Proposed {len(steps)} steps for user review."


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
        name="human_in_the_loop",
        instructions=dedent(
            """
            You help the user by proposing a list of steps for them to approve. Always
            call `generate_task_steps` with the full list; the user will review, toggle,
            and confirm which steps to execute. Each step must include a `description`
            and a `status` of `enabled`, `disabled`, or `executing`. Start all proposed
            steps as `enabled`.
            """
        ).strip(),
        tools=[generate_task_steps],
    )
    return AgentFrameworkAgent(
        agent=base_agent,
        name="CopilotKitMicrosoftAgentFrameworkAgent",
        description="Proposes task steps for human-in-the-loop approval.",
        require_confirmation=False,
    )


app = FastAPI(title="CopilotKit × MS Agent Framework — hitl cell")
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
