from __future__ import annotations

import importlib.metadata
import inspect

from google.adk.agents import LlmAgent
from google.adk.tools.base_tool import BaseTool
from google.adk.tools.base_toolset import BaseToolset


class _NoOpToolset(BaseToolset):
    async def get_tools(self, readonly_context=None) -> list[BaseTool]:
        del readonly_context
        return []


def test_native_toolset_registration_contract() -> None:
    version = importlib.metadata.version("google-adk")
    required_methods = tuple(sorted(BaseToolset.__abstractmethods__))
    signature = inspect.signature(BaseToolset.get_tools)

    assert required_methods == ("get_tools",)
    assert inspect.iscoroutinefunction(BaseToolset.get_tools)
    assert tuple(signature.parameters) == ("self", "readonly_context")

    probe = _NoOpToolset()
    agent = LlmAgent(name="contract_probe", tools=[probe])
    assert agent.tools == [probe]

    print(
        f"google-adk={version} base={BaseToolset.__module__}.BaseToolset "
        f"required={required_methods} get_tools{signature}"
    )
