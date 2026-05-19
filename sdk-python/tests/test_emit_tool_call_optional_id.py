"""Tests for the optional `id` parameter on copilotkit_emit_tool_call.

Covers:
  1. LangGraph variant: default UUID generation, custom ID passthrough, return value
  2. CrewAI variant: default UUID generation, custom ID passthrough, return value
  3. AG-UI agent dispatch: custom ID propagates to all three TOOL_CALL events
  4. AG-UI dispatch validation: defensive CopilotKitMisuseError paths for
     missing/invalid id, name, args, non-serializable args, and non-dict value
"""

import asyncio
import json
import logging
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
from copilotkit.exc import CopilotKitMisuseError


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
                config, name="MyTool", args={"key": "val"}, tool_call_id="custom-id-123"
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

            result_auto = await copilotkit_emit_tool_call(config, name="Tool", args={})
            assert isinstance(result_auto, str)
            assert len(result_auto) > 0

            result_custom = await copilotkit_emit_tool_call(
                config, name="Tool", args={}, tool_call_id="my-id"
            )
            assert result_custom == "my-id"

    @pytest.mark.asyncio
    async def test_none_id_generates_uuid(self):
        """Explicitly passing tool_call_id=None should behave the same as omitting it."""
        with patch(
            "copilotkit.langgraph.adispatch_custom_event", new_callable=AsyncMock
        ) as mock_dispatch:
            from copilotkit.langgraph import copilotkit_emit_tool_call

            config = {"metadata": {}}
            result = await copilotkit_emit_tool_call(
                config, name="Tool", args={}, tool_call_id=None
            )

            assert isinstance(result, str)
            uuid.UUID(result)
            assert mock_dispatch.call_args[0][1]["id"] == result

    @pytest.mark.asyncio
    async def test_empty_string_id_raises(self):
        """Passing an empty string should raise ValueError."""
        with patch(
            "copilotkit.langgraph.adispatch_custom_event", new_callable=AsyncMock
        ):
            from copilotkit.langgraph import copilotkit_emit_tool_call

            config = {"metadata": {}}
            with pytest.raises(ValueError, match="non-empty string"):
                await copilotkit_emit_tool_call(
                    config, name="Tool", args={}, tool_call_id=""
                )

    @pytest.mark.asyncio
    async def test_whitespace_only_id_raises(self):
        """Passing a whitespace-only string should raise ValueError."""
        with patch(
            "copilotkit.langgraph.adispatch_custom_event", new_callable=AsyncMock
        ):
            from copilotkit.langgraph import copilotkit_emit_tool_call

            config = {"metadata": {}}
            with pytest.raises(ValueError, match="non-empty string"):
                await copilotkit_emit_tool_call(
                    config, name="Tool", args={}, tool_call_id="   "
                )

    @pytest.mark.asyncio
    async def test_whitespace_only_name_raises(self):
        """Passing a whitespace-only name should raise CopilotKitMisuseError."""
        with patch(
            "copilotkit.langgraph.adispatch_custom_event", new_callable=AsyncMock
        ):
            from copilotkit.langgraph import copilotkit_emit_tool_call

            config = {"metadata": {}}
            with pytest.raises(CopilotKitMisuseError, match="non-empty string"):
                await copilotkit_emit_tool_call(config, name="   ", args={})

    @pytest.mark.asyncio
    async def test_empty_name_raises(self):
        """Passing an empty name should raise CopilotKitMisuseError."""
        with patch(
            "copilotkit.langgraph.adispatch_custom_event", new_callable=AsyncMock
        ):
            from copilotkit.langgraph import copilotkit_emit_tool_call

            config = {"metadata": {}}
            with pytest.raises(CopilotKitMisuseError, match="non-empty string"):
                await copilotkit_emit_tool_call(config, name="", args={})

    @pytest.mark.asyncio
    async def test_non_serializable_args_raises(self):
        """Passing non-JSON-serializable args should raise CopilotKitMisuseError."""
        with patch(
            "copilotkit.langgraph.adispatch_custom_event", new_callable=AsyncMock
        ):
            from copilotkit.langgraph import copilotkit_emit_tool_call

            config = {"metadata": {}}
            with pytest.raises(CopilotKitMisuseError, match="not JSON-serializable"):
                await copilotkit_emit_tool_call(
                    config, name="Tool", args={"bad": {1, 2, 3}}
                )

    @pytest.mark.asyncio
    async def test_cancelled_error_propagates_from_post_dispatch_sleep(self):
        """CancelledError during the shielded post-dispatch sleep must propagate."""
        with patch(
            "copilotkit.langgraph.adispatch_custom_event", new_callable=AsyncMock
        ) as mock_dispatch:
            from copilotkit.langgraph import copilotkit_emit_tool_call

            config = {"metadata": {}}

            async def _run_and_cancel():
                task = asyncio.current_task()
                # Schedule cancellation after dispatch completes but during sleep
                original_sleep = asyncio.sleep

                async def _cancel_during_sleep(delay):
                    task.cancel()
                    await original_sleep(0)

                with patch(
                    "copilotkit.langgraph.asyncio.sleep",
                    side_effect=_cancel_during_sleep,
                ):
                    with patch(
                        "copilotkit.langgraph.asyncio.shield",
                        side_effect=lambda coro: coro,
                    ):
                        return await copilotkit_emit_tool_call(
                            config,
                            name="CancelTool",
                            args={},
                            tool_call_id="cancel-test-id",
                        )

            with pytest.raises(asyncio.CancelledError):
                await _run_and_cancel()

            mock_dispatch.assert_called_once()

    @pytest.mark.asyncio
    async def test_cancelled_error_logs_warning(self, caplog):
        """CancelledError during post-dispatch sleep should log with the tool_call_id."""
        with patch(
            "copilotkit.langgraph.adispatch_custom_event", new_callable=AsyncMock
        ):
            from copilotkit.langgraph import copilotkit_emit_tool_call

            config = {"metadata": {}}

            async def _cancel_sleep(delay):
                raise asyncio.CancelledError()

            with caplog.at_level(logging.WARNING, logger="copilotkit.langgraph"):
                with patch(
                    "copilotkit.langgraph.asyncio.sleep", side_effect=_cancel_sleep
                ):
                    with patch(
                        "copilotkit.langgraph.asyncio.shield",
                        side_effect=lambda coro: coro,
                    ):
                        with pytest.raises(asyncio.CancelledError):
                            await copilotkit_emit_tool_call(
                                config,
                                name="Tool",
                                args={},
                                tool_call_id="log-cancel-id",
                            )

            assert any("log-cancel-id" in record.message for record in caplog.records)


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

            result = await copilotkit_emit_tool_call(name="MyTool", args={"key": "val"})

            assert isinstance(result, str)
            uuid.UUID(result)

            start_ev, args_ev, end_ev = mock_queue.call_args[0]
            assert start_ev["actionExecutionId"] == result
            assert start_ev["parentMessageId"] == result
            assert start_ev["actionName"] == "MyTool"
            assert args_ev["actionExecutionId"] == result
            assert json.loads(args_ev["args"]) == {"key": "val"}
            assert end_ev["actionExecutionId"] == result

    @pytest.mark.asyncio
    async def test_custom_id_passthrough(self):
        """When a custom id is provided, it should be used as the message_id."""
        with patch(
            "copilotkit.crewai.crewai_sdk.queue_put", new_callable=AsyncMock
        ) as mock_queue:
            from copilotkit.crewai.crewai_sdk import copilotkit_emit_tool_call

            result = await copilotkit_emit_tool_call(
                name="MyTool", args={"key": "val"}, tool_call_id="crew-custom-id"
            )

            assert result == "crew-custom-id"

            start_ev, args_ev, end_ev = mock_queue.call_args[0]
            assert start_ev["actionExecutionId"] == "crew-custom-id"
            assert start_ev["parentMessageId"] == "crew-custom-id"
            assert args_ev["actionExecutionId"] == "crew-custom-id"
            assert end_ev["actionExecutionId"] == "crew-custom-id"

    @pytest.mark.asyncio
    async def test_returns_id(self):
        """Should return the tool call ID regardless of whether it was auto or custom."""
        with patch("copilotkit.crewai.crewai_sdk.queue_put", new_callable=AsyncMock):
            from copilotkit.crewai.crewai_sdk import copilotkit_emit_tool_call

            result_auto = await copilotkit_emit_tool_call(name="T", args={})
            assert isinstance(result_auto, str)
            assert len(result_auto) > 0

            result_custom = await copilotkit_emit_tool_call(
                name="T", args={}, tool_call_id="explicit"
            )
            assert result_custom == "explicit"

    @pytest.mark.asyncio
    async def test_empty_string_id_raises(self):
        """Passing an empty string should raise ValueError."""
        with patch("copilotkit.crewai.crewai_sdk.queue_put", new_callable=AsyncMock):
            from copilotkit.crewai.crewai_sdk import copilotkit_emit_tool_call

            with pytest.raises(ValueError, match="non-empty string"):
                await copilotkit_emit_tool_call(name="Tool", args={}, tool_call_id="")

    @pytest.mark.asyncio
    async def test_whitespace_only_id_raises(self):
        """Passing a whitespace-only string should raise ValueError."""
        with patch("copilotkit.crewai.crewai_sdk.queue_put", new_callable=AsyncMock):
            from copilotkit.crewai.crewai_sdk import copilotkit_emit_tool_call

            with pytest.raises(ValueError, match="non-empty string"):
                await copilotkit_emit_tool_call(
                    name="Tool", args={}, tool_call_id="   "
                )

    @pytest.mark.asyncio
    async def test_none_id_generates_uuid(self):
        """Explicitly passing tool_call_id=None should behave the same as omitting it."""
        with patch("copilotkit.crewai.crewai_sdk.queue_put", new_callable=AsyncMock):
            from copilotkit.crewai.crewai_sdk import copilotkit_emit_tool_call

            result = await copilotkit_emit_tool_call(
                name="Tool", args={}, tool_call_id=None
            )
            assert isinstance(result, str)
            uuid.UUID(result)

    @pytest.mark.asyncio
    async def test_whitespace_only_name_raises(self):
        """Passing a whitespace-only name should raise CopilotKitMisuseError."""
        with patch("copilotkit.crewai.crewai_sdk.queue_put", new_callable=AsyncMock):
            from copilotkit.crewai.crewai_sdk import copilotkit_emit_tool_call

            with pytest.raises(CopilotKitMisuseError, match="non-empty string"):
                await copilotkit_emit_tool_call(name="   ", args={})

    @pytest.mark.asyncio
    async def test_non_serializable_args_raises(self):
        """Passing non-JSON-serializable args should raise CopilotKitMisuseError."""
        with patch("copilotkit.crewai.crewai_sdk.queue_put", new_callable=AsyncMock):
            from copilotkit.crewai.crewai_sdk import copilotkit_emit_tool_call

            with pytest.raises(CopilotKitMisuseError, match="not JSON-serializable"):
                await copilotkit_emit_tool_call(name="Tool", args={"bad": {1, 2, 3}})


