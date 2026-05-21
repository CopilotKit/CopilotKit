"""readonly-state-agent-context — minimal MAF agent for `useAgentContext`.

Mirrors LangGraph's
`langgraph-python/src/agents/readonly_state_agent_context.py`. Demonstrates
the `useAgentContext` hook from `@copilotkit/react-core/v2`: the frontend
provides read-only context *to* the agent (e.g. user name, timezone,
recent activity). The agent reads that context on every turn and
incorporates it into its response. No custom state, no tools — the
minimal shape of the useAgentContext pattern.
"""

from __future__ import annotations

from textwrap import dedent

from agent_framework import Agent, BaseChatClient
from agent_framework_ag_ui import AgentFrameworkAgent


SYSTEM_PROMPT = dedent(
    """
    You are a helpful, concise assistant. The frontend may provide
    read-only context about the user (e.g. name, timezone, recent
    activity) via the `useAgentContext` hook. Always consult that
    context when it is relevant — address the user by name if known,
    respect their timezone when mentioning times, and reference recent
    activity when it helps you answer. Keep responses short.
    """
).strip()


def create_readonly_state_agent_context(
    chat_client: BaseChatClient,
) -> AgentFrameworkAgent:
    """Instantiate the readonly-state-agent-context MAF agent."""
    base_agent = Agent(
        client=chat_client,
        name="readonly_state_agent_context",
        instructions=SYSTEM_PROMPT,
        tools=[],
    )

    return AgentFrameworkAgent(
        agent=base_agent,
        name="ReadOnlyStateAgentContext",
        description=(
            "Reads frontend-provided `useAgentContext` entries on every "
            "turn; no tools, no custom state."
        ),
    )
