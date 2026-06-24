"""Run MS Agent Framework agents with request-local instructions.

Agent Framework stores the agent system prompt in ``default_options``. These
showcase agents are mounted as FastAPI singletons, so mutating that shared
dictionary for one request can leak instructions into another concurrent
request. This module keeps the shared agent immutable and overlays
``instructions`` only on the individual ``run`` call.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ag_ui.core import BaseEvent
    from agent_framework_ag_ui import AgentFrameworkAgent
else:
    BaseEvent = Any
    AgentFrameworkAgent = Any


class _InstructionScopedAgent:
    """Proxy an Agent while injecting request-local run options."""

    def __init__(self, agent: Any, instructions: str) -> None:
        self._agent = agent
        self._instructions = instructions

        base_options = getattr(agent, "default_options", None)
        self.default_options = (
            dict(base_options) if isinstance(base_options, dict) else {}
        )
        self.default_options["instructions"] = instructions

        self.id = getattr(agent, "id", None)
        self.name = getattr(agent, "name", None)
        self.description = getattr(agent, "description", None)
        self.client = getattr(agent, "client", None)
        self.mcp_tools = getattr(agent, "mcp_tools", None)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._agent, name)

    def run(self, messages: Any = None, *args: Any, **kwargs: Any) -> Any:
        options = dict(kwargs.get("options") or {})
        options["instructions"] = self._instructions
        kwargs["options"] = options
        return self._agent.run(messages, *args, **kwargs)


async def run_with_request_instructions(
    wrapper: AgentFrameworkAgent,
    input_data: dict[str, Any],
    instructions: str,
) -> AsyncGenerator[BaseEvent, None]:
    """Delegate to ``wrapper`` with instructions scoped to this run only."""
    from agent_framework_ag_ui._agent_run import run_agent_stream  # type: ignore

    scoped_agent = _InstructionScopedAgent(wrapper.agent, instructions)
    async for event in run_agent_stream(
        input_data,
        scoped_agent,
        wrapper.config,
        pending_approvals=wrapper._pending_approvals,
    ):
        yield event
