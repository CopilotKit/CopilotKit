"""Tests for middleware emission of AG-UI tool call events for intercepted SDK Actions.

Covers:
  - When aafter_model intercepts SDK Action tool calls, copilotkit_manually_emit_tool_call
    custom events are dispatched for each intercepted call
  - When no tool calls are intercepted, no custom events are dispatched
  - Multiple intercepted tool calls each produce their own custom event
  - The custom event payload matches the format expected by LangGraphAGUIAgent._dispatch_event()
  - Sync after_model path works unchanged (no event emission from sync path)
"""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock, AsyncMock, patch

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from copilotkit.copilotkit_lg_middleware import CopilotKitMiddleware


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


@pytest.fixture
def middleware():
    """Create a fresh middleware instance for each test."""
    return CopilotKitMiddleware()


def _make_tool_call(
    name: str,
    args: dict | None = None,
    tool_call_id: str | None = None,
) -> dict:
    """Create a proper tool call dict for langchain AIMessage."""
    return {
        "type": "tool_call",
        "name": name,
        "args": args or {},
        "id": tool_call_id or f"call_{name}",
    }


def _make_state(
    *,
    ai_message: AIMessage | None = None,
    actions: list[dict] | None = None,
) -> dict:
    """Build a state dict for testing."""
    messages = [HumanMessage("hi")]
    if ai_message:
        messages.append(ai_message)

    return {
        "messages": messages,
        "copilotkit": {
            "actions": actions or [],
        },
    }


# ---------------------------------------------------------------------------
# Tests: no interception
# ---------------------------------------------------------------------------


def test_aafter_model_no_frontend_tools_is_noop(middleware):
    """When no frontend tools exist, aafter_model returns None."""

    async def _run():
        state = _make_state(
            ai_message=AIMessage(
                content="",
                tool_calls=[_make_tool_call("backend_only", tool_call_id="1")],
            ),
            actions=[],
        )
        runtime = MagicMock(name="runtime")

        with patch("langgraph.config.get_config", return_value=MagicMock()):
            result = await middleware.aafter_model(state, runtime)

        assert result is None

    asyncio.run(_run())


def test_aafter_model_no_tool_calls_is_noop(middleware):
    """When the AIMessage has no tool calls, aafter_model returns None."""

    async def _run():
        state = _make_state(
            ai_message=AIMessage(content="Just a response, no tools"),
            actions=[{"function": {"name": "navigate"}}],
        )
        runtime = MagicMock(name="runtime")

        with patch("langgraph.config.get_config", return_value=MagicMock()):
            result = await middleware.aafter_model(state, runtime)

        assert result is None

    asyncio.run(_run())


def test_aafter_model_only_backend_tools_is_noop(middleware):
    """When all tool calls are backend tools (not frontend actions), no dispatch occurs."""

    async def _run():
        state = _make_state(
            ai_message=AIMessage(
                content="",
                tool_calls=[
                    _make_tool_call("backend_search", {"q": "hi"}, tool_call_id="1")
                ],
            ),
            actions=[{"function": {"name": "navigate"}}],
        )
        runtime = MagicMock(name="runtime")

        with patch("langgraph.config.get_config", return_value=MagicMock()):
            with patch(
                "langchain_core.callbacks.manager.adispatch_custom_event",
                new_callable=AsyncMock,
            ) as mock_dispatch:
                result = await middleware.aafter_model(state, runtime)

        assert result is None
        mock_dispatch.assert_not_called()

    asyncio.run(_run())


# ---------------------------------------------------------------------------
# Tests: interception with event dispatch
# ---------------------------------------------------------------------------


def test_aafter_model_emits_event_for_single_intercepted_tool_call(middleware):
    """When a single tool call matches a frontend action, emit a custom event."""

    async def _run():
        frontend_call = _make_tool_call("navigate", {"path": "/x"}, tool_call_id="2")
        state = _make_state(
            ai_message=AIMessage(
                content="",
                tool_calls=[frontend_call],
                id="ai-1",
            ),
            actions=[{"function": {"name": "navigate"}}],
        )
        runtime = MagicMock(name="runtime")
        mock_config = MagicMock()

        with patch("langgraph.config.get_config", return_value=mock_config):
            with patch(
                "langchain_core.callbacks.manager.adispatch_custom_event",
                new_callable=AsyncMock,
            ) as mock_dispatch:
                result = await middleware.aafter_model(state, runtime)

        # Verify the result has the intercepted call stored
        assert result is not None
        intercepted = result["copilotkit"]["intercepted_tool_calls"]
        assert len(intercepted) == 1
        assert intercepted[0]["name"] == "navigate"
        assert intercepted[0]["id"] == "2"

        # Verify the custom event was dispatched
        mock_dispatch.assert_called_once()
        args, kwargs = mock_dispatch.call_args
        assert len(args) == 2
        assert args[0] == "copilotkit_manually_emit_tool_call"
        assert args[1] == {
            "name": "navigate",
            "args": {"path": "/x"},
            "id": "2",
        }
        assert kwargs.get("config") is mock_config

    asyncio.run(_run())


