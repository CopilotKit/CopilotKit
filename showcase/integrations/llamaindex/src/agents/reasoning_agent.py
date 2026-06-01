"""
Reasoning agent for LlamaIndex.

Shared by `agentic-chat-reasoning` (custom amber ReasoningBlock slot) and
`reasoning-default-render` (CopilotKit's built-in reasoning slot). The agent
is built on the same shared `get_ag_ui_workflow_router` used by the rest of
the package. The system prompt asks the model to think step-by-step before
answering, so the LLM produces reasoning-style prose that the chat UI can
render.

Note: `llama-index-protocols-ag-ui` streams chat deltas as assistant text. If
the underlying OpenAI model emits reasoning tokens via the responses API,
they will surface as REASONING_MESSAGE_* events; otherwise the reasoning
shows up as the first part of the assistant message. Either way the frontend
`CopilotChatReasoningMessage` slot composes with the flow — no custom backend
plumbing is needed for the happy path.
"""

from __future__ import annotations

import os

from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router


SYSTEM_PROMPT = (
    "You are a helpful assistant. For each user question, first think "
    "step-by-step about the approach, then give a concise answer. Keep "
    "responses brief -- 1 to 3 sentences max."
)

_openai_kwargs = {}
if os.environ.get("OPENAI_BASE_URL"):
    _openai_kwargs["api_base"] = os.environ["OPENAI_BASE_URL"]


reasoning_router = get_ag_ui_workflow_router(
    llm=OpenAI(model="gpt-4.1", **_openai_kwargs),
    frontend_tools=[],
    backend_tools=[],
    system_prompt=SYSTEM_PROMPT,
    initial_state={},
)
