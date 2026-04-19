"""Reasoning agent — minimal deep agent showcase.

Shared by agentic-chat-reasoning (custom amber ReasoningBlock) and
reasoning-default-render (CopilotKit's built-in reasoning slot).
"""

from __future__ import annotations

from deepagents import create_deep_agent
from langchain.chat_models import init_chat_model

SYSTEM_PROMPT = (
    "You are a helpful assistant. For each user question, first think "
    "step-by-step about the approach, then give a concise answer."
)

graph = create_deep_agent(
    model=init_chat_model(
        "openai:gpt-4o-mini", temperature=0, use_responses_api=False
    ),
    tools=[],
    system_prompt=SYSTEM_PROMPT,
)
