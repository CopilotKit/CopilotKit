"""shared-state-read and shared-state-read-write: the model reads UI-owned state.

Antigravity fixes an agent's instructions when the harness session starts,
and the adapter forwards only the user's messages, so the UI's state can
never be folded into the prompt the way langgraph-python's
``PreferencesInjectorMiddleware`` does. The adapter instead gives every
agent a silent built-in ``get_shared_state()`` tool that returns the state
the UI sent with the current run (``agent.setState`` on the page). These
agents tell the model to call it before answering. It emits no TOOL_CALL
events, so no card appears in the chat.

The write side is an ordinary server tool: ``set_notes`` replaces the
``notes`` slot with the adapter's ``experimental_set_state()``, which streams a
STATE_SNAPSHOT so the page's notes card updates while the turn runs.

No ``from __future__ import annotations``: the SDK derives the tool schema
from the live annotations.
"""

from ag_ui_antigravity import experimental_get_state, experimental_set_state

from agents._common import build

# @region[shared-state-read-agent]
READ_PROMPT = (
    "You are a helpful cooking assistant. The user edits a recipe in the app "
    "(title, skill level, cooking time, dietary preferences, ingredients and "
    "instructions). Call `get_shared_state` before every answer and read the "
    "`recipe` it returns: the user may have changed it since your last turn. "
    "Base your answer on that recipe. You cannot change the recipe yourself; "
    "suggest edits and let the user apply them in the form."
)


def shared_state_read_agent():
    return build(system_instructions=READ_PROMPT, experimental_app_state=True)


# @endregion[shared-state-read-agent]


# @region[shared-state-write-tool]
def set_notes(notes: list[str]) -> str:
    """Replace the notes array in shared state with the full updated list.

    Use this tool whenever the user asks you to "remember" something, or
    when you have an observation about the user worth surfacing in the
    UI's notes panel. Always pass the FULL notes list (existing notes +
    any new ones), not a diff. Keep each note short (< 120 chars).
    """
    experimental_set_state({**experimental_get_state(), "notes": notes})
    return "Notes updated."


# @endregion[shared-state-write-tool]


# @region[shared-state-read-write-agent]
READ_WRITE_PROMPT = (
    "You are a helpful, concise assistant. Call `get_shared_state` before "
    "every answer. Its `preferences` object holds the user's name, preferred "
    "tone, language and interests, which the user edits in the app: always "
    "respect them, and address the user by name when you know it. Its "
    "`notes` list holds what you have remembered so far. "
    "When the user asks you to remember something, or when you observe "
    "something worth surfacing in the UI, call `set_notes` with the FULL "
    "updated list of short note strings (existing notes + new)."
)


def shared_state_read_write_agent():
    return build(
        system_instructions=READ_WRITE_PROMPT,
        tools=[set_notes],
        experimental_app_state=True,
    )


# @endregion[shared-state-read-write-agent]
