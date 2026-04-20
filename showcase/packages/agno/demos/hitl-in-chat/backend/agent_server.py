"""Agno agent backing the Human-in-the-Loop demo.

Exposes a single Agno Agent through AgentOS + AGUI on :8000/agui.

The generate_task_steps tool is external_execution — the frontend renders
an approval UI and resolves the tool call when the user confirms.
"""

from __future__ import annotations

import os

import dotenv
from agno.agent.agent import Agent
from agno.models.openai import OpenAIChat
from agno.os import AgentOS
from agno.os.interfaces.agui import AGUI
from agno.tools import tool

dotenv.load_dotenv()


@tool(external_execution=True)
def generate_task_steps(steps: list[dict]):
    """Generate a list of steps for the user to review and approve.

    Args:
        steps: Step objects, each with 'description' (str) and
               'status' ('enabled' | 'disabled').
    """


agent = Agent(
    name="human_in_the_loop",
    model=OpenAIChat(id="gpt-4o-mini"),
    tools=[generate_task_steps],
    description="You are a planner assistant.",
    instructions=(
        "When the user asks you to plan something, call generate_task_steps "
        "with a list of step objects. Each step should have a 'description' "
        "and a 'status' of 'enabled'. Wait for the user's approval before "
        "continuing."
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
