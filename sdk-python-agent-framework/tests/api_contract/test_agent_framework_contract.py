from __future__ import annotations

import importlib.metadata
import inspect

from agent_framework import BaseAgent, ContextProvider, SessionContext


class _NoOpProvider(ContextProvider):
    def __init__(self) -> None:
        super().__init__(source_id="contract-probe")

    async def before_run(self, *, agent, session, context, state) -> None:
        del agent, session, state
        context.extend_instructions(self.source_id, "probe")


def test_native_context_provider_registration_contract() -> None:
    version = importlib.metadata.version("agent-framework-core")
    signature = inspect.signature(ContextProvider.before_run)
    probe = _NoOpProvider()
    agent = BaseAgent(name="contract-probe", context_providers=[probe])

    assert inspect.iscoroutinefunction(ContextProvider.before_run)
    assert tuple(signature.parameters) == (
        "self",
        "agent",
        "session",
        "context",
        "state",
    )
    assert SessionContext.extend_instructions
    assert agent.context_providers == [probe]
    assert isinstance(probe, ContextProvider)

    print(
        f"agent-framework-core={version} "
        f"base={ContextProvider.__module__}.ContextProvider "
        f"invocation=before_run{signature} result=SessionContext "
        "registration=context_providers"
    )
