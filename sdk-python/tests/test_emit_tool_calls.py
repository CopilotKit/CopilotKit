"""Tests for emit_tool_calls parameter handling in copilotkit_customize_config"""

import sys
import pytest
from unittest.mock import MagicMock
from typing import Union, List

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


def _should_emit_tool_call(
    tool_call_names: dict,
    emit_tool_calls: Union[bool, str, List[str]],
    event,
) -> bool:
    """
    Standalone version of LangGraphAGUIAgent._should_emit_tool_call for testing.
    This mirrors the logic in langgraph_agui_agent.py without requiring
    the full ag_ui_langgraph import chain.
    """
    if isinstance(emit_tool_calls, bool):
        return emit_tool_calls

    tool_call_name = None
    if hasattr(event, 'tool_call_name'):
        tool_call_name = event.tool_call_name
    elif hasattr(event, 'tool_call_id'):
        tool_call_name = tool_call_names.get(event.tool_call_id)

    if tool_call_name is None:
        return True

    if isinstance(emit_tool_calls, str):
        return emit_tool_calls == tool_call_name
    if isinstance(emit_tool_calls, list):
        return tool_call_name in emit_tool_calls

    return True


def _make_event(tool_call_name=None, tool_call_id=None):
    event = MagicMock(spec=[])
    if tool_call_name is not None:
        event.tool_call_name = tool_call_name
    if tool_call_id is not None:
        event.tool_call_id = tool_call_id
    return event


class TestShouldEmitToolCall:
    """Tests for the _should_emit_tool_call filtering logic."""

    def test_bool_true_emits_all(self):
        assert _should_emit_tool_call({}, True, _make_event("any_tool")) is True

    def test_bool_false_suppresses_all(self):
        assert _should_emit_tool_call({}, False, _make_event("any_tool")) is False

    def test_string_match(self):
        assert _should_emit_tool_call({}, "draft_email", _make_event("draft_email")) is True

    def test_string_no_match(self):
        assert _should_emit_tool_call({}, "draft_email", _make_event("list_items")) is False

    def test_list_match(self):
        assert _should_emit_tool_call(
            {}, ["draft_email", "send_email"], _make_event("draft_email")
        ) is True

    def test_list_no_match(self):
        assert _should_emit_tool_call(
            {}, ["draft_email", "send_email"], _make_event("list_items")
        ) is False

    def test_list_multiple_matches(self):
        assert _should_emit_tool_call(
            {}, ["draft_email", "send_email"], _make_event("send_email")
        ) is True

    def test_lookup_by_id_match(self):
        names = {"tc-123": "draft_email"}
        assert _should_emit_tool_call(
            names, ["draft_email"], _make_event(tool_call_id="tc-123")
        ) is True

    def test_lookup_by_id_no_match(self):
        names = {"tc-123": "list_items"}
        assert _should_emit_tool_call(
            names, ["draft_email"], _make_event(tool_call_id="tc-123")
        ) is False

    def test_unknown_name_defaults_true(self):
        """When tool name can't be determined, default to emitting."""
        assert _should_emit_tool_call({}, ["draft_email"], _make_event()) is True

    def test_string_filter_with_id_lookup(self):
        names = {"tc-456": "search_tool"}
        assert _should_emit_tool_call(
            names, "search_tool", _make_event(tool_call_id="tc-456")
        ) is True

    def test_string_filter_with_id_lookup_no_match(self):
        names = {"tc-456": "other_tool"}
        assert _should_emit_tool_call(
            names, "search_tool", _make_event(tool_call_id="tc-456")
        ) is False
