"""Reasoning agent: emits AG-UI REASONING_MESSAGE_* events.

Shared by reasoning-default (CopilotKit's built-in reasoning slot) and
reasoning-custom (a custom amber ReasoningBlock).

Why a reasoning model plus the Responses API: the OpenAI Responses API streams
`response.reasoning_summary_text.delta` items only for native reasoning models
(gpt-5, o3, o4-mini and friends). The Strands bridge translates those into
AG-UI REASONING_MESSAGE_* events with `role: "reasoning"`, which the frontend
renders through the `reasoningMessage` slot. gpt-4o emits no reasoning items, so
the showcase's default chat-completions model would never light the slot up.

`summary: "detailed"` rather than `"auto"` is deliberate: with `"auto"` the
model decides, and it frequently skips the summary entirely, which leaves the
reasoning slot unmounted.

Mirrors `langgraph-python/src/agents/reasoning_agent.py`.
"""

from __future__ import annotations

import os

from strands import Agent
from ag_ui_strands import StrandsAgent

SYSTEM_PROMPT = (
    "You are a helpful assistant. For each user question, first think "
    "step-by-step about the approach, then give a concise answer."
)

REASONING_MODEL = os.environ.get("OPENAI_REASONING_MODEL", "gpt-5.4")


def build_reasoning_model():
    """Construct the Responses-API model that streams reasoning summaries.

    Imported inside the factory: `OpenAIResponsesModel` requires openai>=2, and
    an import at module scope would take the whole agent server down on an
    older install rather than failing only the reasoning demos.
    """
    from strands.models.openai_responses import OpenAIResponsesModel

    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY must be set for the strands showcase agent")
    return OpenAIResponsesModel(
        client_args={"api_key": api_key},
        model_id=REASONING_MODEL,
        params={"reasoning": {"effort": "medium", "summary": "detailed"}},
    )


def build_reasoning_agent() -> StrandsAgent:
    """Construct the tool-free StrandsAgent backing both reasoning demos."""
    strands_agent = Agent(
        model=build_reasoning_model(),
        system_prompt=SYSTEM_PROMPT,
        tools=[],
    )
    return StrandsAgent(
        agent=strands_agent,
        name="reasoning",
        description="Strands agent that streams reasoning summaries alongside its answer",
    )
