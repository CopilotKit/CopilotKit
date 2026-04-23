"""Tests for emit_messages/emit_tool_calls filtering in LangGraphAGUIAgent.

Covers the two bugs fixed in https://github.com/CopilotKit/CopilotKit/issues/2066:
  1. raw_event is a dict, so metadata must be read with .get() not getattr()
  2. Filtered events must return None (not ""), and run() must strip them
"""

import asyncio
import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from ag_ui.core import (
    EventType,
    TextMessageStartEvent,
    TextMessageContentEvent,
    ToolCallStartEvent,
)
from copilotkit.langgraph_agui_agent import LangGraphAGUIAgent


@pytest.fixture
def agent():
    """Create a LangGraphAGUIAgent with a mocked graph."""
    mock_graph = MagicMock()
    mock_graph.get_state = MagicMock()
    a = LangGraphAGUIAgent(name="test", graph=mock_graph)
    a.active_run = {"id": "run-1", "thread_id": "t-1"}
    return a


def _make_text_event(metadata: dict) -> TextMessageContentEvent:
    """Create a TEXT_MESSAGE_CONTENT event with a dict raw_event carrying metadata."""
    return TextMessageContentEvent(
        messageId="msg-1",
        delta="hello",
        rawEvent={"metadata": metadata},
    )


def _make_tool_event(metadata: dict) -> ToolCallStartEvent:
    """Create a TOOL_CALL_START event with a dict raw_event carrying metadata."""
    return ToolCallStartEvent(
        toolCallId="tc-1",
        toolCallName="some_tool",
        rawEvent={"metadata": metadata},
    )


# ---------- Bug 1: dict metadata reading via .get() ----------

class TestDictMetadataReading:
    """raw_event is a dict — metadata must be read with .get(), not getattr()."""

    def test_emit_messages_false_filters_text_event(self, agent):
        """emit-messages=False should suppress text message events."""
        event = _make_text_event({"copilotkit:emit-messages": False})
        result = agent._dispatch_event(event)
        assert result is None

    def test_emit_tool_calls_false_filters_tool_event(self, agent):
        """emit-tool-calls=False should suppress tool call events."""
        event = _make_tool_event({"copilotkit:emit-tool-calls": False})
        result = agent._dispatch_event(event)
        assert result is None

    def test_emit_messages_true_passes_through(self, agent):
        """emit-messages=True should NOT filter — event passes to super()."""
        event = _make_text_event({"copilotkit:emit-messages": True})
        result = agent._dispatch_event(event)
        # super()._dispatch_event returns the event object (not None or "")
        assert result is not None

    def test_no_metadata_key_passes_through(self, agent):
        """No emit- keys in metadata — event should pass through."""
        event = _make_text_event({"some-other-key": True})
        result = agent._dispatch_event(event)
        assert result is not None

    def test_empty_metadata_passes_through(self, agent):
        """Empty metadata dict — event should pass through."""
        event = _make_text_event({})
        result = agent._dispatch_event(event)
        assert result is not None


# ---------- Bug 2: filtered returns None, not "" ----------

class TestFilteredReturnValue:
    """Filtered events must return None (not empty string) to avoid encoder crash."""

    def test_filtered_message_returns_none_not_empty_string(self, agent):
        event = _make_text_event({"copilotkit:emit-messages": False})
        result = agent._dispatch_event(event)
        assert result is None, f"Expected None, got {result!r}"
        assert result != "", "Must not return empty string — crashes the encoder"

    def test_filtered_tool_call_returns_none_not_empty_string(self, agent):
        event = _make_tool_event({"copilotkit:emit-tool-calls": False})
        result = agent._dispatch_event(event)
        assert result is None, f"Expected None, got {result!r}"
        assert result != "", "Must not return empty string — crashes the encoder"


# ---------- run() filters out None values ----------

class TestRunFiltersNone:
    """The run() override must strip None values from the event stream."""

    def test_run_filters_none_events(self, agent):
        """None values from _dispatch_event should not appear in run() output."""

        # Mock super().run() to yield a mix of real events and None
        real_event = "data: {}\n\n"

        async def mock_super_run(self, input):
            yield real_event
            yield None
            yield real_event

        with patch.object(
            LangGraphAGUIAgent.__bases__[0],
            "run",
            new=mock_super_run,
        ):
            results = asyncio.run(
                _collect_async_gen(agent.run(MagicMock()))
            )

        assert results == [real_event, real_event]
        assert None not in results


async def _collect_async_gen(agen):
    """Collect all items from an async generator into a list."""
    items = []
    async for item in agen:
        items.append(item)
    return items


# ---------- Edge cases: missing / None rawEvent ----------

class TestMissingOrNoneRawEvent:
    """Events where rawEvent is absent or None should pass through to super() without crashing."""

    def test_none_raw_event_passes_through(self, agent):
        """Event with raw_event=None should not crash and should pass through."""
        event = TextMessageContentEvent(
            messageId="msg-1",
            delta="hello",
            rawEvent=None,
        )
        # Should not raise and should call super() (returning non-None)
        result = agent._dispatch_event(event)
        assert result is not None

    def test_event_without_raw_event_attr_passes_through(self, agent):
        """If raw_event attribute is missing entirely, should pass through."""
        # TextMessageStartEvent has rawEvent as optional, passing None simulates missing
        event = TextMessageStartEvent(
            messageId="msg-1",
            role="assistant",
            rawEvent=None,
        )
        result = agent._dispatch_event(event)
        assert result is not None


# ---------- Edge cases: None values for emit metadata keys ----------

class TestNoneEmitMetadataValues:
    """None values for emit metadata keys should NOT filter events (only False filters)."""

    def test_none_emit_messages_does_not_filter(self, agent):
        """copilotkit:emit-messages=None should not suppress text events (only False does)."""
        event = _make_text_event({"copilotkit:emit-messages": None})
        result = agent._dispatch_event(event)
        assert result is not None, "None value should not filter — only False suppresses"

    def test_none_emit_tool_calls_does_not_filter(self, agent):
        """copilotkit:emit-tool-calls=None should not suppress tool events."""
        event = _make_tool_event({"copilotkit:emit-tool-calls": None})
        result = agent._dispatch_event(event)
        assert result is not None

    def test_zero_emit_messages_does_not_filter(self, agent):
        """0 (falsy but not False) should not suppress text events (only False does)."""
        event = _make_text_event({"copilotkit:emit-messages": 0})
        result = agent._dispatch_event(event)
        assert result is not None
