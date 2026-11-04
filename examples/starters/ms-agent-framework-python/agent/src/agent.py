from __future__ import annotations

from collections.abc import AsyncGenerator
from contextvars import ContextVar
from textwrap import dedent
from typing import Annotated, Any

from agent_framework import Agent, ContextProvider, SupportsChatGetResponse, tool
from agent_framework_ag_ui import AgentFrameworkAgent
from pydantic import Field

STATE_SCHEMA: dict[str, object] = {
    "proverbs": {
        "type": "array",
        "items": {"type": "string"},
        "description": "Ordered list of the user's saved proverbs.",
    }
}

PREDICT_STATE_CONFIG: dict[str, dict[str, str]] = {
    "proverbs": {
        "tool": "update_proverbs",
        "tool_argument": "proverbs",
    }
}


@tool(
    name="update_proverbs",
    description=(
        "Replace the entire list of proverbs with the provided values. "
        "Always include every proverb you want to keep."
    ),
)
def update_proverbs(
    proverbs: Annotated[
        list[str],
        Field(
            description=(
                "The complete source of truth for the user's proverbs. "
                "Maintain ordering and include the full list on each call."
            )
        ),
    ],
) -> str:
    """Persist the provided set of proverbs."""
    return f"Proverbs updated. Tracking {len(proverbs)} item(s)."


@tool(
    name="get_weather",
    description="Share a quick weather update for a location. Use this to render the frontend weather card.",
)
def get_weather(
    location: Annotated[
        str,
        Field(
            description="The city or region to describe. Use fully spelled out names."
        ),
    ],
) -> str:
    """Return a short natural language weather summary."""
    normalized = location.strip().title() or "the requested location"
    return (
        f"The weather in {normalized} is mild with a light breeze. "
        "Skies are mostly clear—perfect for planning something fun."
    )


# What the page shares (`useAgentContext`) for the run in progress.
_page_context: ContextVar[list[dict[str, Any]] | None] = ContextVar(
    "page_context", default=None
)


class PageContextAgent(AgentFrameworkAgent):
    """Make the run's AG-UI `context` available to `PageContextProvider`.

    agent-framework-ag-ui only reads `context` for A2UI and does not add it to
    the prompt itself, so without this the model never sees it.
    """

    async def run(self, input_data: dict[str, Any]) -> AsyncGenerator[Any, None]:
        _page_context.set(input_data.get("context") or [])
        async for event in super().run(input_data):
            yield event


class PageContextProvider(ContextProvider):
    """Append the page's shared context to the agent's instructions."""

    def __init__(self) -> None:
        super().__init__("page_context")

    async def before_run(self, *, context, **_: Any) -> None:
        entries = _page_context.get()
        if not entries:
            return
        shared = "\n\n".join(
            f"{entry.get('description', '')}:\n{entry.get('value', '')}"
            for entry in entries
        )
        context.extend_instructions(
            self.source_id, f"Context provided by the application:\n\n{shared}"
        )


def create_agent(chat_client: SupportsChatGetResponse) -> AgentFrameworkAgent:
    """Instantiate the CopilotKit demo agent backed by Microsoft Agent Framework."""
    base_agent = Agent(
        name="proverbs_agent",
        instructions=dedent(
            """
            You help users brainstorm, organize, and refine proverbs while coordinating UI updates.

            State sync:
            - The current list of proverbs is provided in the conversation context.
            - When you add, remove, or reorder proverbs, call `update_proverbs` with the full list.
              Never send partial updates—always include every proverb that should exist.
            - CRITICAL: When asked to "add" a proverb, you must:
              1. First, identify ALL existing proverbs from the conversation history
              2. Create EXACTLY ONE new proverb (never more than one unless explicitly requested)
              3. Call update_proverbs with: [all existing proverbs] + [the one new proverb]
              Example: Current: ["A", "B"] -> After adding: ["A", "B", "C"] (NOT ["A", "B", "C", "D", "E"])
            - When asked to "remove" a proverb, remove exactly ONE item unless user specifies otherwise.

            Tool usage rules:
            - When user asks to go to the moon, you MUST call the `go_to_moon` tool immediately. Do NOT ask for approval
              yourself—the tool's approval workflow and the client UI will handle it.

            Frontend integrations:
            - `get_weather` renders a weather card in the UI. Only call this tool when the user explicitly
              asks for weather. Do NOT call it after unrelated tasks or approvals.
            - `go_to_moon` requires explicit user approval before you proceed. Only use it when a
              user asks to launch or travel to the moon. Always call the tool instead of asking manually.

            Conversation tips:
            - Reference the latest proverb list before suggesting changes.
            - Keep responses concise and friendly unless the user requests otherwise.
            - After you finish executing tools for the user's request, provide a brief, final assistant
              message summarizing exactly what changed. Do NOT call additional tools or switch topics
              after that summary unless the user asks. ALWAYS send this conversational summary so the message persists.
            """.strip()
        ),
        client=chat_client,
        # `go_to_moon` is a frontend-only tool registered by
        # `useHumanInTheLoop`. AG-UI adds it to each run automatically.
        tools=[update_proverbs, get_weather],
        context_providers=[PageContextProvider()],
    )

    return PageContextAgent(
        agent=base_agent,
        name="CopilotKitMicrosoftAgentFrameworkAgent",
        description="Manages proverbs, weather snippets, and human-in-the-loop moon launches.",
        state_schema=STATE_SCHEMA,
        predict_state_config=PREDICT_STATE_CONFIG,
        require_confirmation=False,  # Allow immediate state updates with follow-up messages
    )
