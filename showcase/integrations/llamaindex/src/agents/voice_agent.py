"""
Voice agent for LlamaIndex.

The demo is transcription + chat. A fleet of d4 `userMessage: "weather"`
fixtures still win the Tokyo prompt (d4 loads before d6; aimock
toolName gates fail open on this request) and emit `get_weather`.
A tool-free router then either hung (no RUN_FINISHED) or finished
with no TEXT (text-unstable). Register backend `get_weather` so that
leak executes, then loop to the narration fixture.
"""

import json
import os
from typing import Annotated

from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router

from agents.hitl_in_chat_agent import FixedAGUIChatWorkflow
from tools import get_weather_impl


SYSTEM_PROMPT = "You are a helpful, concise assistant."

_openai_kwargs = {}
if os.environ.get("OPENAI_BASE_URL"):
    _openai_kwargs["api_base"] = os.environ["OPENAI_BASE_URL"]


async def get_weather(
    location: Annotated[str, "The location to get the weather for."],
) -> str:
    """Get the weather for a given location."""
    return json.dumps(get_weather_impl(location))


async def _voice_workflow_factory():
    return FixedAGUIChatWorkflow(
        llm=OpenAI(model="gpt-4.1", **_openai_kwargs),
        frontend_tools=[],
        backend_tools=[get_weather],
        system_prompt=SYSTEM_PROMPT,
        initial_state={},
    )


voice_router = get_ag_ui_workflow_router(
    workflow_factory=_voice_workflow_factory,
)