def test_aafter_model_emits_events_for_multiple_intercepted_tool_calls(middleware):
    """When multiple tool calls match frontend actions, emit a custom event for each."""

    async def _run():
        backend_call = _make_tool_call("backend_search", {"q": "hi"}, tool_call_id="1")
        frontend_call_1 = _make_tool_call("navigate", {"path": "/x"}, tool_call_id="2")
        frontend_call_2 = _make_tool_call(
            "update_context", {"ctx": "val"}, tool_call_id="3"
        )

        state = _make_state(
            ai_message=AIMessage(
                content="",
                tool_calls=[backend_call, frontend_call_1, frontend_call_2],
                id="ai-1",
            ),
            actions=[
                {"function": {"name": "navigate"}},
                {"function": {"name": "update_context"}},
            ],
        )
        runtime = MagicMock(name="runtime")
        mock_config = MagicMock()

        with patch("langgraph.config.get_config", return_value=mock_config):
            with patch(
                "langchain_core.callbacks.manager.adispatch_custom_event",
                new_callable=AsyncMock,
            ) as mock_dispatch:
                result = await middleware.aafter_model(state, runtime)

        # Verify the result has both intercepted calls stored
        assert result is not None
        intercepted = result["copilotkit"]["intercepted_tool_calls"]
        assert len(intercepted) == 2
        assert intercepted[0]["id"] == "2"
        assert intercepted[1]["id"] == "3"

        # Verify two custom events were dispatched
        assert mock_dispatch.call_count == 2

        # First event payload
        first_args, first_kwargs = mock_dispatch.call_args_list[0]
        assert first_args[0] == "copilotkit_manually_emit_tool_call"
        assert first_args[1] == {
            "name": "navigate",
            "args": {"path": "/x"},
            "id": "2",
        }

        # Second event payload
        second_args, second_kwargs = mock_dispatch.call_args_list[1]
        assert second_args[0] == "copilotkit_manually_emit_tool_call"
        assert second_args[1] == {
            "name": "update_context",
            "args": {"ctx": "val"},
            "id": "3",
        }

    asyncio.run(_run())


def test_aafter_model_event_payload_format_matches_agui_handler(middleware):
    """Verify the custom event payload format matches LangGraphAGUIAgent expectation."""

    async def _run():
        # The AG-UI handler expects: {"name": str, "args": dict, "id": str}
        # This test ensures we emit exactly that format.
        frontend_call = _make_tool_call(
            "my_action", {"key1": "value1", "key2": 42}, tool_call_id="tool-123"
        )
        state = _make_state(
            ai_message=AIMessage(
                content="",
                tool_calls=[frontend_call],
                id="ai-1",
            ),
            actions=[{"function": {"name": "my_action"}}],
        )
        runtime = MagicMock(name="runtime")
        mock_config = MagicMock()

        with patch("langgraph.config.get_config", return_value=mock_config):
            with patch(
                "langchain_core.callbacks.manager.adispatch_custom_event",
                new_callable=AsyncMock,
            ) as mock_dispatch:
                await middleware.aafter_model(state, runtime)

        mock_dispatch.assert_called_once()
        args, kwargs = mock_dispatch.call_args
        payload = args[1]

        # Verify all required fields are present
        assert "name" in payload
        assert "args" in payload
        assert "id" in payload

        # Verify the types
        assert isinstance(payload["name"], str)
        assert isinstance(payload["args"], dict)
        assert isinstance(payload["id"], str)

        # Verify the values are correct
        assert payload["name"] == "my_action"
        assert payload["args"] == {"key1": "value1", "key2": 42}
        assert payload["id"] == "tool-123"

    asyncio.run(_run())


def test_aafter_model_handles_missing_optional_fields_in_call(middleware):
    """When a tool call is missing optional fields, use sensible defaults."""

    async def _run():
        # Tool calls may not always have all fields populated during construction
        # Here we'll test with a minimal dict structure
        frontend_call = {"name": "action_no_id", "id": "", "args": {}}
        state = _make_state(
            ai_message=AIMessage(
                content="",
                tool_calls=[frontend_call],
                id="ai-1",
            ),
            actions=[{"function": {"name": "action_no_id"}}],
        )
        runtime = MagicMock(name="runtime")
        mock_config = MagicMock()

        with patch("langgraph.config.get_config", return_value=mock_config):
            with patch(
                "langchain_core.callbacks.manager.adispatch_custom_event",
                new_callable=AsyncMock,
            ) as mock_dispatch:
                await middleware.aafter_model(state, runtime)

        # Should succeed and dispatch with defaults for missing fields
        mock_dispatch.assert_called_once()
        args, kwargs = mock_dispatch.call_args
        payload = args[1]
        assert payload["name"] == "action_no_id"
        assert payload["args"] == {}
        assert payload["id"] == ""

    asyncio.run(_run())


# ---------------------------------------------------------------------------
# Tests: Backward compatibility — sync after_model unchanged
# ---------------------------------------------------------------------------


def test_after_model_sync_unchanged(middleware):
    """The sync after_model path should work unchanged (no custom events)."""
    frontend_call = _make_tool_call("navigate", {"path": "/x"}, tool_call_id="2")
    state = _make_state(
        ai_message=AIMessage(
            content="",
            tool_calls=[frontend_call],
            id="ai-1",
        ),
        actions=[{"function": {"name": "navigate"}}],
    )
    runtime = MagicMock(name="runtime")

    # Call the sync method directly
    result = middleware.after_model(state, runtime)

    # Verify it works as before: returns the intercepted state
    assert result is not None
    intercepted = result["copilotkit"]["intercepted_tool_calls"]
    assert len(intercepted) == 1
    assert intercepted[0]["name"] == "navigate"
    assert intercepted[0]["id"] == "2"
    # And the AIMessage now has no tool calls
    last_msg = result["messages"][-1]
    assert isinstance(last_msg, AIMessage)
    assert len(last_msg.tool_calls) == 0
