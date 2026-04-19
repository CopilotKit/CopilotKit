"""Agno agent backing the State Streaming demo.

Minimal chat agent — placeholder while the frontend demo is fleshed out.
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
    name="shared_state_streaming",
    model=OpenAIChat(id="gpt-4o-mini"),
    tools=[],
    description="You are a helpful assistant that streams state updates.",
    instructions="Keep responses concise.",
)

agent_os = AgentOS(agents=[agent], interfaces=[AGUI(agent=agent)])
app = agent_os.get_app()


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8000"))
    agent_os.serve(app="agent_server:app", host="0.0.0.0", port=port)
