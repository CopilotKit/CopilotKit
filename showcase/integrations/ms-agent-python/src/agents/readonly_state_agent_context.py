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

from collections.abc import AsyncGenerator
from textwrap import dedent
from typing import Any

from ag_ui.core import BaseEvent
from agent_framework import Agent, BaseChatClient
from agent_framework_ag_ui import AgentFrameworkAgent
from agents._request_scoped_instructions import run_with_request_instructions


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


def build_context_system_message(context: Any) -> str | None:
    """Format frontend-provided AG-UI context as a model-visible message."""
    if not isinstance(context, list) or len(context) == 0:
        return None

    lines: list[str] = ["## Context from the application"]
    for entry in context:
        if not isinstance(entry, dict):
            continue

        description = entry.get("description")
        value = entry.get("value")
        if description is None or value is None:
            continue

        lines.append("")
        lines.append(str(description))
        lines.append(str(value))

    if len(lines) == 1:
        return None

    return "\n".join(lines)


class ReadonlyContextFrameworkAgent(AgentFrameworkAgent):
    """AgentFrameworkAgent that forwards `useAgentContext` to the model.

    LangGraph gets this behavior from CopilotKitMiddleware. The MS Agent
    adapter receives the AG-UI `context` entries in `input_data`, so this
    shim appends them to request-local instructions before delegating to the
    standard Agent Framework runner. The wrapped singleton agent is never
    mutated.
    """

    async def run(  # type: ignore[override]
        self,
        input_data: dict[str, Any],
    ) -> AsyncGenerator[BaseEvent, None]:
        context_prompt = build_context_system_message(input_data.get("context"))
        if not context_prompt:
            async for event in super().run(input_data):
                yield event
            return

        async for event in run_with_request_instructions(
            self, input_data, f"{SYSTEM_PROMPT}\n\n{context_prompt}"
        ):
            yield event


def create_readonly_state_agent_context(
    chat_client: BaseChatClient,
) -> ReadonlyContextFrameworkAgent:
    """Instantiate the readonly-state-agent-context MAF agent."""
    base_agent = Agent(
        client=chat_client,
        name="readonly_state_agent_context",
        instructions=SYSTEM_PROMPT,
        tools=[],
    )

    return ReadonlyContextFrameworkAgent(
        agent=base_agent,
        name="ReadOnlyStateAgentContext",
        description=(
            "Reads frontend-provided `useAgentContext` entries on every "
            "turn; no tools, no custom state."
        ),
    )
