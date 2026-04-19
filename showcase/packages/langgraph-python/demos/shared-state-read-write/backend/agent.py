"""LangGraph agent backing the Shared State (Writing) demo.

Demonstrates writing to agent state from the UI. The UI holds a
`preferences` object (the user's profile) that is written into shared
agent state via `agent.setState(...)`. The agent reads `preferences`
from its own state on every turn and uses those preferences when
answering.

This is the canonical LangGraph-Python writable-shared-state pattern:
frontend seeds state, backend reads from `state["preferences"]` via a
middleware that injects it into the system prompt.
"""

from typing import Any, Awaitable, Callable, TypedDict

from langchain.agents import AgentState as BaseAgentState, create_agent
from langchain.agents.middleware import (
    AgentMiddleware,
    ModelRequest,
    ModelResponse,
)
from langchain_core.messages import SystemMessage
from langchain_openai import ChatOpenAI

from copilotkit import CopilotKitMiddleware


class Preferences(TypedDict, total=False):
    name: str
    tone: str  # "formal" | "casual" | "playful"
    language: str  # "English", "Spanish", ...
    interests: list[str]


class AgentState(BaseAgentState):
    """Shared state: the UI writes `preferences` via agent.setState()."""

    preferences: Preferences


class PreferencesInjectorMiddleware(AgentMiddleware[AgentState, Any]):
    """Injects the UI-supplied `preferences` into the system prompt.

    Every turn, we read the latest `preferences` from agent state and
    prepend a SystemMessage that tells the LLM about them. This is how
    UI-written state becomes visible to the agent.
    """

    state_schema = AgentState

    @property
    def name(self) -> str:
        return "PreferencesInjectorMiddleware"

    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelResponse:
        prefs = request.state.get("preferences") or {}
        if not prefs:
            return handler(request)

        lines = ["The user has shared these preferences with you:"]
        if prefs.get("name"):
            lines.append(f"- Name: {prefs['name']}")
        if prefs.get("tone"):
            lines.append(f"- Preferred tone: {prefs['tone']}")
        if prefs.get("language"):
            lines.append(f"- Preferred language: {prefs['language']}")
        interests = prefs.get("interests") or []
        if interests:
            lines.append(f"- Interests: {', '.join(interests)}")
        lines.append(
            "Tailor every response to these preferences. Address the user "
            "by name when appropriate."
        )

        prefs_message = SystemMessage(content="\n".join(lines))
        return handler(
            request.override(messages=[prefs_message, *request.messages])
        )

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse:
        prefs = request.state.get("preferences") or {}
        if not prefs:
            return await handler(request)

        lines = ["The user has shared these preferences with you:"]
        if prefs.get("name"):
            lines.append(f"- Name: {prefs['name']}")
        if prefs.get("tone"):
            lines.append(f"- Preferred tone: {prefs['tone']}")
        if prefs.get("language"):
            lines.append(f"- Preferred language: {prefs['language']}")
        interests = prefs.get("interests") or []
        if interests:
            lines.append(f"- Interests: {', '.join(interests)}")
        lines.append(
            "Tailor every response to these preferences. Address the user "
            "by name when appropriate."
        )

        prefs_message = SystemMessage(content="\n".join(lines))
        return await handler(
            request.override(messages=[prefs_message, *request.messages])
        )


graph = create_agent(
    model=ChatOpenAI(model="gpt-4o-mini"),
    tools=[],
    middleware=[CopilotKitMiddleware(), PreferencesInjectorMiddleware()],
    state_schema=AgentState,
    system_prompt=(
        "You are a helpful, concise assistant. "
        "The user's preferences are supplied via shared state and will be "
        "added as a system message at the start of every turn. Always "
        "respect them."
    ),
)
