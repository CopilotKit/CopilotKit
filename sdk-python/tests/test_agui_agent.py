"""Tests for LangGraphAGUIAgent — CopilotKit's extension layer on top of AG-UI's base agent.

Covers:
  1. Custom event handling (_dispatch_event with CopilotKit-specific custom events)
  2. copilotkit state namespace (langgraph_default_merge_state)
  3. Unknown custom events pass through without crashing
"""

import json
import pytest
from contextlib import contextmanager
from unittest.mock import MagicMock, patch
from ag_ui.core import (
    EventType,
    CustomEvent,
    TextMessageStartEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    ToolCallStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    StateSnapshotEvent,
)
from ag_ui_langgraph import LangGraphAgent as AGUIBase
from copilotkit.langgraph_agui_agent import (
    LangGraphAGUIAgent,
    CustomEventNames,
)


# The source code at langgraph_agui_agent.py:134 checks for the literal string
# "copilotkit_exit" (not via CustomEventNames enum — exit was never added to it).
# We intentionally match the source's literal here.
COPILOTKIT_EXIT_EVENT_NAME = "copilotkit_exit"

# The output event name "Exit" is a hardcoded downstream value in the source code
# (langgraph_agui_agent.py:138), distinct from any CustomEventNames constant.
EXIT_OUTPUT_NAME = "Exit"


@pytest.fixture
def agent():
    """Create a LangGraphAGUIAgent with a mocked graph."""
    mock_graph = MagicMock()
    mock_graph.get_state = MagicMock()
    a = LangGraphAGUIAgent(name="test", graph=mock_graph)
    a.active_run = {"id": "run-1", "thread_id": "t-1"}
    return a


@contextmanager
def track_parent_dispatches(agent):
    """Patch AGUIBase._dispatch_event to record all dispatched events.

    Yields the list of captured events. The original dispatch is still called
    so that event serialisation behaves normally.

    Usage::

        with track_parent_dispatches(agent) as dispatched:
            agent._dispatch_event(some_event)
        assert EventType.TEXT_MESSAGE_START in [e.type for e in dispatched]
    """
    dispatched = []
    original = AGUIBase._dispatch_event

    def _tracking(self_inner, event):
        dispatched.append(event)
        return original(self_inner, event)

    with patch.object(AGUIBase, "_dispatch_event", new=_tracking):
        yield dispatched


# ---------- Custom event: ManuallyEmitMessage ----------

class TestManuallyEmitMessage:
    """copilotkit_manually_emit_message → TEXT_MESSAGE_START/CONTENT/END sequence."""

    def test_emits_text_message_sequence(self, agent):
        """Should call super()._dispatch_event for start, content, end, and the custom event."""
        with track_parent_dispatches(agent) as dispatched:
            event = CustomEvent(
                type=EventType.CUSTOM,
                name=CustomEventNames.ManuallyEmitMessage.value,
                value={
                    "message_id": "msg-123",
                    "message": "Hello world",
                    "role": "assistant",
                },
            )
            agent._dispatch_event(event)

        types = [getattr(e, 'type', None) for e in dispatched]
        assert EventType.TEXT_MESSAGE_START in types
        assert EventType.TEXT_MESSAGE_CONTENT in types
        assert EventType.TEXT_MESSAGE_END in types

    def test_message_ids_match(self, agent):
        """All emitted events should carry the same message_id from the custom event."""
        with track_parent_dispatches(agent) as dispatched:
            event = CustomEvent(
                type=EventType.CUSTOM,
                name=CustomEventNames.ManuallyEmitMessage.value,
                value={
                    "message_id": "msg-456",
                    "message": "test",
                    "role": "assistant",
                },
            )
            agent._dispatch_event(event)

        message_events = [e for e in dispatched if hasattr(e, 'message_id')]
        for e in message_events:
            assert e.message_id == "msg-456"

    def test_content_delta_matches(self, agent):
        """TextMessageContentEvent should carry the message text as delta."""
        with track_parent_dispatches(agent) as dispatched:
            event = CustomEvent(
                type=EventType.CUSTOM,
                name=CustomEventNames.ManuallyEmitMessage.value,
                value={
                    "message_id": "msg-789",
                    "message": "specific content",
                    "role": "assistant",
                },
            )
            agent._dispatch_event(event)

        content_events = [e for e in dispatched if e.type == EventType.TEXT_MESSAGE_CONTENT]
        assert len(content_events) == 1
        assert content_events[0].delta == "specific content"


