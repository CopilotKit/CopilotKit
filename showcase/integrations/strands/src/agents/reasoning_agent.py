"""Reasoning agent — backs `reasoning-default` and `reasoning-custom` cells.

Mirrors LangGraph Python's
``showcase/integrations/langgraph-python/src/agents/reasoning_agent.py``.

Why a reasoning model:
CopilotKit's frontend lights the ``reasoningMessage`` slot only when the
AG-UI stream carries ``REASONING_MESSAGE_*`` events. ``ag_ui_strands``
already maps Strands ``reasoningText`` stream events onto those AG-UI
events (see ``ag_ui_strands.agent``). Strands' ``OpenAIModel`` in turn
emits ``reasoningContent`` deltas when the Chat Completions stream
carries ``choice.delta.reasoning_content``.

B6/B8 note — Responses API gap:
LGP uses ``init_chat_model(..., use_responses_api=True,
reasoning={"effort": "medium", "summary": "detailed"})`` so the OpenAI
Responses API streams ``response.reasoning_summary_text.delta`` items.
Strands ``OpenAIModel`` only speaks Chat Completions
(``client.chat.completions.create``) and has no Responses-API path.
Closest LGP-compatible behavior we can ship today:

  * Pin a native reasoning model via ``OPENAI_REASONING_MODEL``
    (default ``gpt-5.5``).
  * Pass ``reasoning_effort=medium`` through ``OpenAIModel.params`` so
    providers that honor it on Chat Completions will emit
    ``delta.reasoning_content``.
  * Rely on ag_ui_strands' existing ``reasoningText`` →
    ``REASONING_MESSAGE_*`` bridge (no custom event synthesis needed
    when the model streams reasoning content).

If aimock fixtures or live OpenAI never emit ``delta.reasoning_content``
on Chat Completions for the chosen model, the reasoning slot stays dark
until either (a) Strands gains a Responses-API OpenAI provider, or
(b) B8 adds a prompt-tag / synthetic REASONING_MESSAGE_* fallback (the
Agno showcase path). Wiring of this factory into agent_server mounts
lands in the wire-server (B6) slot.

Aimock header forwarding is handled globally by
``agents._header_forwarding`` (installed in ``agent_server.py``) — same
as every other dedicated Strands agent; nothing extra is needed here.
"""

from __future__ import annotations

import os

from strands import Agent
from strands.models.openai import OpenAIModel
from ag_ui_strands import StrandsAgent

SYSTEM_PROMPT = (
    "You are a helpful assistant. For each user question, first think "
    "step-by-step about the approach, then give a concise answer."
)

# Prefer a native reasoning model. Env override lets CI / aimock pin a
# fixture-friendly id without code changes. Default matches the task /
# Claude.md OpenAI model policy (gpt-5.5 — never gpt-4o).
REASONING_MODEL = os.environ.get("OPENAI_REASONING_MODEL", "gpt-5.5")


def _build_reasoning_model() -> OpenAIModel:
    """Build an OpenAI model configured for reasoning-token streaming.

    Uses Chat Completions (the only path Strands OpenAIModel supports).
    See module docstring for the Responses API gap vs LGP.
    """
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY must be set for the strands reasoning agent")
    return OpenAIModel(
        client_args={"api_key": api_key},
        model_id=REASONING_MODEL,
        # Forwarded into chat.completions.create(**request). Providers /
        # models that support reasoning on Chat Completions may stream
        # delta.reasoning_content when effort is set.
        params={"reasoning_effort": "medium"},
    )


def build_reasoning_agent() -> StrandsAgent:
    """Construct a pure-reasoning StrandsAgent (no backend tools).

    Backs:
      * reasoning-default  — built-in CopilotChatReasoningMessage slot
      * reasoning-custom   — custom amber ReasoningBlock slot
      * agentic-chat-reasoning (same pure-reasoning surface)
    """
    strands_agent = Agent(
        model=_build_reasoning_model(),
        system_prompt=SYSTEM_PROMPT,
        tools=[],
    )

    return StrandsAgent(
        agent=strands_agent,
        name="reasoning_agent",
        description=(
            "Reasoning-token streaming via a native reasoning model. "
            "Drives reasoning-default (built-in slot) and reasoning-custom "
            "(custom amber ReasoningBlock) demos."
        ),
    )
