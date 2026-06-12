"""Tests for emit_tool_calls parameter handling in copilotkit_customize_config.

Tests the real should_emit_tool_call function imported from langgraph_agui_agent,
NOT a standalone copy. This ensures test coverage tracks actual production logic.
"""

import sys
from unittest.mock import MagicMock

# Mock problematic modules to avoid environment-specific import failures
# (langgraph.prebuilt.tool_node fails due to version mismatch)
for mod_name in [
    "ag_ui_langgraph",
    "ag_ui_langgraph.middlewares",
    "ag_ui_langgraph.middlewares.state_streaming",
    "ag_ui.core",
    "langchain.agents",
    "langchain.agents.middleware",
    "langgraph.prebuilt",
    "langgraph.prebuilt.tool_node",
    "langgraph.prebuilt.chat_agent_executor",
]:
    sys.modules.setdefault(mod_name, MagicMock())

from copilotkit.langgraph import copilotkit_customize_config
from copilotkit.langgraph_agui_agent import should_emit_tool_call


class TestCopilotKitCustomizeConfig:
    """Tests for copilotkit_customize_config emit_tool_calls parameter."""

    def test_emit_tool_calls_boolean_true(self):
        config = copilotkit_customize_config(None, emit_tool_calls=True)
        assert config["metadata"]["copilotkit:emit-tool-calls"] is True

    def test_emit_tool_calls_boolean_false(self):
        config = copilotkit_customize_config(None, emit_tool_calls=False)
        assert config["metadata"]["copilotkit:emit-tool-calls"] is False

    def test_emit_tool_calls_string(self):
        config = copilotkit_customize_config(None, emit_tool_calls="my_tool")
        assert config["metadata"]["copilotkit:emit-tool-calls"] == "my_tool"

    def test_emit_tool_calls_list(self):
        config = copilotkit_customize_config(
            None, emit_tool_calls=["tool_a", "tool_b"]
        )
        assert config["metadata"]["copilotkit:emit-tool-calls"] == ["tool_a", "tool_b"]

    def test_emit_tool_calls_not_set(self):
        config = copilotkit_customize_config(None)
        assert "copilotkit:emit-tool-calls" not in config.get("metadata", {})

    def test_emit_tool_calls_preserves_existing_metadata(self):
        base_config = {"metadata": {"existing_key": "value"}}
        config = copilotkit_customize_config(base_config, emit_tool_calls=["tool_a"])
        assert config["metadata"]["existing_key"] == "value"
        assert config["metadata"]["copilotkit:emit-tool-calls"] == ["tool_a"]


def _make_event(tool_call_name=MagicMock, tool_call_id=MagicMock):
    """Create a mock event. Use MagicMock sentinel to omit attributes entirely."""
    event = MagicMock(spec=[])
    if tool_call_name is not MagicMock:
        event.tool_call_name = tool_call_name
    if tool_call_id is not MagicMock:
        event.tool_call_id = tool_call_id
    return event


class TestShouldEmitToolCall:
    """Tests for the real should_emit_tool_call function from langgraph_agui_agent."""

    def test_bool_true_emits_all(self):
        assert should_emit_tool_call({}, True, _make_event("any_tool")) is True

    def test_bool_false_suppresses_all(self):
        assert should_emit_tool_call({}, False, _make_event("any_tool")) is False

    def test_string_match(self):
        assert should_emit_tool_call({}, "draft_email", _make_event("draft_email")) is True

    def test_string_no_match(self):
        assert should_emit_tool_call({}, "draft_email", _make_event("list_items")) is False

    def test_list_match(self):
        assert should_emit_tool_call(
            {}, ["draft_email", "send_email"], _make_event("draft_email")
        ) is True

    def test_list_no_match(self):
        assert should_emit_tool_call(
            {}, ["draft_email", "send_email"], _make_event("list_items")
        ) is False

    def test_list_multiple_matches(self):
        assert should_emit_tool_call(
            {}, ["draft_email", "send_email"], _make_event("send_email")
        ) is True

    def test_lookup_by_id_match(self):
        names = {"tc-123": "draft_email"}
        assert should_emit_tool_call(
            names, ["draft_email"], _make_event(tool_call_id="tc-123")
        ) is True

    def test_lookup_by_id_no_match(self):
        names = {"tc-123": "list_items"}
        assert should_emit_tool_call(
            names, ["draft_email"], _make_event(tool_call_id="tc-123")
        ) is False

    def test_unknown_name_defaults_true(self):
        """When tool name can't be determined, default to emitting."""
        assert should_emit_tool_call({}, ["draft_email"], _make_event()) is True

    def test_string_filter_with_id_lookup(self):
        names = {"tc-456": "search_tool"}
        assert should_emit_tool_call(
            names, "search_tool", _make_event(tool_call_id="tc-456")
        ) is True

    def test_string_filter_with_id_lookup_no_match(self):
        names = {"tc-456": "other_tool"}
        assert should_emit_tool_call(
            names, "search_tool", _make_event(tool_call_id="tc-456")
        ) is False

    def test_none_tool_call_name_falls_through_to_id_lookup(self):
        """Regression: hasattr returns True for tool_call_name=None.
        Must fall through to id-lookup instead of emitting unconditionally."""
        names = {"tc-789": "secret_tool"}
        # Event has tool_call_name attribute but it's None
        event = _make_event(tool_call_name=None, tool_call_id="tc-789")
        assert should_emit_tool_call(names, "secret_tool", event) is True
        assert should_emit_tool_call(names, "other_tool", event) is False

    def test_none_tool_call_name_no_id_defaults_true(self):
        """When tool_call_name is None and no tool_call_id, default to emit."""
        event = _make_event(tool_call_name=None)
        assert should_emit_tool_call({}, ["draft_email"], event) is True

    def test_empty_list_suppresses_all(self):
        """Empty list should suppress all named tools."""
        assert should_emit_tool_call({}, [], _make_event("any_tool")) is False

    def test_empty_list_allows_unknown(self):
        """Empty list should still allow events with unknown names (no name to check)."""
        assert should_emit_tool_call({}, [], _make_event()) is True
