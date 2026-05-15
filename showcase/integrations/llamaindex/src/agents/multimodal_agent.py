"""Multimodal LlamaIndex agent — accepts image + document (PDF) attachments.

Vision-capable router scoped to the `/demos/multimodal` cell. Uses gpt-4o so
image content parts are consumed natively. PDF documents forwarded as
`{type: "document"}` content parts are passed through to the underlying
LLM; the LlamaIndex AG-UI router normalizes them via the OpenAI `input_file`
path when running against gpt-4o.

Mirrors `langgraph-python/src/agents/multimodal_agent.py`.
"""

from __future__ import annotations

import os

from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router


SYSTEM_PROMPT = (
    "You are a helpful assistant. The user may attach images or documents "
    "(PDFs). When they do, analyze the attachment carefully and answer the "
    "user's question. If no attachment is present, answer the text question "
    "normally. Keep responses concise (1-3 sentences) unless asked to go deep."
)

_openai_kwargs = {}
if os.environ.get("OPENAI_BASE_URL"):
    _openai_kwargs["api_base"] = os.environ["OPENAI_BASE_URL"]


multimodal_router = get_ag_ui_workflow_router(
    llm=OpenAI(model="gpt-4o", temperature=0.2, **_openai_kwargs),
    frontend_tools=[],
    backend_tools=[],
    system_prompt=SYSTEM_PROMPT,
    initial_state={},
)
