"""
Simple voice agent for LlamaIndex — no tools.

The voice demo tests transcription and basic chat, not tool execution.
Using a tool-free agent avoids the tool-call loop problem where the backend
agent executes a tool but doesn't loop back to the LLM for a text summary,
resulting in empty assistant responses in the AG-UI stream.
"""

from __future__ import annotations

import os

from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router


SYSTEM_PROMPT = "You are a helpful, concise assistant."

_openai_kwargs = {}
if os.environ.get("OPENAI_BASE_URL"):
    _openai_kwargs["api_base"] = os.environ["OPENAI_BASE_URL"]


voice_router = get_ag_ui_workflow_router(
    llm=OpenAI(model="gpt-4.1", **_openai_kwargs),
    frontend_tools=[],
    backend_tools=[],
    system_prompt=SYSTEM_PROMPT,
    initial_state={},
)
