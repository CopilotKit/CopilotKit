"""Tests for the optional `id` parameter on copilotkit_emit_tool_call.

Covers:
  1. LangGraph variant: default UUID generation, custom ID passthrough, return value
  2. CrewAI variant: default UUID generation, custom ID passthrough, return value
  3. AG-UI agent dispatch: custom ID propagates to all three TOOL_CALL events
"""

import json
import uuid
import pytest
from unittest.mock import MagicMock, AsyncMock, patch
from ag_ui.core import (
    EventType,
    CustomEvent,
)
from ag_ui_langgraph import LangGraphAgent as AGUIBase
from copilotkit.langgraph_agui_agent import (
    LangGraphAGUIAgent,
    CustomEventNames,
)


# ---- Fixtures ----


@pytest.fixture
def agent():
    """Create a LangGraphAGUIAgent with a mocked graph."""
    mock_graph = MagicMock()
    mock_graph.get_state = MagicMock()
    a = LangGraphAGUIAgent(name="test", graph=mock_graph)
    a.active_run = {"id": "run-1", "thread_id": "t-1"}
    return a


def _track_parent_dispatches(agent):
    """Collect events dispatched to the AG-UI base class."""
    from contextlib import contextmanager

    @contextmanager
    def _ctx():
        dispatched = []
        original = AGUIBase._dispatch_event

        def _tracking(self_inner, event):
            dispatched.append(event)
            return original(self_inner, event)

        with patch.object(AGUIBase, "_dispatch_event", new=_tracking):
            yield dispatched

    return _ctx()


# ---- LangGraph variant tests ----


class TestLangGraphEmitToolCallOptionalId:
    """copilotkit_emit_tool_call (langgraph) with optional id parameter."""

    @pytest.mark.asyncio
    async def test_default_generates_uuid(self):
        """When no id is provided, a UUID v4 string should be generated and returned."""
        with patch(
            "copilotkit.langgraph.adispatch_custom_event", new_callable=AsyncMock
        ) as mock_dispatch:
            from copilotkit.langgraph import copilotkit_emit_tool_call

            config = {"metadata": {}}
            result = await copilotkit_emit_tool_call(
                config, name="MyTool", args={"key": "val"}
            )

            assert isinstance(result, str)
            uuid.UUID(result)

            payload = mock_dispatch.call_args[0][1]
            assert payload["id"] == result
            assert payload["name"] == "MyTool"
            assert payload["args"] == {"key": "val"}

    @pytest.mark.asyncio
    async def test_custom_id_passthrough(self):
        """When a custom id is provided, it should be used as-is."""
        with patch(
            "copilotkit.langgraph.adispatch_custom_event", new_callable=AsyncMock
        ) as mock_dispatch:
            from copilotkit.langgraph import copilotkit_emit_tool_call

            config = {"metadata": {}}
            result = await copilotkit_emit_tool_call(
                config, name="MyTool", args={"key": "val"}, id="custom-id-123"
            )

            assert result == "custom-id-123"

            payload = mock_dispatch.call_args[0][1]
            assert payload["id"] == "custom-id-123"

    @pytest.mark.asyncio
    async def test_returns_generated_id(self):
        """The return value should be the tool call ID (generated or custom)."""
        with patch(
            "copilotkit.langgraph.adispatch_custom_event", new_callable=AsyncMock
        ):
            from copilotkit.langgraph import copilotkit_emit_tool_call

            config = {"metadata": {}}

            result_auto = await copilotkit_emit_tool_call(
                config, name="Tool", args={}
            )
            assert isinstance(result_auto, str)
            assert len(result_auto) > 0

            result_custom = await copilotkit_emit_tool_call(
                config, name="Tool", args={}, id="my-id"
            )
            assert result_custom == "my-id"

    @pytest.mark.asyncio
    async def test_none_id_generates_uuid(self):
        """Explicitly passing id=None should behave the same as omitting it."""
        with patch(
            "copilotkit.langgraph.adispatch_custom_event", new_callable=AsyncMock
        ) as mock_dispatch:
            from copilotkit.langgraph import copilotkit_emit_tool_call

            config = {"metadata": {}}
            result = await copilotkit_emit_tool_call(
                config, name="Tool", args={}, id=None
            )

            assert isinstance(result, str)
            uuid.UUID(result)
            assert mock_dispatch.call_args[0][1]["id"] == result


# ---- CrewAI variant tests ----