# ---- CrewAI variant: compensating action_execution_end tests ----


@pytest.mark.skipif(not _has_crewai, reason="crewai not installed")
class TestCrewAICompensatingEnd:
    """Tests for the compensating action_execution_end when dispatch fails mid-stream."""

    @pytest.mark.asyncio
    async def test_failure_after_start_emits_compensating_end(self):
        """If args queue_put fails after start was dispatched, a compensating end is emitted."""
        call_count = 0
        original_queue_put = None

        async def _failing_queue_put(*events):
            nonlocal call_count
            call_count += 1
            if call_count == 2:
                raise RuntimeError("queue closed")

        with patch("copilotkit.crewai.crewai_sdk.queue_put", new=_failing_queue_put):
            from copilotkit.crewai.crewai_sdk import copilotkit_emit_tool_call

            with pytest.raises(RuntimeError, match="queue closed"):
                await copilotkit_emit_tool_call(
                    name="FailTool", args={"x": 1}, tool_call_id="comp-crew-1"
                )

        assert call_count == 3

    @pytest.mark.asyncio
    async def test_failure_on_start_does_not_emit_compensating_end(self):
        """If start queue_put itself fails, no compensating end is dispatched."""
        call_count = 0

        async def _failing_queue_put(*events):
            nonlocal call_count
            call_count += 1
            raise RuntimeError("start failed")

        with patch("copilotkit.crewai.crewai_sdk.queue_put", new=_failing_queue_put):
            from copilotkit.crewai.crewai_sdk import copilotkit_emit_tool_call

            with pytest.raises(RuntimeError, match="start failed"):
                await copilotkit_emit_tool_call(
                    name="FailTool", args={}, tool_call_id="comp-crew-2"
                )

        assert call_count == 1

    @pytest.mark.asyncio
    async def test_compensating_end_failure_reraises_original(self):
        """If the compensating end also fails, the original error still propagates."""
        call_count = 0

        async def _failing_queue_put(*events):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return
            raise RuntimeError(f"queue failure #{call_count}")

        with patch("copilotkit.crewai.crewai_sdk.queue_put", new=_failing_queue_put):
            from copilotkit.crewai.crewai_sdk import copilotkit_emit_tool_call

            with pytest.raises(RuntimeError, match="queue failure #2"):
                await copilotkit_emit_tool_call(
                    name="FailTool", args={}, tool_call_id="comp-crew-3"
                )

        assert call_count == 3

    @pytest.mark.asyncio
    async def test_compensating_end_failure_emits_log(self, caplog):
        """The logger.error call includes the message_id when compensating end fails."""
        call_count = 0

        async def _failing_queue_put(*events):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return
            raise RuntimeError(f"queue failure #{call_count}")

        with caplog.at_level(logging.ERROR, logger="copilotkit.crewai.crewai_sdk"):
            with patch(
                "copilotkit.crewai.crewai_sdk.queue_put", new=_failing_queue_put
            ):
                from copilotkit.crewai.crewai_sdk import copilotkit_emit_tool_call

                with pytest.raises(RuntimeError):
                    await copilotkit_emit_tool_call(
                        name="FailTool", args={}, tool_call_id="log-crew-id"
                    )

        assert any("log-crew-id" in record.message for record in caplog.records)


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

        start_events = [e for e in dispatched if e.type == EventType.TOOL_CALL_START]
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

    def test_string_args_passed_through_unchanged(self, agent):
        """When args is already a JSON string, it should be passed through without re-serializing."""
        with _track_parent_dispatches(agent) as dispatched:
            event = CustomEvent(
                type=EventType.CUSTOM,
                name=CustomEventNames.ManuallyEmitToolCall.value,
                value={
                    "id": "string-args-test",
                    "name": "StringArgsTool",
                    "args": '{"x": 1}',
                },
            )
            agent._dispatch_event(event)

        args_events = [e for e in dispatched if e.type == EventType.TOOL_CALL_ARGS]
        assert len(args_events) == 1
        assert args_events[0].delta == '{"x": 1}'

    def test_empty_dict_args_does_not_raise(self, agent):
        """An empty dict for args is valid and should not raise."""
        with _track_parent_dispatches(agent) as dispatched:
            event = CustomEvent(
                type=EventType.CUSTOM,
                name=CustomEventNames.ManuallyEmitToolCall.value,
                value={
                    "id": "empty-args-test",
                    "name": "EmptyArgsTool",
                    "args": {},
                },
            )
            agent._dispatch_event(event)

        tool_events = [e for e in dispatched if hasattr(e, "tool_call_id")]
        assert len(tool_events) == 3


