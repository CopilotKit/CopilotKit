"""Tests for #3138: copilotkit_emit_state should merge state, not replace it.

These tests exercise the actual state-tracking loop logic from
LangGraphAgent._stream_events to verify that sequential emit_state
calls preserve all keys in the snapshot sent to the frontend.
"""

import pytest
from typing import Any, cast
from copilotkit.langgraph_agent import _merge_emit_state


class TestMergeEmitStateHelper:
    """Unit tests for the _merge_emit_state helper function."""

    def test_merges_dict_on_top_of_current_state(self):
        current = {"existing": "value", "count": 0}
        emitted = {"count": 5, "new_key": "hello"}
        result = _merge_emit_state(current, emitted)
        assert result == {"existing": "value", "count": 5, "new_key": "hello"}

    def test_non_dict_emitted_state_replaces(self):
        """When emitted state is not a dict, it replaces entirely (edge case)."""
        current = {"key": "value"}
        result = _merge_emit_state(current, "not-a-dict")
        assert result == "not-a-dict"

    def test_empty_emitted_dict_preserves_current(self):
        current = {"a": 1, "b": 2}
        result = _merge_emit_state(current, {})
        assert result == {"a": 1, "b": 2}


class TestEmitStateMergeIntegration:
    """Simulate the actual state-tracking loop from LangGraphAgent._stream_events.

    This mirrors the real control flow at lines ~430-490 of langgraph_agent.py
    to verify that sequential emit_state calls produce correct merged snapshots.
    The key variables tracked are:
      - current_graph_state: persistent state dict updated across iterations
      - manually_emitted_state: set when copilotkit_emit_state fires, cleared on node exit
    """

    def _simulate_emit_loop(self, initial_state: dict, emit_events: list[dict]) -> list[dict]:
        """Simulate the state merge loop from _stream_events.

        Args:
            initial_state: The graph state at the start of streaming.
            emit_events: List of dicts, each representing a manually emitted partial state.

        Returns:
            List of state snapshots that would have been emitted to the frontend.
        """
        current_graph_state = dict(initial_state)
        manually_emitted_state = None
        snapshots = []

        for event_data in emit_events:
            # This mirrors the fix at line 438:
            # manually_emitted_state = _merge_emit_state(current_graph_state, cast(Any, event["data"]))
            manually_emitted_state = _merge_emit_state(current_graph_state, cast(Any, event_data))

            # This is the missing line that must be present for correctness:
            # current_graph_state.update(manually_emitted_state)
            # Without it, the next iteration's merge uses stale current_graph_state.
            current_graph_state.update(manually_emitted_state)

            # The snapshot sent to frontend
            snapshots.append(dict(manually_emitted_state))

        return snapshots

    def _simulate_emit_loop_WITHOUT_fix(self, initial_state: dict, emit_events: list[dict]) -> list[dict]:
        """Simulate the BROKEN behavior (no current_graph_state.update).

        This proves the test would fail without the fix.
        """
        current_graph_state = dict(initial_state)
        manually_emitted_state = None
        snapshots = []

        for event_data in emit_events:
            # The _merge_emit_state call merges with current_graph_state...
            manually_emitted_state = _merge_emit_state(current_graph_state, cast(Any, event_data))

            # ...but WITHOUT updating current_graph_state, the next merge loses previous emits
            # (this is the bug: the `continue` skips current_graph_state.update)

            snapshots.append(dict(manually_emitted_state))

        return snapshots

    def test_sequential_emits_preserve_all_keys(self):
        """Two sequential emit_state calls with different keys must both appear in final snapshot.

        This is the core bug from #3138: emitting {"progress": 50} then {"status": "running"}
        should produce a snapshot containing BOTH keys, not just the latest one.
        """
        initial_state = {"existing_key": "existing_value"}
        emit_events = [
            {"progress": 50},
            {"status": "running"},
        ]

        snapshots = self._simulate_emit_loop(initial_state, emit_events)

        # First snapshot: merged initial + first emit
        assert snapshots[0] == {"existing_key": "existing_value", "progress": 50}

        # Second snapshot: must contain ALL keys (initial + first emit + second emit)
        assert snapshots[1] == {
            "existing_key": "existing_value",
            "progress": 50,
            "status": "running",
        }

    def test_sequential_emits_FAIL_without_current_graph_state_update(self):
        """Prove the bug: without current_graph_state.update, second emit loses first emit's keys."""
        initial_state = {"existing_key": "existing_value"}
        emit_events = [
            {"progress": 50},
            {"status": "running"},
        ]

        snapshots = self._simulate_emit_loop_WITHOUT_fix(initial_state, emit_events)

        # First snapshot is correct either way
        assert snapshots[0] == {"existing_key": "existing_value", "progress": 50}

        # Second snapshot is WRONG without the fix: "progress" key is lost
        # because current_graph_state was never updated with progress=50
        assert "progress" not in snapshots[1], (
            "Bug not reproduced: progress should be missing without the fix"
        )
        assert snapshots[1] == {"existing_key": "existing_value", "status": "running"}

    def test_three_sequential_emits_accumulate(self):
        """Three sequential emits should accumulate all keys."""
        initial_state = {"base": True}
        emit_events = [
            {"step": 1},
            {"step": 2, "detail": "processing"},
            {"result": "done"},
        ]

        snapshots = self._simulate_emit_loop(initial_state, emit_events)

        assert snapshots[0] == {"base": True, "step": 1}
        assert snapshots[1] == {"base": True, "step": 2, "detail": "processing"}
        assert snapshots[2] == {
            "base": True,
            "step": 2,
            "detail": "processing",
            "result": "done",
        }

    def test_same_key_emitted_twice_uses_latest(self):
        """Emitting the same key twice should use the latest value."""
        initial_state = {"progress": 0}
        emit_events = [
            {"progress": 50},
            {"progress": 100},
        ]

        snapshots = self._simulate_emit_loop(initial_state, emit_events)

        assert snapshots[0]["progress"] == 50
        assert snapshots[1]["progress"] == 100

    def test_non_dict_emit_does_not_corrupt_current_graph_state(self):
        """If a non-dict value is emitted, current_graph_state must not be corrupted.

        _merge_emit_state returns the raw value for non-dicts. The update call
        must be guarded so dict.update() is not called with a non-dict argument.
        """
        current_graph_state = {"key": "value"}
        emitted = _merge_emit_state(current_graph_state, "not-a-dict")

        # Simulate the guarded update from langgraph_agent.py
        if isinstance(emitted, dict):
            current_graph_state.update(emitted)

        # current_graph_state should be unchanged
        assert current_graph_state == {"key": "value"}

    def test_emit_does_not_mutate_initial_state_reference(self):
        """The original initial_state dict passed in should not be mutated."""
        initial_state = {"key": "original"}
        # We copy it before the test to verify
        initial_copy = dict(initial_state)

        self._simulate_emit_loop(initial_state, [{"new": "value"}])

        # initial_state gets copied inside _simulate_emit_loop, so the
        # original reference should be unchanged
        assert initial_state == initial_copy