# ---------- Custom event: ManuallyEmitToolCall ----------

class TestManuallyEmitToolCall:
    """copilotkit_manually_emit_tool_call → TOOL_CALL_START/ARGS/END sequence."""

    def test_emits_tool_call_sequence(self, agent):
        """Should dispatch start, args, end for a tool call."""
        with track_parent_dispatches(agent) as dispatched:
            event = CustomEvent(
                type=EventType.CUSTOM,
                name=CustomEventNames.ManuallyEmitToolCall.value,
                value={
                    "id": "tc-123",
                    "name": "SearchTool",
                    "args": {"query": "test"},
                },
            )
            agent._dispatch_event(event)

        types = [getattr(e, 'type', None) for e in dispatched]
        assert EventType.TOOL_CALL_START in types
        assert EventType.TOOL_CALL_ARGS in types
        assert EventType.TOOL_CALL_END in types

    def test_tool_call_ids_match(self, agent):
        """All tool call events should carry the same tool_call_id."""
        with track_parent_dispatches(agent) as dispatched:
            event = CustomEvent(
                type=EventType.CUSTOM,
                name=CustomEventNames.ManuallyEmitToolCall.value,
                value={
                    "id": "tc-456",
                    "name": "MyTool",
                    "args": {"key": "val"},
                },
            )
            agent._dispatch_event(event)

        tool_events = [e for e in dispatched if hasattr(e, 'tool_call_id')]
        for e in tool_events:
            assert e.tool_call_id == "tc-456"

    def test_args_serialized_as_json_when_dict(self, agent):
        """When args is a dict, it should be JSON-serialized in the TOOL_CALL_ARGS event."""
        with track_parent_dispatches(agent) as dispatched:
            event = CustomEvent(
                type=EventType.CUSTOM,
                name=CustomEventNames.ManuallyEmitToolCall.value,
                value={
                    "id": "tc-789",
                    "name": "MyTool",
                    "args": {"key": "value"},
                },
            )
            agent._dispatch_event(event)

        args_events = [e for e in dispatched if e.type == EventType.TOOL_CALL_ARGS]
        assert len(args_events) == 1
        assert args_events[0].delta == json.dumps({"key": "value"})

    def test_args_passed_as_string_when_string(self, agent):
        """When args is already a string, it should be passed through as-is."""
        with track_parent_dispatches(agent) as dispatched:
            event = CustomEvent(
                type=EventType.CUSTOM,
                name=CustomEventNames.ManuallyEmitToolCall.value,
                value={
                    "id": "tc-str",
                    "name": "MyTool",
                    "args": '{"already": "serialized"}',
                },
            )
            agent._dispatch_event(event)

        args_events = [e for e in dispatched if e.type == EventType.TOOL_CALL_ARGS]
        assert len(args_events) == 1
        assert args_events[0].delta == '{"already": "serialized"}'


# ---------- Custom event: ManuallyEmitState ----------

class TestManuallyEmitState:
    """copilotkit_manually_emit_intermediate_state → StateSnapshotEvent."""

    def test_emits_state_snapshot(self, agent):
        """Should set active_run['manually_emitted_state'] and dispatch a STATE_SNAPSHOT."""
        agent.get_state_snapshot = MagicMock(return_value={"progress": 50})

        with track_parent_dispatches(agent) as dispatched:
            event = CustomEvent(
                type=EventType.CUSTOM,
                name=CustomEventNames.ManuallyEmitState.value,
                value={"progress": 50},
            )
            agent._dispatch_event(event)

        assert agent.active_run["manually_emitted_state"] == {"progress": 50}
        types = [getattr(e, 'type', None) for e in dispatched]
        assert EventType.STATE_SNAPSHOT in types


# ---------- Custom event: copilotkit_exit ----------

