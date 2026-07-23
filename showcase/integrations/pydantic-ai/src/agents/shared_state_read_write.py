"""PydanticAI agent backing the Shared State (Read + Write) demo.

Mirrors langgraph-python/src/agents/shared_state_read_write.py and
google-adk/src/agents/shared_state_read_write_agent.py:

- **UI -> agent (write)**: The UI owns a ``preferences`` object and
  writes it into agent state via ``agent.setState({preferences: ...})``.
  A dynamic ``@agent.system_prompt`` reads the latest preferences from
  ``ctx.deps.state`` every turn and appends a "preferences" block so the
  LLM adapts.

- **agent -> UI (read)**: The agent calls ``set_notes`` to replace the
  ``notes`` array in shared state. The frontend subscribes via
  ``useAgent`` and reflects every update in real time.

PydanticAI specifics
--------------------
* ``deps_type=StateDeps[SharedStateRWState]`` exposes the shared state
  on ``ctx.deps.state``.
* ``@agent.system_prompt`` provides a dynamic, per-turn system prompt
  segment composed from the current preferences — this is how UI-written
  state visibly steers the model.
* The ``set_notes`` tool mutates ``ctx.deps.state.notes`` and returns a
  ``StateSnapshotEvent`` so the AG-UI runtime broadcasts the update to
  the frontend (same pattern used by ``manage_sales_todos`` in the main
  sales agent).
"""

from __future__ import annotations

from typing import Any

from ag_ui.core import EventType, StateSnapshotEvent
from pydantic import BaseModel, Field
from pydantic_ai import Agent, RunContext
from pydantic_ai.ag_ui import StateDeps
from pydantic_ai.models.openai import OpenAIResponsesModel


# ── Shared state schema ─────────────────────────────────────────────


class Preferences(BaseModel):
    """User preferences — written by the UI via ``agent.setState``."""

    name: str = ""
    tone: str = "casual"  # "formal" | "casual" | "playful"
    language: str = "English"
    interests: list[str] = Field(default_factory=list)


class SharedStateRWState(BaseModel):
    """Bidirectional shared state between UI and agent.

    - ``preferences`` is written by the UI (via ``agent.setState``).
    - ``notes`` is written by the agent (via the ``set_notes`` tool) and
      read by the UI.
    """

    preferences: Preferences = Field(default_factory=Preferences)
    notes: list[str] = Field(default_factory=list)


# ── System prompt (static base) ─────────────────────────────────────


_BASE_SYSTEM_PROMPT = (
    "You are a helpful, concise assistant. "
    "The user's preferences are supplied via shared state and added as a "
    "system message at the start of every turn. Always respect them. "
    "When the user asks you to remember something, or you observe "
    "something worth surfacing in the UI's notes panel, call `set_notes` "
    "with the FULL updated list of short note strings (existing notes + "
    "new). Each note should be < 120 characters."
)


# ── Agent ───────────────────────────────────────────────────────────


agent = Agent(
    model=OpenAIResponsesModel("gpt-4o-mini"),
    deps_type=StateDeps[SharedStateRWState],
    system_prompt=_BASE_SYSTEM_PROMPT,
)


def _build_prefs_block(prefs: Preferences | None) -> str | None:
    """Compose a preferences block for the system prompt, or None."""
    if prefs is None:
        return None
    lines: list[str] = []
    if prefs.name:
        lines.append(f"- Name: {prefs.name}")
    if prefs.tone:
        lines.append(f"- Preferred tone: {prefs.tone}")
    if prefs.language:
        lines.append(f"- Preferred language: {prefs.language}")
    if prefs.interests:
        lines.append(f"- Interests: {', '.join(prefs.interests)}")
    if not lines:
        return None
    return (
        "The user has shared these preferences with you:\n"
        + "\n".join(lines)
        + "\nTailor every response to these preferences. "
        + "Address the user by name when appropriate."
    )


@agent.system_prompt
def _inject_preferences(
    ctx: RunContext[StateDeps[SharedStateRWState]],
) -> str:
    """Dynamic system prompt segment built from the UI-supplied preferences.

    PydanticAI concatenates static + dynamic system prompt segments. Returning
    an empty string (when no preferences are set) is a safe no-op.
    """
    state = ctx.deps.state
    block = _build_prefs_block(state.preferences)
    return block or ""


# ── Tools ───────────────────────────────────────────────────────────


@agent.tool
async def set_notes(
    ctx: RunContext[StateDeps[SharedStateRWState]],
    notes: list[str],
) -> StateSnapshotEvent:
    """Replace the notes array in shared state with the full updated list.

    Use this whenever the user asks you to "remember" something, or when
    you have an observation worth surfacing in the UI's notes panel.
    Always pass the FULL notes list (existing notes + any new ones), not
    a diff. Keep each note short (< 120 chars).
    """
    ctx.deps.state.notes = list(notes)
    # Serialize the Pydantic state model to a plain dict before handing it
    # to AG-UI. ``StateSnapshotEvent.snapshot`` is typed as ``Any`` but the
    # downstream JSON serializer expects primitives — passing the Pydantic
    # model directly works on some encoder paths and fails on others.
    # Sibling implementations (e.g. mastra, google-adk) all emit dicts.
    return StateSnapshotEvent(
        type=EventType.STATE_SNAPSHOT,
        snapshot=ctx.deps.state.model_dump(),
    )


@agent.tool
def get_notes(
    ctx: RunContext[StateDeps[SharedStateRWState]],
) -> list[str]:
    """Return the current notes list — useful before deciding what to remember."""
    return list(ctx.deps.state.notes or [])


__all__: list[str] = ["SharedStateRWState", "Preferences", "agent"]
