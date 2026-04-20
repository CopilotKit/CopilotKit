"""Agno agent backing the Tool-Based Generative UI demo.

The generate_haiku tool is a frontend tool registered on the client via
useFrontendTool. The backend agent just emits the tool call; the UI
renders it.
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
    name="gen_ui_tool_based",
    model=OpenAIChat(id="gpt-4o-mini"),
    tools=[],
    description="You are a haiku generator that renders results as rich UI.",
    instructions=(
        "When asked to write a haiku, call the generate_haiku frontend tool "
        "with 3 Japanese lines, their English translations, an "
        "image_name from the provided list, and a CSS gradient. Prefer "
        "CSS gradients that suit the theme."
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
