from __future__ import annotations

import importlib.metadata
import inspect

from langchain.agents import create_agent
from langchain.agents.middleware import AgentMiddleware, ModelRequest
from langchain_core.language_models.fake_chat_models import FakeListChatModel


class _NoOpMiddleware(AgentMiddleware):
    def wrap_model_call(self, request, handler):
        return handler(request.override())

    async def awrap_model_call(self, request, handler):
        return await handler(request.override())


def test_native_middleware_registration_contract() -> None:
    langgraph_version = importlib.metadata.version("langgraph")
    langchain_version = importlib.metadata.version("langchain")
    sync_signature = inspect.signature(AgentMiddleware.wrap_model_call)
    async_signature = inspect.signature(AgentMiddleware.awrap_model_call)

    assert tuple(sync_signature.parameters) == ("self", "request", "handler")
    assert tuple(async_signature.parameters) == ("self", "request", "handler")
    assert inspect.iscoroutinefunction(AgentMiddleware.awrap_model_call)
    assert tuple(inspect.signature(ModelRequest.override).parameters) == (
        "self",
        "overrides",
    )

    probe = _NoOpMiddleware()
    agent = create_agent(FakeListChatModel(responses=["ok"]), middleware=[probe])
    assert agent is not None

    print(
        f"langgraph={langgraph_version} langchain={langchain_version} "
        f"base={AgentMiddleware.__module__}.AgentMiddleware "
        f"wrap_model_call{sync_signature} awrap_model_call{async_signature} "
        f"override{inspect.signature(ModelRequest.override)}"
    )
