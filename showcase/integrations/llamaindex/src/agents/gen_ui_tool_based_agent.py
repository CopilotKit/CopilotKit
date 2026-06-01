"""LlamaIndex agent for the Tool-Based Generative UI demo.

The frontend registers `render_bar_chart` and `render_pie_chart` tools via
`useComponent`. The AG-UI protocol forwards those tool definitions to the
agent at request time, so the backend agent itself declares no bespoke
tools — the LLM sees the frontend tools through the AG-UI request payload
and picks one to call when the user asks for a chart.

Mirrors `langgraph-python/src/agents/gen_ui_tool_based.py`.
"""

from __future__ import annotations

import os

from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router


SYSTEM_PROMPT = """You are a data visualization and creative assistant.

When the user asks for a chart, call `render_bar_chart` or `render_pie_chart`
with a concise title, short description, and a `data` array of
`{label, value}` items. Pick bar for comparisons over a small set of
categories; pick pie for composition / share-of-whole.

When the user asks for a haiku, call `generate_haiku` with the Japanese
text, English translation, an image name, and a gradient color.

Keep chat responses brief -- let the visual output do the talking."""


_openai_kwargs = {}
if os.environ.get("OPENAI_BASE_URL"):
    _openai_kwargs["api_base"] = os.environ["OPENAI_BASE_URL"]

gen_ui_tool_based_router = get_ag_ui_workflow_router(
    llm=OpenAI(model="gpt-4o-mini", **_openai_kwargs),
    frontend_tools=[],
    backend_tools=[],
    system_prompt=SYSTEM_PROMPT,
    initial_state={},
)
