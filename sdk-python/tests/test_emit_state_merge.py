"""Tests for #3138: copilotkit_emit_state should merge state, not replace it."""

import pytest
from unittest.mock import MagicMock, patch, AsyncMock
from typing import Any, cast


class TestEmitStateMerge:
    """Verify that sequential emit_state calls merge keys rather than overwriting."""

    def test_sequential_emit_state_preserves_both_keys(self):
        """Two emit_state calls with different keys should both be present in the snapshot.

        Bug: manually_emitted_state = cast(Any, event["data"]) replaces entire state.
        Fix: manually_emitted_state = {**current_graph_state, **cast(Any, event["data"])}
        """
        # Simulate the state tracking logic from langgraph_agent.py
        # This mirrors lines ~410-460 of langgraph_agent.py
        current_graph_state = {"existing_key": "existing_value"}
        manually_emitted_state = None

        # First emit_state call: emit {"progress": 50}
        event1_data = {"progress": 50}

        # BUG LINE (before fix): manually_emitted_state = cast(Any, event1_data)
        # FIX LINE: manually_emitted_state = {**current_graph_state, **cast(Any, event1_data)}
        from copilotkit.langgraph_agent import _merge_emit_state
        manually_emitted_state = _merge_emit_state(current_graph_state, event1_data)

        # After first emit, should have both existing_key and progress
        assert "existing_key" in manually_emitted_state
        assert manually_emitted_state["progress"] == 50

        # Second emit_state call: emit {"status": "running"}
        event2_data = {"status": "running"}
        # The updated_state line uses: manually_emitted_state or current_graph_state
        # So manually_emitted_state is what gets sent as the snapshot
        updated_state = manually_emitted_state or current_graph_state
        # Now merge the second emit on top
        manually_emitted_state = _merge_emit_state(updated_state, event2_data)

        # Both keys from both emits AND the original state must be present
        assert manually_emitted_state["existing_key"] == "existing_value"
        assert manually_emitted_state["progress"] == 50
        assert manually_emitted_state["status"] == "running"

    def test_emit_state_overwrites_same_key(self):
        """Emitting the same key twice should use the latest value."""
        from copilotkit.langgraph_agent import _merge_emit_state
        current_graph_state = {"progress": 0}
        result = _merge_emit_state(current_graph_state, {"progress": 100})
        assert result["progress"] == 100
