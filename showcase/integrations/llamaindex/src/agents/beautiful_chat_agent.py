"""LlamaIndex agent backing the Beautiful Chat demo.

This is a polished starter chat — a basic agentic-chat agent with a friendly
system prompt and the same backend tools as the canonical shared agent
(weather, simple chat). The frontend wraps it with brand styling, suggestion
pills, and a side canvas — see src/app/demos/beautiful-chat/page.tsx.

Mirrors `langgraph-python/src/agents/beautiful_chat.py` but in simplified
form (the LangGraph version bundles a full A2UI catalog, MCP wiring, and
shared-state todos; this LlamaIndex port keeps the surface focused on the
"polished agentic chat starter" use case).
"""

from __future__ import annotations

import json
import os
from typing import Annotated

from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router

from tools import get_weather_impl


async def get_weather(
    location: Annotated[str, "The location to get the weather for."],
) -> str:
    """Get the weather for a given location."""
    return json.dumps(get_weather_impl(location))


SYSTEM_PROMPT = """You are a polished, friendly demo assistant powering the
"Beautiful Chat" showcase. You are deliberately concise — keep answers to
1-2 sentences when possible.

You can:
- Chat naturally with the user
- Get weather for a location via the get_weather tool

Be warm, pithy, and helpful. Avoid filler — let the chat surface itself
do the talking."""


_openai_kwargs = {}
if os.environ.get("OPENAI_BASE_URL"):
    _openai_kwargs["api_base"] = os.environ["OPENAI_BASE_URL"]

beautiful_chat_router = get_ag_ui_workflow_router(
    llm=OpenAI(model="gpt-4o-mini", **_openai_kwargs),
    frontend_tools=[],
    backend_tools=[get_weather],
    system_prompt=SYSTEM_PROMPT,
    initial_state={},
)