try:
    import crewai  # noqa: F401
    _has_crewai = True
except ImportError:
    _has_crewai = False


@pytest.mark.skipif(not _has_crewai, reason="crewai not installed")
class TestCrewAIEmitToolCallOptionalId:
    """copilotkit_emit_tool_call (crewai) with optional id parameter."""

    @pytest.mark.asyncio
    async def test_default_generates_uuid(self):
        """When no id is provided, a UUID v4 string should be generated and returned."""
        with patch(
            "copilotkit.crewai.crewai_sdk.queue_put", new_callable=AsyncMock
        ) as mock_queue:
            from copilotkit.crewai.crewai_sdk import copilotkit_emit_tool_call

            result = await copilotkit_emit_tool_call(
                name="MyTool", args={"key": "val"}
            )

            assert isinstance(result, str)
            uuid.UUID(result)

            first_call_arg = mock_queue.call_args[0][0]
            assert result in str(first_call_arg)

    @pytest.mark.asyncio
    async def test_custom_id_passthrough(self):
        """When a custom id is provided, it should be used as the message_id."""
        with patch(
            "copilotkit.crewai.crewai_sdk.queue_put", new_callable=AsyncMock
        ):
            from copilotkit.crewai.crewai_sdk import copilotkit_emit_tool_call

            result = await copilotkit_emit_tool_call(
                name="MyTool", args={"key": "val"}, id="crew-custom-id"
            )

            assert result == "crew-custom-id"

    @pytest.mark.asyncio
    async def test_returns_id(self):
        """Should return the tool call ID regardless of whether it was auto or custom."""
        with patch(
            "copilotkit.crewai.crewai_sdk.queue_put", new_callable=AsyncMock
        ):
            from copilotkit.crewai.crewai_sdk import copilotkit_emit_tool_call

            result_auto = await copilotkit_emit_tool_call(name="T", args={})
            assert isinstance(result_auto, str)
            assert len(result_auto) > 0

            result_custom = await copilotkit_emit_tool_call(
                name="T", args={}, id="explicit"
            )
            assert result_custom == "explicit"


# ---- AG-UI dispatch: custom ID propagates through all events ----


class TestCustomIdPropagatesThroughAGUI:
    """When a custom id is used, the downstream AG-UI events carry that exact ID."""

    def test_custom_id_in_all_tool_call_events(self, agent):
        """TOOL_CALL_START, TOOL_CALL_ARGS, and TOOL_CALL_END should all carry the custom id."""
        with _track_parent_dispatches(agent) as dispatched:
            event = CustomEvent(
                type=EventType.CUSTOM,
                name=CustomEventNames.ManuallyEmitToolCall.value,
                value={
                    "id": "user-provided-id-42",
                    "name": "CustomTool",
                    "args": {"x": 1},
                },
            )
            agent._dispatch_event(event)

        tool_events = [e for e in dispatched if hasattr(e, "tool_call_id")]
        assert len(tool_events) == 3
        for e in tool_events:
            assert e.tool_call_id == "user-provided-id-42"

    def test_custom_id_in_parent_message_id(self, agent):
        """ToolCallStartEvent.parent_message_id should match the custom id."""
        with _track_parent_dispatches(agent) as dispatched:
            event = CustomEvent(
                type=EventType.CUSTOM,
                name=CustomEventNames.ManuallyEmitToolCall.value,
                value={
                    "id": "parent-test-id",
                    "name": "ParentTool",
                    "args": {},
                },
            )
            agent._dispatch_event(event)

        start_events = [
            e for e in dispatched if e.type == EventType.TOOL_CALL_START
        ]
        assert len(start_events) == 1
        assert start_events[0].parent_message_id == "parent-test-id"

    def test_custom_id_with_dict_args_serialized(self, agent):
        """Custom id + dict args should both work: args JSON-serialized, id preserved."""
        with _track_parent_dispatches(agent) as dispatched:
            event = CustomEvent(
                type=EventType.CUSTOM,
                name=CustomEventNames.ManuallyEmitToolCall.value,
                value={
                    "id": "combo-test",
                    "name": "ComboTool",
                    "args": {"nested": {"deep": True}},
                },
            )
            agent._dispatch_event(event)

        args_events = [e for e in dispatched if e.type == EventType.TOOL_CALL_ARGS]
        assert len(args_events) == 1
        assert args_events[0].tool_call_id == "combo-test"
        assert json.loads(args_events[0].delta) == {"nested": {"deep": True}}