class TestCopilotKitExit:
    """copilotkit_exit → CustomEvent with name='Exit'."""

    def test_emits_exit_event(self, agent):
        """Should dispatch a CustomEvent with name 'Exit'."""
        with track_parent_dispatches(agent) as dispatched:
            event = CustomEvent(
                type=EventType.CUSTOM,
                name=COPILOTKIT_EXIT_EVENT_NAME,
                value={},
            )
            agent._dispatch_event(event)

        exit_events = [
            e for e in dispatched
            if e.type == EventType.CUSTOM and getattr(e, 'name', None) == EXIT_OUTPUT_NAME
        ]
        assert len(exit_events) == 1


# ---------- Unknown custom events ----------

class TestUnknownCustomEvent:
    """Unknown custom event names should pass through to super() without crashing."""

    def test_unknown_custom_event_passes_through(self, agent):
        """An unrecognized custom event name should not raise and should call super()."""
        event = CustomEvent(
            type=EventType.CUSTOM,
            name="some_unknown_event",
            value={"data": "test"},
        )
        result = agent._dispatch_event(event)
        assert result is not None


# ---------- Emit filtering (independent of tool calls) ----------

class TestEmitFilteringIndependent:
    """Test that both emit-messages and emit-tool-calls can be set independently."""

    def test_emit_messages_false_tool_calls_true(self, agent):
        """emit-messages=False should filter text events but not tool events."""
        metadata = {
            "copilotkit:emit-messages": False,
            "copilotkit:emit-tool-calls": True,
        }
        text_event = TextMessageContentEvent(
            messageId="msg-1",
            delta="hello",
            rawEvent={"metadata": metadata},
        )
        tool_event = ToolCallStartEvent(
            toolCallId="tc-1",
            toolCallName="tool",
            rawEvent={"metadata": metadata},
        )
        assert agent._dispatch_event(text_event) is None
        assert agent._dispatch_event(tool_event) is not None

    def test_emit_tool_calls_false_messages_true(self, agent):
        """emit-tool-calls=False should filter tool events but not text events."""
        metadata = {
            "copilotkit:emit-messages": True,
            "copilotkit:emit-tool-calls": False,
        }
        text_event = TextMessageContentEvent(
            messageId="msg-1",
            delta="hello",
            rawEvent={"metadata": metadata},
        )
        tool_event = ToolCallStartEvent(
            toolCallId="tc-1",
            toolCallName="tool",
            rawEvent={"metadata": metadata},
        )
        assert agent._dispatch_event(text_event) is not None
        assert agent._dispatch_event(tool_event) is None

    def test_both_false_filters_both(self, agent):
        """Both flags false should filter both types."""
        metadata = {
            "copilotkit:emit-messages": False,
            "copilotkit:emit-tool-calls": False,
        }
        text_event = TextMessageContentEvent(
            messageId="msg-1",
            delta="hello",
            rawEvent={"metadata": metadata},
        )
        tool_event = ToolCallStartEvent(
            toolCallId="tc-1",
            toolCallName="tool",
            rawEvent={"metadata": metadata},
        )
        assert agent._dispatch_event(text_event) is None
        assert agent._dispatch_event(tool_event) is None


# ---------- copilotkit state namespace ----------

