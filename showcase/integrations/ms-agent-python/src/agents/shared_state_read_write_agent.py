"""MS Agent Framework agent backing the Shared State (Read + Write) demo.

Mirrors the bidirectional shared-state pattern used by other showcase
integrations:

- UI -> agent (write): The UI owns a `preferences` object and writes it
  into agent state via `agent.setState({preferences: ...})`. The
  AG-UI runtime injects the current shared state (including
  `preferences`) as a system context message before each turn, so the
  LLM adapts.

- agent -> UI (read): The agent calls `set_notes` to update a `notes`
  list in shared state. The `predict_state_config` mechanism extracts
  the `notes` value from the tool call's `notes` argument and pushes
  a StateSnapshotEvent to the UI. The UI reflects every update in
  real time via `useAgent`.
"""

from __future__ import annotations

from textwrap import dedent
from typing import Annotated

from agent_framework import Agent, BaseChatClient, tool
from agent_framework_ag_ui import AgentFrameworkAgent
from pydantic import Field


# ---------------------------------------------------------------------------
# State schema
#
# Declared so the AG-UI runtime auto-injects `current_state` as a system
# context message every turn. That is how UI-written `preferences`
# become visible to the LLM without us writing any custom middleware.
# ---------------------------------------------------------------------------

STATE_SCHEMA: dict[str, object] = {
    "preferences": {
        "type": "object",
        "description": (
            "User-supplied preferences. Adapt every response to match. "
            "Address the user by name when appropriate."
        ),
        "properties": {
            "name": {"type": "string"},
            "tone": {"type": "string"},
            "language": {"type": "string"},
            "interests": {"type": "array", "items": {"type": "string"}},
        },
    },
    "notes": {
        "type": "array",
        "items": {"type": "string"},
        "description": (
            "Short notes the agent has chosen to remember about the "
            "user. Updated by calling `set_notes` with the FULL list."
        ),
    },
}


# ---------------------------------------------------------------------------
# predict_state_config — agent -> UI write path
#
# Instead of returning a Content/state_update object from the tool, we
# use predict_state_config which extracts the state value directly from
# the tool call's argument. This is the same mechanism the main sales
# agent uses for salesTodos and is more compatible with the MS Agent
# Framework's tool execution pipeline.
# ---------------------------------------------------------------------------

PREDICT_STATE_CONFIG: dict[str, dict[str, str]] = {
    "notes": {
        "tool": "set_notes",
        "tool_argument": "notes",
    },
}


# ---------------------------------------------------------------------------
# Tool: set_notes — agent -> UI write path
#
# Returns a plain string so the MS Agent Framework can serialize it as
# a tool result and send it back to the LLM for the follow-up text.
# The actual state update is handled by predict_state_config above.
# ---------------------------------------------------------------------------


@tool(
    name="set_notes",
    description=(
        "Replace the notes array in shared state with the full updated "
        "list. Always pass the FULL list of short note strings "
        "(existing notes + any new ones), not a diff. Keep each note "
        "short (< 120 chars)."
    ),
)
def set_notes(
    notes: Annotated[
        list[str],
        Field(
            description=(
                "The complete updated list of short note strings. "
                "Must include every existing note you want to keep "
                "plus any new ones."
            )
        ),
    ],
) -> str:
    """Push the agent-authored notes into AG-UI shared state."""
    return f"Notes updated. Tracking {len(notes)} note(s)."


# ---------------------------------------------------------------------------
# Agent factory
# ---------------------------------------------------------------------------


SYSTEM_PROMPT = dedent(
    """
    You are a helpful, concise assistant.

    The user's preferences are supplied via shared state and will be
    added as a system context message at the start of every turn.
    Always respect them:
      - address the user by their `name` when present,
      - match the requested `tone` (formal / casual / playful),
      - reply in the user's preferred `language`,
      - take their `interests` into account when making suggestions.

    Notes — agent-authored memory surfaced to the UI:
      - When the user asks you to remember something, OR you observe
        something worth surfacing in the UI's notes panel, call
        `set_notes` with the FULL updated list of short note strings
        (existing notes from shared state + any new ones).
      - Never send partial updates -- the call replaces the entire
        list. Read the current `notes` value out of the injected
        shared-state context and re-send it plus your additions.
      - Keep each note short (under 120 characters).

    After executing tools, reply with one short conversational
    sentence so the message persists in the chat surface.
    """
).strip()


def create_shared_state_read_write_agent(
    chat_client: BaseChatClient,
) -> AgentFrameworkAgent:
    """Instantiate the Shared State (Read + Write) demo agent."""
    base_agent = Agent(
        client=chat_client,
        name="shared_state_read_write_agent",
        instructions=SYSTEM_PROMPT,
        tools=[set_notes],
        # Disable server-side conversation storage so the OpenAI client
        # sends the full message history on every request instead of
        # relying on `previous_response_id`.  aimock (our local fixture
        # server) doesn't implement conversation-ID lookup, so the
        # tool-result continuation call would 404 without this flag.
        default_options={"store": False},
    )

    return AgentFrameworkAgent(
        agent=base_agent,
        name="CopilotKitMSAgentSharedStateReadWriteAgent",
        description=(
            "Bidirectional shared-state demo. Reads UI-written "
            "`preferences` from shared state every turn and writes "
            "agent-authored `notes` back via the `set_notes` tool."
        ),
        state_schema=STATE_SCHEMA,
        predict_state_config=PREDICT_STATE_CONFIG,
        require_confirmation=False,
    )
