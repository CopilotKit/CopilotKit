"""The shared-state and app-context cells, run through the adapter's UIBridge.

``set_notes`` is wrapped exactly as AntigravityAgent wraps a server tool at
runtime, so experimental_get_state()/experimental_set_state() resolve to a
real session. The read side
uses the adapter's own built-in ``get_shared_state`` / ``get_app_context``
tools (which the agents' instructions tell the model to call), wrapped the
same way the adapter wraps them: silently.
"""

from __future__ import annotations

import pytest
from ag_ui.core import Context
from ag_ui_antigravity import UIBridge
from ag_ui_antigravity.builtin_tools import get_app_context, get_shared_state

from agents import (
    agent_config,
    app_context,
    open_gen_ui,
    open_gen_ui_advanced,
    shared_state,
)


def _types(events):
    return [e.type if isinstance(e.type, str) else e.type.value for e in events]


def _snapshots(events):
    return [e.snapshot for e in events if _types([e]) == ["STATE_SNAPSHOT"]]


PREFERENCES = {
    "name": "Ada",
    "tone": "casual",
    "language": "English",
    "interests": ["Books"],
}


@pytest.mark.asyncio
class TestSetNotes:
    async def test_replaces_notes_and_keeps_the_ui_preferences(self):
        bridge = UIBridge()
        bridge.adopt_client_state({"preferences": PREFERENCES, "notes": ["old"]})
        (set_notes,) = bridge.build_server_tools([shared_state.set_notes])

        assert (
            await set_notes(notes=["old", "Favorite color: blue"]) == "Notes updated."
        )

        events = bridge.drain()
        (snapshot,) = _snapshots(events)
        assert snapshot == {
            "preferences": PREFERENCES,
            "notes": ["old", "Favorite color: blue"],
        }
        # The notes card updates before the tool's own result arrives.
        types = _types(events)
        assert types.index("STATE_SNAPSHOT") < types.index("TOOL_CALL_RESULT")

    async def test_works_before_the_ui_has_published_any_state(self):
        bridge = UIBridge()
        (set_notes,) = bridge.build_server_tools([shared_state.set_notes])
        await set_notes(notes=["first"])
        (snapshot,) = _snapshots(bridge.drain())
        assert snapshot == {"notes": ["first"]}


@pytest.mark.asyncio
class TestBuiltinReads:
    async def test_get_shared_state_returns_what_the_ui_published(self):
        bridge = UIBridge()
        recipe = {"recipe": {"title": "Pasta", "ingredients": []}}
        bridge.adopt_client_state(recipe)
        (read,) = bridge.build_server_tools([get_shared_state], silent=True)
        assert await read() == recipe
        # Silent: no tool card in the chat.
        assert _types(bridge.drain()) == []

    async def test_get_shared_state_sees_notes_the_agent_wrote(self):
        bridge = UIBridge()
        bridge.adopt_client_state({"preferences": PREFERENCES, "notes": []})
        set_notes, read = bridge.build_server_tools(
            [shared_state.set_notes, get_shared_state]
        )
        await set_notes(notes=["Favorite color: blue"])
        assert (await read())["notes"] == ["Favorite color: blue"]

    async def test_get_app_context_returns_the_use_agent_context_entries(self):
        bridge = UIBridge()
        bridge.adopt_client_context(
            [
                Context(description="The user's name", value="Atai"),
                Context(
                    description="Agent response preferences",
                    value='{"tone":"casual","expertise":"expert","responseLength":"detailed"}',
                ),
            ]
        )
        (read,) = bridge.build_server_tools([get_app_context], silent=True)
        assert await read() == [
            {"description": "The user's name", "value": "Atai"},
            {
                "description": "Agent response preferences",
                "value": '{"tone":"casual","expertise":"expert","responseLength":"detailed"}',
            },
        ]
        assert _types(bridge.drain()) == []


class TestInstructions:
    """The model only sees state and context if it asks, so each prompt must
    name the built-in it should call."""

    def test_shared_state_prompts_name_get_shared_state(self):
        assert "get_shared_state" in shared_state.READ_PROMPT
        assert "get_shared_state" in shared_state.READ_WRITE_PROMPT
        assert "set_notes" in shared_state.READ_WRITE_PROMPT

    def test_context_prompts_name_get_app_context(self):
        assert "get_app_context" in app_context.SYSTEM_PROMPT
        assert "get_app_context" in agent_config.SYSTEM_PROMPT

    def test_agent_config_keeps_every_rulebook_value(self):
        for value in (
            "professional",
            "casual",
            "enthusiastic",
            "beginner",
            "intermediate",
            "expert",
            "concise",
            "detailed",
        ):
            assert value in agent_config.SYSTEM_PROMPT


# The built-in read tools are opt-in in the adapter. Every cell that tells the
# model to call one must turn it on, or the model gets an unknown-tool error.
READ_TOOL_FACTORIES = [
    (shared_state, "shared_state_read_agent", "experimental_app_state"),
    (shared_state, "shared_state_read_write_agent", "experimental_app_state"),
    (app_context, "app_context_agent", "experimental_app_context"),
    (agent_config, "agent_config_agent", "experimental_app_context"),
    (open_gen_ui, "open_gen_ui_agent", "experimental_app_context"),
    (open_gen_ui_advanced, "open_gen_ui_advanced_agent", "experimental_app_context"),
]


@pytest.mark.parametrize(("module", "factory", "flag"), READ_TOOL_FACTORIES)
def test_cells_that_read_turn_their_read_tool_on(monkeypatch, module, factory, flag):
    calls = []
    monkeypatch.setattr(module, "build", lambda **kwargs: calls.append(kwargs))
    getattr(module, factory)()
    (kwargs,) = calls
    assert kwargs.get(flag) is True
    tool = "get_shared_state" if flag == "experimental_app_state" else "get_app_context"
    assert tool in kwargs["system_instructions"]
