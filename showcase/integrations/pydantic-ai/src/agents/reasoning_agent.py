"""Reasoning-capable PydanticAI agent for the reasoning family of demos.

Backs two showcase cells:
    - agentic-chat-reasoning       (custom amber ReasoningBlock slot)
    - reasoning-default-render     (CopilotKit's built-in reasoning card)

Mirrors `showcase/integrations/langgraph-python/src/agents/reasoning_agent.py`
(shared across reasoning demos there).

Why a reasoning model:
PydanticAI's AG-UI bridge surfaces reasoning summaries from
``OpenAIResponsesModel`` as ``THINKING_*`` / ``REASONING_*`` events on the
AG-UI stream when the underlying OpenAI Responses API returns reasoning
items. The Responses API only returns reasoning content for native
reasoning models such as gpt-6-luna. These demos explicitly request summaries
so the frontend receives the reasoning events it renders.

Model choice:
``gpt-6-luna`` is the team default for reasoning-bearing showcase cells. It is
a reasoning-capable model available through the Responses API and emits
reasoning summaries that the AG-UI bridge translates to
THINKING events.
"""

from __future__ import annotations

import os
from textwrap import dedent

from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIResponsesModel
from pydantic_ai.models.openai import OpenAIResponsesModelSettings


SYSTEM_PROMPT = dedent(
    """
    You are a helpful assistant. For each user question, first think
    step-by-step about the approach, then give a concise answer.

    Keep thinking concise — two to four short steps is plenty for most
    questions. Do not repeat the final answer inside the reasoning block.
    """
).strip()


# Auto-summary so the Responses API surfaces reasoning content as
# reasoning items (which the AG-UI bridge then forwards as THINKING /
# REASONING events). Without a summary the API can omit the reasoning
# payload from the streamed response.
_REASONING_MODEL = os.environ.get("REASONING_MODEL", "gpt-6-luna")

agent = Agent(
    model=OpenAIResponsesModel(_REASONING_MODEL),
    model_settings=OpenAIResponsesModelSettings(
        openai_reasoning_summary="auto",
    ),
    system_prompt=SYSTEM_PROMPT,
)
