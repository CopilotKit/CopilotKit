"""
CopilotKit Middleware for LangGraph agents.

Works with any agent (prebuilt or custom).

Example:
    from langgraph.prebuilt import create_agent
    from copilotkit import CopilotKitMiddleware

    agent = create_agent(
        model="openai:gpt-4o",
        tools=[backend_tool],
        middleware=[CopilotKitMiddleware()],
    )
"""

from typing import Any, Callable, Awaitable, ClassVar, List

from langchain_core.messages import AIMessage
from langchain.agents.middleware import (
    AgentMiddleware,
    AgentState,
    ModelRequest,
    ModelResponse,
)
from langgraph.runtime import Runtime

from .langgraph import CopilotKitProperties

class StateSchema(AgentState):
    copilotkit: CopilotKitProperties


class CopilotKitMiddleware(AgentMiddleware[StateSchema, Any]):
    """CopilotKit Middleware for LangGraph agents.

    Handles frontend tool injection and interception for CopilotKit.
    """

    state_schema = StateSchema
    tools: ClassVar[list] = []

    @property
    def name(self) -> str:
        return "CopilotKitMiddleware"

    # Inject frontend tools before model call
    def wrap_model_call(
            self,
            request: ModelRequest,
            handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelResponse:
        frontend_tools = request.state.get("copilotkit", {}).get("actions", [])

        if not frontend_tools:
            return handler(request)

        # Merge frontend tools with existing tools
        merged_tools = [*request.tools, *frontend_tools]

        return handler(request.override(tools=merged_tools))

    async def awrap_model_call(
            self,
            request: ModelRequest,
            handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse:
        frontend_tools = request.state.get("copilotkit", {}).get("actions", [])

        if not frontend_tools:
            return await handler(request)

        # Merge frontend tools with existing tools
        merged_tools = [*request.tools, *frontend_tools]

        return await handler(request.override(tools=merged_tools))

    # Intercept frontend tool calls after model returns, before ToolNode executes
    def after_model(
            self,
            state: StateSchema,
            runtime: Runtime[Any],
    ) -> dict[str, Any] | None:
        frontend_tools = state.get("copilotkit", {}).get("actions", [])
        if not frontend_tools:
            return None

        frontend_tool_names = {
            t.get("function", {}).get("name") or t.get("name")
            for t in frontend_tools
        }

        # Find last AI message with tool calls
        messages = state.get("messages", [])
        if not messages:
            return None

        last_message = messages[-1]
        if not isinstance(last_message, AIMessage):
            return None

        tool_calls = getattr(last_message, "tool_calls", None) or []
        if not tool_calls:
            return None

        backend_tool_calls = []
        frontend_tool_calls = []

        for call in tool_calls:
            if call.get("name") in frontend_tool_names:
                frontend_tool_calls.append(call)
            else:
                backend_tool_calls.append(call)

        if not frontend_tool_calls:
            return None

        # Create updated AIMessage with only backend tool calls
        updated_ai_message = AIMessage(
            content=last_message.content,
            tool_calls=backend_tool_calls,
            id=last_message.id,
        )

        return {
            "messages": [*messages[:-1], updated_ai_message],
            "copilotkit": {
                "intercepted_tool_calls": frontend_tool_calls,
                "original_ai_message_id": last_message.id,
            },
        }

    async def aafter_model(
            self,
            state: StateSchema,
            runtime: Runtime[Any],
    ) -> dict[str, Any] | None:
        # Delegate to sync implementation
        return self.after_model(state, runtime)

    # Restore frontend tool calls to AIMessage before agent exits
    def after_agent(
            self,
            state: StateSchema,
            runtime: Runtime[Any],
    ) -> dict[str, Any] | None:
        copilotkit_state = state.get("copilotkit", {})
        intercepted_tool_calls = copilotkit_state.get("intercepted_tool_calls")
        original_message_id = copilotkit_state.get("original_ai_message_id")

        if not intercepted_tool_calls or not original_message_id:
            return None

        messages = state.get("messages", [])
        updated_messages = []

        for msg in messages:
            if isinstance(msg, AIMessage) and msg.id == original_message_id:
                existing_tool_calls = getattr(msg, "tool_calls", None) or []
                updated_messages.append(AIMessage(
                    content=msg.content,
                    tool_calls=[*existing_tool_calls, *intercepted_tool_calls],
                    id=msg.id,
                ))
            else:
                updated_messages.append(msg)

        return {
            "messages": updated_messages,
            "copilotkit": {
                "intercepted_tool_calls": None,
                "original_ai_message_id": None,
            },
        }

    async def aafter_agent(
            self,
            state: StateSchema,
            runtime: Runtime[Any],
    ) -> dict[str, Any] | None:
        # Delegate to sync implementation
        return self.after_agent(state, runtime)

