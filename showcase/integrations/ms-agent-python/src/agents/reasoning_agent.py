"""Reasoning agent — backs `reasoning-default` and `reasoning-custom` cells.

Why this agent uses OpenAIChatClient (Responses API) instead of the
ChatCompletions client used by the other MAF agents in this showcase:
the OpenAI Responses API streams `response.reasoning_summary_text.delta`
items only for native reasoning models (gpt-5, o3, o4-mini, etc.). The
`agent_framework_openai` Responses client translates those into AG-UI
`REASONING_MESSAGE_*` events with `role: "reasoning"`, which the frontend
renders via the built-in `reasoningMessage` slot. Without the Responses
API path, the reasoning slot never lights up — that's the bug the LGP
parity port closes.

Mirrors LangGraph's `langgraph-python/src/agents/reasoning_agent.py`,
which configures `init_chat_model("openai:gpt-5", use_responses_api=True,
reasoning={"effort": "medium", "summary": "detailed"})`.
"""

from __future__ import annotations

import os
from textwrap import dedent

from agent_framework import Agent, BaseChatClient
from agent_framework.openai import OpenAIChatClient
from agent_framework_ag_ui import AgentFrameworkAgent


SYSTEM_PROMPT = dedent(
    """
    You are a helpful assistant. For each user question, first think
    step-by-step about the approach, then give a concise answer.
    """
).strip()


def _build_reasoning_chat_client() -> BaseChatClient:
    """Build a Responses-API chat client for reasoning-event streaming.

    The model env var defaults to `gpt-5` to match the LGP reference; the
    deployment can override via `OPENAI_REASONING_MODEL`.
    """
    return OpenAIChatClient(
        model=os.environ.get("OPENAI_REASONING_MODEL", "gpt-5.4"),
        api_key=os.environ.get("OPENAI_API_KEY"),
    )


def create_reasoning_agent(
    _chat_client_ignored: BaseChatClient | None = None,
) -> AgentFrameworkAgent:
    """Instantiate the reasoning agent.

    The shared `chat_client` from `agent_server.py` is intentionally
    ignored — this cell needs the Responses API specifically.
    """
    base_agent = Agent(
        client=_build_reasoning_chat_client(),
        name="reasoning_agent",
        instructions=SYSTEM_PROMPT,
        tools=[],
    )

    return AgentFrameworkAgent(
        agent=base_agent,
        name="ReasoningAgent",
        description=(
            "Reasoning-token streaming via the OpenAI Responses API. "
            "Drives `reasoning-default` (built-in slot) and "
            "`reasoning-custom` (custom amber ReasoningBlock) demos."
        ),
    )
