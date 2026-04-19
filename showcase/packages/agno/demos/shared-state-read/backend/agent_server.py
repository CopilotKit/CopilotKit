"""Agno agent backing the Shared State (Reading) demo.

The frontend owns a recipe object in shared state; the agent reads from it
and suggests improvements.
"""

from __future__ import annotations

import os

import dotenv
from agno.agent.agent import Agent
from agno.models.openai import OpenAIChat
from agno.os import AgentOS
from agno.os.interfaces.agui import AGUI

dotenv.load_dotenv()


agent = Agent(
    name="shared_state_read",
    model=OpenAIChat(id="gpt-4o-mini"),
    tools=[],
    description="You are a helpful recipe improvement assistant.",
    instructions=(
        "The user shares a recipe (title, skill_level, cooking_time, "
        "ingredients, instructions) via agent state. Read the current state, "
        "propose improvements conversationally, and update it when asked."
    ),
)

agent_os = AgentOS(agents=[agent], interfaces=[AGUI(agent=agent)])
app = agent_os.get_app()


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8000"))
    agent_os.serve(app="agent_server:app", host="0.0.0.0", port=port)
