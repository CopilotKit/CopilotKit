"""shared-state-read and shared-state-read-write: the model reads UI-owned state.

The page writes its state with ``agent.setState``; it arrives with every run
as ``RunAgentInput.state``, which the adapter makes the run's shared state.
These agents' dynamic instructions show the model that state on every turn,
as langgraph-python's ``PreferencesInjectorMiddleware`` does.

The write side is an ordinary function tool: ``set_notes`` replaces the
``notes`` slot through ``shared_state().update``, which streams a
STATE_SNAPSHOT so the page's notes card updates while the turn runs.
"""

import json
from collections.abc import Callable
from typing import Any

from ag_ui_openai_agents import shared_state
from agents import Agent, RunContextWrapper, function_tool

from demo_agents._common import MODEL


# @region[shared-state-instructions]
def with_state(prompt: str) -> Callable[[RunContextWrapper[Any], Agent[Any]], str]:
    """Dynamic instructions: ``prompt`` plus the run's shared state as JSON."""

    def instructions(_ctx: RunContextWrapper[Any], _agent: Agent[Any]) -> str:
        state = shared_state().value
        if not state:
            return prompt
        return (
            f"{prompt}\n\nCurrent shared application state (JSON; the user may "
            f"have edited it since your last turn):\n{json.dumps(state)}"
        )

    return instructions


# @endregion[shared-state-instructions]


# @region[shared-state-read-agent]
READ_PROMPT = (
    "You are a helpful cooking assistant. The user edits a recipe in the app "
    "(title, skill level, cooking time, dietary preferences, ingredients and "
    "instructions). The current recipe is in the shared application state "
    "below: base your answer on it, since the user may have changed it since "
    "your last turn. You cannot change the recipe yourself; suggest edits "
    "and let the user apply them in the form."
)


shared_state_read_agent = Agent(
    name="recipe_assistant", instructions=with_state(READ_PROMPT), model=MODEL
)


# @endregion[shared-state-read-agent]


# @region[shared-state-write-tool]
@function_tool
def set_notes(notes: list[str]) -> str:
    """Replace the notes array in shared state with the full updated list.

    Use this tool whenever the user asks you to "remember" something, or
    when you have an observation about the user worth surfacing in the
    UI's notes panel. Always pass the FULL notes list (existing notes +
    any new ones), not a diff. Keep each note short (< 120 chars).
    """
    shared_state().update(notes=notes)
    return "Notes updated."


# @endregion[shared-state-write-tool]


# @region[shared-state-read-write-agent]
READ_WRITE_PROMPT = (
    "You are a helpful, concise assistant. The shared application state below "
    "has a `preferences` object with the user's name, preferred tone, "
    "language and interests, which the user edits in the app: always respect "
    "them, and address the user by name when you know it. Its `notes` list "
    "holds what you have remembered so far. When the user asks you to "
    "remember something, or when you observe something worth surfacing in "
    "the UI, call `set_notes` with the FULL updated list of short note "
    "strings (existing notes + new)."
)


shared_state_read_write_agent = Agent(
    name="preferences_assistant",
    instructions=with_state(READ_WRITE_PROMPT),
    model=MODEL,
    tools=[set_notes],
)


# @endregion[shared-state-read-write-agent]
