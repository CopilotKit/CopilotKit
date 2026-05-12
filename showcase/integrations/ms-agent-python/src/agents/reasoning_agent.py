"""
MS Agent Framework — reasoning demo agent.

Shared by two demos:
  - agentic-chat-reasoning      — custom rendered reasoning block
  - reasoning-default-render    — default rendering of reasoning content

Approach
--------
Routes through ``OpenAIChatClient`` (Responses API) on a reasoning-capable
model (``gpt-5.2``) with ``reasoning={"effort":"medium","summary":"detailed"}``.
The agent-framework AG-UI bridge converts the streamed reasoning summaries
into first-class ``REASONING_MESSAGE_*`` events, which CopilotKit renders
via its built-in ``CopilotChatReasoningMessage`` slot (default) or a custom
``messageView.reasoningMessage`` slot override (custom variant).

No tool plumbing required — the model emits reasoning content natively.
"""

from __future__ import annotations

from textwrap import dedent

from agent_framework import Agent, BaseChatClient
from agent_framework_ag_ui import AgentFrameworkAgent


def create_reasoning_agent(chat_client: BaseChatClient) -> AgentFrameworkAgent:
    """Create the MS Agent Framework reasoning demo agent.

    The ``chat_client`` MUST point at a reasoning-capable model (gpt-5*,
    o3, o4-mini, …). ``OpenAIChatClient`` (Responses API) is required —
    ``OpenAIChatCompletionClient`` does NOT surface reasoning content
    against vanilla OpenAI.
    """
    base_agent = Agent(
        client=chat_client,
        name="reasoning_agent",
        instructions=dedent(
            """
            You are a helpful assistant. For each user question, think
            step-by-step about the approach, then give a clear, concise
            final answer. Keep the final answer short (1-3 short
            paragraphs).
            """
        ).strip(),
        # Per OpenAIChatOptions (agent_framework_openai/_chat_client.py).
        # `effort: "medium"` balances depth vs. latency; `summary: "detailed"`
        # is required for the reasoning summary text to be visible in the
        # stream (`"auto"` may collapse it).
        # See: https://platform.openai.com/docs/guides/reasoning
        default_options={
            "reasoning": {"effort": "medium", "summary": "detailed"},
        },
    )

    return AgentFrameworkAgent(
        agent=base_agent,
        name="CopilotKitMicrosoftAgentFrameworkReasoningAgent",
        description=(
            "Streams real REASONING_MESSAGE_* events via gpt-5.2 + Responses API."
        ),
        require_confirmation=False,
    )
