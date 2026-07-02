"""Reasoning agent — emits AG-UI REASONING_MESSAGE_* events.

Shared by agentic-chat-reasoning (custom amber ReasoningBlock) and
reasoning-default-render (CopilotKit's built-in reasoning slot).

Why a reasoning model + Responses API:
The OpenAI Responses API streams `response.reasoning_summary_text.delta`
items only for native reasoning models (gpt-5, o3, o4-mini, etc.).
CopilotKit's bridge translates those into AG-UI REASONING_MESSAGE_*
events with `role: "reasoning"`, which the frontend renders via the
`reasoningMessage` slot. gpt-4o / gpt-4o-mini do not emit reasoning
items, so a non-reasoning model would never light up the slot.
"""

from __future__ import annotations

import os

from deepagents import create_deep_agent
from langchain.chat_models import init_chat_model

# @doc-replace
from src.agents.src._header_forwarding_middleware import HeaderForwardingMiddleware
# @doc-as
# @doc-end

SYSTEM_PROMPT = (
    "You are a helpful assistant. For each user question, first think "
    "step-by-step about the approach, then give a concise answer."
)

REASONING_MODEL = os.environ.get("OPENAI_REASONING_MODEL", "gpt-5-mini")

# No full CopilotKitMiddleware — this demo exercises only reasoning-token
# streaming through the OpenAI Responses API and doesn't consume frontend
# tools or app context.
# @doc-replace
graph = create_deep_agent(
    model=init_chat_model(
        f"openai:{REASONING_MODEL}",
        use_responses_api=True,
        reasoning={"effort": "low", "summary": "auto"},
    ),
    tools=[],
    system_prompt=SYSTEM_PROMPT,
    middleware=[HeaderForwardingMiddleware()],
)
# @doc-as
# graph = create_deep_agent(
#     model=init_chat_model(
#         f"openai:{REASONING_MODEL}",
#         use_responses_api=True,
#         reasoning={"effort": "low", "summary": "auto"},
#     ),
#     tools=[],
#     system_prompt=SYSTEM_PROMPT,
# )
# @doc-end