# ---- AG-UI dispatch: validation negative tests ----


class TestAGUIDispatchValidation:
    """Negative tests for defensive validation in _dispatch_event."""

    def test_missing_id_raises(self, agent):
        """Event with no 'id' field should raise CopilotKitMisuseError."""
        event = CustomEvent(
            type=EventType.CUSTOM,
            name=CustomEventNames.ManuallyEmitToolCall.value,
            value={"name": "Tool", "args": {}},
        )
        with pytest.raises(CopilotKitMisuseError, match="valid 'id'"):
            agent._dispatch_event(event)

    def test_non_string_id_raises(self, agent):
        """Event with non-string 'id' should raise CopilotKitMisuseError."""
        event = CustomEvent(
            type=EventType.CUSTOM,
            name=CustomEventNames.ManuallyEmitToolCall.value,
            value={"id": 42, "name": "Tool", "args": {}},
        )
        with pytest.raises(CopilotKitMisuseError, match="valid 'id'"):
            agent._dispatch_event(event)

    def test_empty_string_id_raises(self, agent):
        """Event with empty string 'id' should raise CopilotKitMisuseError."""
        event = CustomEvent(
            type=EventType.CUSTOM,
            name=CustomEventNames.ManuallyEmitToolCall.value,
            value={"id": "", "name": "Tool", "args": {}},
        )
        with pytest.raises(CopilotKitMisuseError, match="valid 'id'"):
            agent._dispatch_event(event)

    def test_whitespace_only_id_raises(self, agent):
        """Event with whitespace-only 'id' should raise CopilotKitMisuseError."""
        event = CustomEvent(
            type=EventType.CUSTOM,
            name=CustomEventNames.ManuallyEmitToolCall.value,
            value={"id": "   ", "name": "Tool", "args": {}},
        )
        with pytest.raises(CopilotKitMisuseError, match="valid 'id'"):
            agent._dispatch_event(event)

    def test_missing_name_raises(self, agent):
        """Event with no 'name' field should raise CopilotKitMisuseError."""
        event = CustomEvent(
            type=EventType.CUSTOM,
            name=CustomEventNames.ManuallyEmitToolCall.value,
            value={"id": "valid-id", "args": {}},
        )
        with pytest.raises(CopilotKitMisuseError, match="valid 'name'"):
            agent._dispatch_event(event)

    def test_whitespace_only_name_raises(self, agent):
        """Event with whitespace-only 'name' should raise CopilotKitMisuseError."""
        event = CustomEvent(
            type=EventType.CUSTOM,
            name=CustomEventNames.ManuallyEmitToolCall.value,
            value={"id": "valid-id", "name": "   ", "args": {}},
        )
        with pytest.raises(CopilotKitMisuseError, match="valid 'name'"):
            agent._dispatch_event(event)

    def test_missing_args_raises(self, agent):
        """Event with no 'args' field should raise CopilotKitMisuseError."""
        event = CustomEvent(
            type=EventType.CUSTOM,
            name=CustomEventNames.ManuallyEmitToolCall.value,
            value={"id": "valid-id", "name": "Tool"},
        )
        with pytest.raises(
            CopilotKitMisuseError, match="must be a dict or pre-serialized"
        ):
            agent._dispatch_event(event)

    def test_non_serializable_args_raises(self, agent):
        """Event with non-JSON-serializable args (set) should raise CopilotKitMisuseError."""
        event = CustomEvent(
            type=EventType.CUSTOM,
            name=CustomEventNames.ManuallyEmitToolCall.value,
            value={"id": "valid-id", "name": "Tool", "args": {1, 2, 3}},
        )
        with pytest.raises(
            CopilotKitMisuseError, match="must be a dict or pre-serialized"
        ):
            agent._dispatch_event(event)

    def test_non_dict_value_raises(self, agent):
        """Event with non-dict value should raise CopilotKitMisuseError."""
        event = CustomEvent(
            type=EventType.CUSTOM,
            name=CustomEventNames.ManuallyEmitToolCall.value,
            value=None,
        )
        with pytest.raises(CopilotKitMisuseError, match="must be a dict"):
            agent._dispatch_event(event)

    def test_list_args_raises(self, agent):
        """Event with list args should raise CopilotKitMisuseError."""
        event = CustomEvent(
            type=EventType.CUSTOM,
            name=CustomEventNames.ManuallyEmitToolCall.value,
            value={"id": "valid-id", "name": "Tool", "args": [1, 2, 3]},
        )
        with pytest.raises(
            CopilotKitMisuseError, match="must be a dict or pre-serialized"
        ):
            agent._dispatch_event(event)

    def test_int_args_raises(self, agent):
        """Event with int args should raise CopilotKitMisuseError."""
        event = CustomEvent(
            type=EventType.CUSTOM,
            name=CustomEventNames.ManuallyEmitToolCall.value,
            value={"id": "valid-id", "name": "Tool", "args": 42},
        )
        with pytest.raises(
            CopilotKitMisuseError, match="must be a dict or pre-serialized"
        ):
            agent._dispatch_event(event)


