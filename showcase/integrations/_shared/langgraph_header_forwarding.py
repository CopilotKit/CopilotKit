"""Request headers for model calls made inside LangGraph tools."""

from collections.abc import Awaitable, Callable
from typing import Any

from copilotkit.copilotkit_lg_middleware import (
    _ensure_httpx_hook,
    _extract_forwarded_headers_from_config,
)
from langchain.agents.middleware import AgentMiddleware, AgentState, ToolCallRequest
from langchain_core.messages import ToolMessage
from langgraph.types import Command


class AuxiliaryModelHeaderForwardingMiddleware(AgentMiddleware[AgentState, Any]):
    """Forward current request headers for tool-owned auxiliary model calls."""

    def __init__(self, *models: Any) -> None:
        if not models:
            raise ValueError("at least one auxiliary model is required")
        self._models = tuple(models)

    @property
    def name(self) -> str:
        return "AuxiliaryModelHeaderForwardingMiddleware"

    def _prepare_tool_call(self) -> None:
        _extract_forwarded_headers_from_config()
        for model in self._models:
            _ensure_httpx_hook(model)

    def wrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command[Any]],
    ) -> ToolMessage | Command[Any]:
        self._prepare_tool_call()
        return handler(request)

    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command[Any]]],
    ) -> ToolMessage | Command[Any]:
        self._prepare_tool_call()
        return await handler(request)
