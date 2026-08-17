"""AG2 agent for the Shared State (Read + Write) demo.

Demonstrates the full bidirectional shared-state pattern between UI and
agent using AG2 1.0's Context.variables mechanism:

- **UI -> agent (write)**: The UI owns a `preferences` object (the user's
  profile) that it writes into agent state via `agent.setState({...})`.
  AG2's AGUIStream merges the incoming `RunAgentInput.state` into
  `Context.variables` at the start of every run. The agent calls
  `get_current_preferences` to read them, and the system prompt tells it
  to do so before answering.
- **agent -> UI (read)**: The agent calls `set_notes` to update the
  `notes` slot in `Context.variables`. AGUIStream emits a state snapshot
  automatically at run end (if variables changed), but this demo needs
  live per-tool-call updates, so `set_notes` explicitly sends an
  intermediate `StateSnapshotEvent` via `context.send` right after
  mutating the variables. `useAgent({ updates: [OnStateChanged] })`
  re-renders on each snapshot.

Together this gives bidirectional shared state: frontend writes,
backend reads AND writes, frontend re-renders.
"""

import logging
from textwrap import dedent
from typing import List

from ag2 import Agent, Context, tool
from ag2.ag_ui import AGUIEvent, AGUIStream
from ag2.config import OpenAIConfig
from ag_ui.core import StateSnapshotEvent
from fastapi import FastAPI
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class Preferences(BaseModel):
    """User preferences written by the UI into shared state."""

    name: str = Field(default="", description="The user's preferred name")
    tone: str = Field(
        default="casual",
        description="Preferred tone: 'formal', 'casual', or 'playful'",
    )
    language: str = Field(
        default="English",
        description="Preferred language (e.g. English, Spanish, ...)",
    )
    interests: List[str] = Field(
        default_factory=list,
        description="The user's interests (e.g. Cooking, Tech, Travel)",
    )


class SharedSnapshot(BaseModel):
    """Full shape of the shared state slot.

    Both the UI and the backend agree on this shape; it round-trips through
    AG2's Context.variables on every turn.
    """

    preferences: Preferences = Field(default_factory=Preferences)
    notes: List[str] = Field(default_factory=list)


def _load_snapshot(context: Context) -> SharedSnapshot:
    """Best-effort load of the SharedSnapshot from context variables.

    Falls back to an empty snapshot if state is missing or malformed —
    this keeps the agent operational on the very first turn before the UI
    has called ``agent.setState``.
    """
    data = context.variables or {}
    try:
        return SharedSnapshot.model_validate(data)
    except Exception as exc:
        # Tolerant of partial state (e.g. only `preferences` set), but log
        # WARNING so silent corruption is visible in server logs instead of
        # quietly degrading to an empty snapshot.
        logger.warning(
            "shared_state_read_write: failed to validate SharedSnapshot "
            "(%s: %s); attempting partial recovery from individual slots",
            exc.__class__.__name__,
            exc,
        )
        prefs_raw = data.get("preferences") or {}
        notes_raw = data.get("notes") or []
        try:
            prefs = Preferences.model_validate(prefs_raw)
        except Exception as prefs_exc:
            logger.warning(
                "shared_state_read_write: failed to validate Preferences "
                "(%s: %s); falling back to defaults",
                prefs_exc.__class__.__name__,
                prefs_exc,
            )
            prefs = Preferences()
        notes = [str(n) for n in notes_raw if isinstance(n, (str, int, float))]
        return SharedSnapshot(preferences=prefs, notes=notes)


@tool
async def get_current_preferences(context: Context) -> str:
    """Return the user's preferences (name, tone, language, interests) as JSON.

    Always call this BEFORE answering, so your reply respects the user's
    preferred name, tone, language, and interests.
    """
    snapshot = _load_snapshot(context)
    return snapshot.preferences.model_dump_json(indent=2)


@tool
async def set_notes(
    context: Context,
    notes: List[str],
) -> str:
    """Replace the notes array in shared state with the FULL updated list.

    Use this whenever the user asks you to "remember" something, or when you
    have an observation worth surfacing in the UI's notes panel. Always
    pass the FULL notes list (existing + new) — not a diff. Keep each note
    short (< 120 chars).
    """
    snapshot = _load_snapshot(context)
    cleaned = [str(n).strip() for n in notes if str(n).strip()]
    snapshot.notes = cleaned
    context.variables.update(snapshot.model_dump())
    # AG2 1.0 only snapshots state automatically at run end; emit an explicit
    # intermediate snapshot so the UI's notes panel updates per tool call.
    await context.send(AGUIEvent(StateSnapshotEvent(snapshot=dict(context.variables))))
    return f"Notes updated. Total notes: {len(cleaned)}."


agent = Agent(
    name="shared_state_read_write_assistant",
    prompt=dedent(
        """
        You are a helpful, concise assistant.

        Shared state contract:
        - The UI writes the user's `preferences` (name, tone, language,
          interests) into shared state. Call `get_current_preferences`
          BEFORE answering, every turn, and tailor your reply to those
          preferences. Address the user by name when appropriate.
        - The UI displays a `notes` panel that mirrors a list you control.
          When the user asks you to remember something, OR when you observe
          something worth surfacing, call `set_notes` with the FULL updated
          list of short note strings.

        Rules:
        - Never repeat preferences back at the user verbatim — just adapt.
        - When calling `set_notes`, pass the COMPLETE list (existing +
          new), never a diff.
        - Keep messages short and respect the preferred tone.
        """
    ).strip(),
    config=OpenAIConfig(model="gpt-4o-mini", streaming=True),
    tools=[get_current_preferences, set_notes],
)

stream = AGUIStream(agent)
shared_state_read_write_app = FastAPI()
shared_state_read_write_app.mount("", stream.build_asgi())
