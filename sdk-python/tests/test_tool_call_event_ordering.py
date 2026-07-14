"""Test tool call event ordering to prevent race conditions.

This test validates the fix for FAC-124: ensure TOOL_CALL_START is dispatched
and processed before TOOL_CALL_ARGS to prevent "No active tool call found"
errors in downstream middleware (@ag-ui/mcp-apps-middleware).
"""

import pytest
from unittest.mock import MagicMock, patch
from ag_ui.core import EventType, CustomEvent
from ag_ui_langgraph import LangGraphAgent as AGUIBase
from copilotkit.langgraph_agui_agent import (
    LangGraphAGUIAgent,
    CustomEventNames,
)


@pytest.fixture
def agent():
    """Create a LangGraphAGUIAgent with a mocked graph."""
    mock_graph = MagicMock()
    mock_graph.get_state = MagicMock()
    a = LangGraphAGUIAgent(name="test", graph=mock_graph)
    a.active_run = {"id": "run-1", "thread_id": "t-1"}
    return a


def test_tool_call_events_emitted_in_correct_order(agent):
    """TOOL_CALL_START must be dispatched before TOOL_CALL_ARGS.

    This test validates that the ManuallyEmitToolCall handler dispatches
    events in the correct order: START -> ARGS -> END. While the base
    class _dispatch_event is synchronous, this ensures the defensive
    ordering fix prevents race conditions in downstream middleware.
    """
    dispatched_events = []
    original = AGUIBase._dispatch_event

    def _tracking(self_inner, event):
        dispatched_events.append(event)
        return original(self_inner, event)

    with patch.object(AGUIBase, "_dispatch_event", new=_tracking):
        event = CustomEvent(
            type=EventType.CUSTOM,
            name=CustomEventNames.ManuallyEmitToolCall.value,
            value={
                "id": "tc-order-test",
                "name": "TestTool",
                "args": {"key": "value"},
            },
        )
        agent._dispatch_event(event)

    # Extract the three tool call events in the order they were dispatched
    tool_events = [
        e
        for e in dispatched_events
        if e.type
        in [
            EventType.TOOL_CALL_START,
            EventType.TOOL_CALL_ARGS,
            EventType.TOOL_CALL_END,
        ]
    ]

    assert len(tool_events) == 3, f"Expected 3 tool call events, got {len(tool_events)}"

    # Verify order: START -> ARGS -> END
    assert tool_events[0].type == EventType.TOOL_CALL_START, (
        "First event must be TOOL_CALL_START"
    )
    assert tool_events[1].type == EventType.TOOL_CALL_ARGS, (
        "Second event must be TOOL_CALL_ARGS"
    )
    assert tool_events[2].type == EventType.TOOL_CALL_END, (
        "Third event must be TOOL_CALL_END"
    )

    # All three should share the same tool_call_id
    assert tool_events[0].tool_call_id == "tc-order-test"
    assert tool_events[1].tool_call_id == "tc-order-test"
    assert tool_events[2].tool_call_id == "tc-order-test"


def test_tool_call_events_no_interleaving(agent):
    """Multiple tool calls should emit complete sequences without interleaving.

    This validates that if two tool calls are emitted in sequence, each
    complete START->ARGS->END sequence finishes before the next begins.
    """
    dispatched_events = []
    original = AGUIBase._dispatch_event

    def _tracking(self_inner, event):
        dispatched_events.append(event)
        return original(self_inner, event)

    with patch.object(AGUIBase, "_dispatch_event", new=_tracking):
        # Emit two tool calls in sequence
        event1 = CustomEvent(
            type=EventType.CUSTOM,
            name=CustomEventNames.ManuallyEmitToolCall.value,
            value={
                "id": "tc-1",
                "name": "FirstTool",
                "args": {"a": 1},
            },
        )
        agent._dispatch_event(event1)

        event2 = CustomEvent(
            type=EventType.CUSTOM,
            name=CustomEventNames.ManuallyEmitToolCall.value,
            value={
                "id": "tc-2",
                "name": "SecondTool",
                "args": {"b": 2},
            },
        )
        agent._dispatch_event(event2)

    # Extract tool call events
    tool_events = [
        e
        for e in dispatched_events
        if e.type
        in [
            EventType.TOOL_CALL_START,
            EventType.TOOL_CALL_ARGS,
            EventType.TOOL_CALL_END,
        ]
    ]

    # Should have 6 events total: 3 for tc-1, then 3 for tc-2
    assert len(tool_events) == 6

    # First three should all be tc-1
    assert tool_events[0].tool_call_id == "tc-1"
    assert tool_events[1].tool_call_id == "tc-1"
    assert tool_events[2].tool_call_id == "tc-1"

    # Last three should all be tc-2
    assert tool_events[3].tool_call_id == "tc-2"
    assert tool_events[4].tool_call_id == "tc-2"
    assert tool_events[5].tool_call_id == "tc-2"

    # Verify ordering within each sequence
    assert tool_events[0].type == EventType.TOOL_CALL_START
    assert tool_events[1].type == EventType.TOOL_CALL_ARGS
    assert tool_events[2].type == EventType.TOOL_CALL_END

    assert tool_events[3].type == EventType.TOOL_CALL_START
    assert tool_events[4].type == EventType.TOOL_CALL_ARGS
    assert tool_events[5].type == EventType.TOOL_CALL_END
