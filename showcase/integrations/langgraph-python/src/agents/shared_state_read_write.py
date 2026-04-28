"""LangGraph agent backing the Shared State (Read + Write) demo.

Demonstrates the full bidirectional shared-state pattern between UI and
agent:

- **UI -> agent (write)**: The UI owns a `preferences` object (the user's
  profile) that it writes into agent state via `agent.setState(...)`. A
  middleware reads those preferences every turn and injects them into
  the system prompt, so the LLM adapts accordingly.
- **agent -> UI (read)**: The agent can call `set_notes` to update a
  `notes` slot in shared state. The UI reflects every update in real
  time via `useAgent(...)`.

Together this shows the canonical LangGraph-Python bidirectional shared
state: frontend writes, backend reads AND writes, frontend re-renders.
"""

from typing import Any, Awaitable, Callable, TypedDict

from langchain.agents import AgentState as BaseAgentState, create_agent
from langchain.agents.middleware import (
    AgentMiddleware,
    ModelRequest,
    ModelResponse,
)
from langchain.tools import ToolRuntime, tool
from langchain_core.messages import SystemMessage, ToolMessage
from langchain_openai import ChatOpenAI
from langgraph.types import Command

from copilotkit import CopilotKitMiddleware


class Preferences(TypedDict, total=False):
    name: str
    tone: str  # "formal" | "casual" | "playful"
    language: str  # "English", "Spanish", ...
    interests: list[str]


class AgentState(BaseAgentState):
    """Bidirectional shared state between UI and agent.

    - `preferences` is written by the UI (via agent.setState).
    - `notes` is written by the agent (via the `set_notes` tool) and
      read by the UI.
    """

    preferences: Preferences
    notes: list[str]


@tool
def set_notes(notes: list[str], runtime: ToolRuntime) -> Command:
    """Replace the notes array in shared state with the full updated list.

    Use this tool whenever the user asks you to "remember" something, or
    when you have an observation about the user worth surfacing in the
    UI's notes panel. Always pass the FULL notes list (existing notes +
    any new ones), not a diff. Keep each note short (< 120 chars).
    """
    return Command(
        update={
            "notes": notes,
            "messages": [
                ToolMessage(
                    content="Notes updated.",
                    tool_call_id=runtime.tool_call_id,
                )
            ],
        }
    )


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

    def _build_prefs_message(self, prefs: Preferences) -> SystemMessage | None:
        if not prefs:
            return None
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
        return SystemMessage(content="\n".join(lines))

    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelResponse:
        prefs = request.state.get("preferences") or {}
        prefs_message = self._build_prefs_message(prefs)
        if prefs_message is None:
            return handler(request)
        return handler(
            request.override(messages=[prefs_message, *request.messages])
        )

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse:
        prefs = request.state.get("preferences") or {}
        prefs_message = self._build_prefs_message(prefs)
        if prefs_message is None:
            return await handler(request)
        return await handler(
            request.override(messages=[prefs_message, *request.messages])
        )


graph = create_agent(
    model=ChatOpenAI(model="gpt-4o-mini"),
    tools=[set_notes],
    middleware=[CopilotKitMiddleware(), PreferencesInjectorMiddleware()],
    state_schema=AgentState,
    system_prompt=(
        "You are a helpful, concise assistant. "
        "The user's preferences are supplied via shared state and will be "
        "added as a system message at the start of every turn. Always "
        "respect them. "
        "When the user asks you to remember something, or when you observe "
        "something worth surfacing in the UI, call `set_notes` with the "
        "FULL updated list of short note strings (existing notes + new)."
    ),
)
