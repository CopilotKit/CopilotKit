"""Multimodal LlamaIndex agent — NOT FUNCTIONAL; blocked upstream.

`multimodal` is declared under `not_supported_features` in this integration's
`manifest.yaml` (see the note there). Attachments have never worked here and
this module cannot make them work on its own: the pinned
`llama-index-protocols-ag-ui==0.2.2` adapter
(`llama_index/protocols/ag_ui/utils.py:82-85`) passes an AG-UI `UserMessage`'s
`content` straight into `ChatMessage(...)`. Text-only turns pass a plain string
and work; an attachment turn passes a LIST of AG-UI content-part models, which
pydantic routes into `ChatMessage.blocks` — a union discriminated on
`block_type`, a field AG-UI's `TextInputContent` / `ImageInputContent` /
`BinaryInputContent` do not carry. Every attachment turn therefore fails with
`union_tag_not_found` validation errors before the LLM is ever called.

An earlier version of this docstring claimed the AG-UI router normalized
`{type: "document"}` parts via OpenAI's `input_file` path. It does not — that
claim was wrong. Making this cell work needs a content-part -> LlamaIndex
`TextBlock`/`ImageBlock`/`DocumentBlock` conversion, either upstream or on our
side of `get_ag_ui_workflow_router`.

Kept wired (rather than deleted) so the demo page still renders and the work is
a conversion away. Mirrors `langgraph-python/src/agents/multimodal_agent.py`.
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
