"""MS Agent Framework (Python) agent backing the Tool-Based Gen UI cell.

No backend tools — the frontend registers `generate_haiku` via useFrontendTool
and the agent invokes it through AG-UI.
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
        name="gen_ui_tool_based",
        instructions=dedent(
            """
            You are a haiku-crafting assistant. When the user asks for a haiku, call
            the frontend-provided `generate_haiku` tool with Japanese and English
            lines, an image_name from the provided list, and a CSS gradient. The
            frontend will render the haiku card.
            """
        ).strip(),
        tools=[],
    )
    return AgentFrameworkAgent(
        agent=base_agent,
        name="CopilotKitMicrosoftAgentFrameworkAgent",
        description="Haiku-generating agent with frontend-rendered cards.",
        require_confirmation=False,
    )


app = FastAPI(title="CopilotKit × MS Agent Framework — gen-ui-tool-based cell")
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