class TestLanggraphDefaultMergeState:
    """langgraph_default_merge_state adds copilotkit namespace with actions and context."""

    def test_copilotkit_actions_from_agui_tools(self, agent):
        """Tools from ag-ui should appear under copilotkit.actions."""
        tools = [{"name": "tool1"}, {"name": "tool2"}]
        with patch.object(
            AGUIBase,
            "langgraph_default_merge_state",
            return_value={
                "ag-ui": {"tools": tools, "context": []},
                "messages": [],
            },
        ):
            result = agent.langgraph_default_merge_state({}, [], MagicMock())

        assert "copilotkit" in result
        assert result["copilotkit"]["actions"] == tools

    def test_copilotkit_context_from_agui(self, agent):
        """Context from ag-ui should appear under copilotkit.context."""
        context = [{"description": "user info", "value": "test"}]
        with patch.object(
            AGUIBase,
            "langgraph_default_merge_state",
            return_value={
                "ag-ui": {"tools": [], "context": context},
                "messages": [],
            },
        ):
            result = agent.langgraph_default_merge_state({}, [], MagicMock())

        assert result["copilotkit"]["context"] == context

    def test_no_agui_key_no_crash(self, agent):
        """If no ag-ui key in state, should use merged_state as fallback without crashing."""
        with patch.object(
            AGUIBase,
            "langgraph_default_merge_state",
            return_value={"messages": [], "tools": [{"name": "fallback"}]},
        ):
            result = agent.langgraph_default_merge_state({}, [], MagicMock())

        assert "copilotkit" in result
        assert result["copilotkit"]["actions"] == [{"name": "fallback"}]

    def test_empty_state_no_crash(self, agent):
        """Completely empty state should not crash."""
        with patch.object(
            AGUIBase,
            "langgraph_default_merge_state",
            return_value={},
        ):
            result = agent.langgraph_default_merge_state({}, [], MagicMock())

        assert "copilotkit" in result
        assert result["copilotkit"]["actions"] == []
        assert result["copilotkit"]["context"] == []

    def test_preserves_original_state_keys(self, agent):
        """Original keys from super() should be preserved alongside copilotkit."""
        with patch.object(
            AGUIBase,
            "langgraph_default_merge_state",
            return_value={
                "ag-ui": {"tools": [], "context": []},
                "messages": [{"role": "user", "content": "hi"}],
                "custom_key": "custom_value",
            },
        ):
            result = agent.langgraph_default_merge_state({}, [], MagicMock())

        assert result["custom_key"] == "custom_value"
        assert result["messages"] == [{"role": "user", "content": "hi"}]

    def test_duplicate_tools_not_in_copilotkit_actions(self, agent):
        """Tools should not be duplicated in copilotkit.actions when same name appears in input and state."""
        tools = [{"name": "tool_a"}, {"name": "tool_b"}]
        with patch.object(
            AGUIBase,
            "langgraph_default_merge_state",
            return_value={
                "ag-ui": {"tools": tools, "context": []},
                "messages": [],
            },
        ):
            result = agent.langgraph_default_merge_state({}, [], MagicMock())

        action_names = [a.get("name") for a in result["copilotkit"]["actions"]]
        assert action_names.count("tool_a") == 1, "Duplicate tool names should not appear in copilotkit.actions"
        assert action_names.count("tool_b") == 1

    def test_copilotkit_actions_ordering_matches_tools(self, agent):
        """copilotkit.actions should have the same ordering as the merged tools list."""
        tools = [{"name": "first"}, {"name": "second"}, {"name": "third"}]
        with patch.object(
            AGUIBase,
            "langgraph_default_merge_state",
            return_value={
                "ag-ui": {"tools": tools, "context": []},
                "messages": [],
            },
        ):
            result = agent.langgraph_default_merge_state({}, [], MagicMock())

        action_names = [a.get("name") for a in result["copilotkit"]["actions"]]
        assert action_names == ["first", "second", "third"]


# ---------- Reasoning content preservation ----------

class TestReasoningContentPreservation:
    """Verify that LangGraphAGUIAgent does not drop or mutate reasoning events."""

    def test_unknown_custom_event_does_not_suppress_reasoning(self, agent):
        """An unrecognized custom event should pass through (not suppress subsequent reasoning events)."""
        # Dispatch a non-CopilotKit custom event — should pass through without crash
        unknown_event = CustomEvent(
            type=EventType.CUSTOM,
            name="some_unknown_custom_event",
            value={"reasoning": "chain-of-thought text"},
        )
        result = agent._dispatch_event(unknown_event)
        # Should pass through to super() and return something (not None)
        assert result is not None

    def test_manually_emit_tool_call_with_empty_args(self, agent):
        """ManuallyEmitToolCall with empty args dict should still emit the tool call sequence."""
        with track_parent_dispatches(agent) as dispatched:
            event = CustomEvent(
                type=EventType.CUSTOM,
                name=CustomEventNames.ManuallyEmitToolCall.value,
                value={
                    "id": "tc-empty",
                    "name": "MyTool",
                    "args": {},
                },
            )
            agent._dispatch_event(event)

        types = [getattr(e, 'type', None) for e in dispatched]
        assert EventType.TOOL_CALL_START in types
        assert EventType.TOOL_CALL_ARGS in types
        assert EventType.TOOL_CALL_END in types


# ---------- AG-UI-style (unprefixed) event integration ----------

