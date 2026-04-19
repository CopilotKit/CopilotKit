"""Agno agent backing the Agentic Generative UI demo.

Emits a plan as a sequence of tool calls. The frontend reads the shared
agent state and renders a progress UI.
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


@tool
def plan_steps(steps: list[dict]):
    """Produce a plan as a list of steps.

    Args:
        steps: Step objects, each with 'description' (str) and
               'status' ('pending' | 'completed').
    """
    return {"steps": steps}


agent = Agent(
    name="gen_ui_agent",
    model=OpenAIChat(id="gpt-4o-mini"),
    tools=[plan_steps],
    description="You are a planning assistant.",
    instructions=(
        "When the user asks you to plan something, call plan_steps with a "
        "complete list of steps. Each step should have 'description' and "
        "a 'status' of 'pending' (or 'completed' once done)."
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
