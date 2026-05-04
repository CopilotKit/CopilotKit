from __future__ import annotations

from textwrap import dedent
from typing import Annotated

from agent_framework import ChatAgent, ChatClientProtocol, ai_function
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


@ai_function(
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


@ai_function(
    name="get_weather",
    description="Share a quick weather update for a location. Use this to render the frontend weather card.",
)
def get_weather(
    location: Annotated[str, Field(description="The city or region to describe. Use fully spelled out names.")],
) -> str:
    """Return a short natural language weather summary."""
    normalized = location.strip().title() or "the requested location"
    return (
        f"The weather in {normalized} is mild with a light breeze. "
        "Skies are mostly clear—perfect for planning something fun."
    )


@ai_function(
    name="go_to_moon",
    description="Request a playful human-in-the-loop confirmation before launching a mission to the moon.",
    approval_mode="always_require",
)
def go_to_moon() -> str:
    """Request human approval before continuing."""
    return "Mission control requested. Awaiting human approval for the lunar launch."


def create_agent(chat_client: ChatClientProtocol) -> AgentFrameworkAgent:
    """Instantiate the CopilotKit demo agent backed by Microsoft Agent Framework."""
    base_agent = ChatAgent(
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
        chat_client=chat_client,
        tools=[update_proverbs, get_weather, go_to_moon],
    )

    return AgentFrameworkAgent(
        agent=base_agent,
        name="CopilotKitMicrosoftAgentFrameworkAgent",
        description="Manages proverbs, weather snippets, and human-in-the-loop moon launches.",
        state_schema=STATE_SCHEMA,
        predict_state_config=PREDICT_STATE_CONFIG,
        require_confirmation=False,  # Allow immediate state updates with follow-up messages
    )