# ---- AG-UI dispatch: compensating TOOL_CALL_END on mid-stream failure ----


class TestAGUICompensatingEnd:
    """Tests for the compensating TOOL_CALL_END when dispatch fails mid-stream."""

    def _make_event(self, tool_call_id="comp-test-id"):
        return CustomEvent(
            type=EventType.CUSTOM,
            name=CustomEventNames.ManuallyEmitToolCall.value,
            value={
                "id": tool_call_id,
                "name": "FailTool",
                "args": {"x": 1},
            },
        )

    def test_failure_after_start_emits_compensating_end(self, agent):
        """If TOOL_CALL_ARGS fails after START was sent, a compensating END is dispatched."""
        call_count = 0
        original = AGUIBase._dispatch_event

        def _fail_on_args(self_inner, evt):
            nonlocal call_count
            call_count += 1
            if call_count == 2:
                raise RuntimeError("args dispatch failed")
            return original(self_inner, evt)

        with patch.object(AGUIBase, "_dispatch_event", new=_fail_on_args):
            with pytest.raises(RuntimeError, match="args dispatch failed"):
                agent._dispatch_event(self._make_event())

        assert call_count == 3

    def test_failure_on_start_does_not_emit_compensating_end(self, agent):
        """If TOOL_CALL_START itself fails, no compensating END is dispatched."""
        call_count = 0
        original = AGUIBase._dispatch_event

        def _fail_on_start(self_inner, evt):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise RuntimeError("start dispatch failed")
            return original(self_inner, evt)

        with patch.object(AGUIBase, "_dispatch_event", new=_fail_on_start):
            with pytest.raises(RuntimeError, match="start dispatch failed"):
                agent._dispatch_event(self._make_event())

        assert call_count == 1

    def test_compensating_end_failure_reraises_original(self, agent):
        """If the compensating END also fails, the original error propagates."""
        call_count = 0
        original = AGUIBase._dispatch_event

        def _fail_on_args_and_end(self_inner, evt):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return original(self_inner, evt)
            raise RuntimeError(f"dispatch failure #{call_count}")

        with patch.object(AGUIBase, "_dispatch_event", new=_fail_on_args_and_end):
            with pytest.raises(RuntimeError, match="dispatch failure #2"):
                agent._dispatch_event(self._make_event())

        assert call_count == 3

    def test_compensating_end_failure_emits_log(self, agent, caplog):
        """The logger.error call includes the tool_call_id when compensating END fails."""
        call_count = 0
        original = AGUIBase._dispatch_event

        def _fail_on_args_and_end(self_inner, evt):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return original(self_inner, evt)
            raise RuntimeError(f"dispatch failure #{call_count}")

        with caplog.at_level(logging.ERROR, logger="copilotkit.langgraph_agui_agent"):
            with patch.object(AGUIBase, "_dispatch_event", new=_fail_on_args_and_end):
                with pytest.raises(RuntimeError):
                    agent._dispatch_event(self._make_event("log-test-id"))

        assert any("log-test-id" in record.message for record in caplog.records)