class TestAGUIStyleEventIntegration:
    """Verify that AG-UI-native (unprefixed) events flow correctly through CopilotKit.

    CopilotKit's _dispatch_event only intercepts copilotkit_-prefixed CUSTOM events;
    unprefixed AG-UI events (manually_emit_message, manually_emit_tool_call, exit) are
    delegated to the AG-UI base class — never suppressed or double-converted by CopilotKit.
    """

    def _make_agent(self):
        mock_graph = MagicMock()
        mock_graph.get_state = MagicMock()
        agent = LangGraphAGUIAgent(name="test", graph=mock_graph)
        agent.active_run = {
            "id": "run-1", "thread_id": "t1",
            "reasoning_process": None, "node_name": "agent",
            "has_function_streaming": False, "model_made_tool_call": False,
            "state_reliable": True, "streamed_messages": [],
            "manually_emitted_state": None,
            "schema_keys": {
                "input": ["messages", "tools"],
                "output": ["messages", "tools"],
                "config": [],
                "context": [],
            },
        }
        return agent

    def test_agui_manually_emit_message_produces_text_events(self):
        """on_custom_event/"manually_emit_message" through CopilotKit should produce
        TEXT_MESSAGE_START/CONTENT/END via the AG-UI base handler — not suppressed."""
        import asyncio
        agent = self._make_agent()
        lg_event = {
            "event": "on_custom_event",
            "name": "manually_emit_message",
            "data": {"message_id": "msg-1", "message": "Hello", "role": "assistant"},
            "metadata": {},
        }

        async def _run():
            async for _ in agent._handle_single_event(lg_event, {}):
                pass

        with track_parent_dispatches(agent) as dispatched:
            asyncio.run(_run())

        types = [e.type for e in dispatched]
        assert EventType.TEXT_MESSAGE_START in types
        assert EventType.TEXT_MESSAGE_CONTENT in types
        assert EventType.TEXT_MESSAGE_END in types

    def test_agui_manually_emit_tool_call_produces_tool_events(self):
        """on_custom_event/"manually_emit_tool_call" through CopilotKit should produce
        TOOL_CALL_START/ARGS/END via the AG-UI base handler."""
        import asyncio
        agent = self._make_agent()
        lg_event = {
            "event": "on_custom_event",
            "name": "manually_emit_tool_call",
            "data": {"id": "tc-1", "name": "search", "args": {"q": "weather"}},
            "metadata": {},
        }

        async def _run():
            async for _ in agent._handle_single_event(lg_event, {}):
                pass

        with track_parent_dispatches(agent) as dispatched:
            asyncio.run(_run())

        types = [e.type for e in dispatched]
        assert EventType.TOOL_CALL_START in types
        assert EventType.TOOL_CALL_ARGS in types
        assert EventType.TOOL_CALL_END in types

    def test_agui_exit_produces_custom_event(self):
        """on_custom_event/"exit" through CopilotKit should emit a CUSTOM event —
        the exit signal is not suppressed by the CopilotKit layer."""
        import asyncio
        agent = self._make_agent()
        lg_event = {
            "event": "on_custom_event",
            "name": "exit",
            "data": {},
            "metadata": {},
        }

        async def _run():
            async for _ in agent._handle_single_event(lg_event, {}):
                pass

        with track_parent_dispatches(agent) as dispatched:
            asyncio.run(_run())

        types = [e.type for e in dispatched]
        assert EventType.CUSTOM in types

    def test_agui_style_event_not_suppressed_by_dispatch(self):
        """A CUSTOM event with an AG-UI-style unprefixed name passed to CopilotKit's
        _dispatch_event should be forwarded to the base class unchanged.

        CopilotKit only converts copilotkit_-prefixed events (e.g. copilotkit_manually_emit_message
        → TEXT_MESSAGE_*). An unprefixed "manually_emit_message" CustomEvent must not trigger
        that conversion path — no TEXT_MESSAGE_START should be injected, and the original
        event object must be forwarded as-is."""
        agent = self._make_agent()
        original = CustomEvent(
            type=EventType.CUSTOM,
            name="manually_emit_message",
            value={"message_id": "msg-2", "message": "test", "role": "assistant"},
        )
        with track_parent_dispatches(agent) as dispatched:
            agent._dispatch_event(original)

        types = [e.type for e in dispatched]
        assert EventType.CUSTOM in types
        assert EventType.TEXT_MESSAGE_START not in types
        assert dispatched[0] is original
