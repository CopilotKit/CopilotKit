"""Tests for crewai_flow_messages_to_copilotkit assistant message emission.

Covers the parentMessageId orphan bug where the elif chain in the message
conversion skipped emitting the assistant message for tool-call messages.
Tool call entries reference their parent assistant message via parentMessageId,
so the assistant message must always be emitted — even when content is empty.
"""

import importlib
import importlib.util
import json
import sys
from unittest.mock import MagicMock

# crewai_sdk.py imports litellm/crewai at module level. Stub them out
# so the function under test (which needs none of these) can be imported.
# We load crewai_sdk.py directly to bypass copilotkit/crewai/__init__.py
# which pulls in crewai_agent.py and its heavy transitive dependencies.
_STUBS = [
    "litellm", "litellm.types", "litellm.types.utils",
    "litellm.litellm_core_utils", "litellm.litellm_core_utils.streaming_handler",
    "crewai", "crewai.flow", "crewai.flow.flow",
    "crewai.utilities", "crewai.utilities.events",
    "crewai.utilities.events.flow_events",
    "copilotkit.runloop", "copilotkit.protocol",
]
_originals = {}
for _name in _STUBS:
    if _name in sys.modules:
        _originals[_name] = sys.modules[_name]
    else:
        sys.modules[_name] = MagicMock()

_pkg_path = importlib.util.find_spec("copilotkit").submodule_search_locations[0]  # type: ignore[union-attr,index]
_spec = importlib.util.spec_from_file_location(
    "copilotkit.crewai.crewai_sdk",
    f"{_pkg_path}/crewai/crewai_sdk.py",
)
_mod = importlib.util.module_from_spec(_spec)  # type: ignore[arg-type]
_spec.loader.exec_module(_mod)  # type: ignore[union-attr]
crewai_flow_messages_to_copilotkit = _mod.crewai_flow_messages_to_copilotkit

# Restore original modules
for _name in _STUBS:
    if _name in _originals:
        sys.modules[_name] = _originals[_name]
    else:
        sys.modules.pop(_name, None)


def _convert_and_split(messages):
    """Convert messages and split result into assistant vs tool-call entries."""
    result = crewai_flow_messages_to_copilotkit(messages)
    assistant_msgs = [m for m in result if m.get("role") == "assistant"]
    tool_call_msgs = [m for m in result if "parentMessageId" in m]
    return result, assistant_msgs, tool_call_msgs


class TestCrewAIAssistantMessageAlwaysEmitted:
    """The assistant message must always be present so tool call entries can
    reference it via parentMessageId. Without it, tool calls are orphaned
    and the frontend cannot reconstruct tool call rendering on reconnect."""

    def test_function_style_tool_calls_with_content(self):
        """Message with content and function-style tool_calls emits assistant + tool calls."""
        messages = [
            {
                "id": "ai-1",
                "role": "assistant",
                "content": "Let me help.",
                "tool_calls": [
                    {"id": "tc-1", "function": {"name": "get_help", "arguments": json.dumps({"topic": "billing"})}},
                ],
            },
        ]
        _, assistant_msgs, tool_call_msgs = _convert_and_split(messages)

        assert len(assistant_msgs) == 1
        assert assistant_msgs[0]["id"] == "ai-1"
        assert assistant_msgs[0]["content"] == "Let me help."

        assert len(tool_call_msgs) == 1
        assert tool_call_msgs[0]["parentMessageId"] == "ai-1"

    def test_function_style_tool_calls_with_empty_content(self):
        """Message with empty content (OpenAI-style) still emits the assistant message."""
        messages = [
            {
                "id": "ai-1",
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {"id": "tc-1", "function": {"name": "get_help", "arguments": json.dumps({"topic": "billing"})}},
                ],
            },
        ]
        _, assistant_msgs, tool_call_msgs = _convert_and_split(messages)

        assert len(assistant_msgs) == 1, "Assistant message must be emitted even with empty content"
        assert assistant_msgs[0]["id"] == "ai-1"
        assert assistant_msgs[0]["content"] == ""

        assert len(tool_call_msgs) == 1
        assert tool_call_msgs[0]["parentMessageId"] == "ai-1"

    def test_function_style_tool_calls_without_content_key(self):
        """Message with no content key still emits the assistant message."""
        messages = [
            {
                "id": "ai-1",
                "role": "assistant",
                "tool_calls": [
                    {"id": "tc-1", "function": {"name": "get_help", "arguments": json.dumps({})}},
                ],
            },
        ]
        _, assistant_msgs, tool_call_msgs = _convert_and_split(messages)

        assert len(assistant_msgs) == 1, "Assistant message must be emitted even without content key"
        assert assistant_msgs[0]["content"] == ""

        assert len(tool_call_msgs) == 1
        assert tool_call_msgs[0]["parentMessageId"] == "ai-1"

    def test_direct_style_tool_calls_with_empty_content(self):
        """Message with direct-style tool_calls (no function wrapper) still emits assistant."""
        messages = [
            {
                "id": "ai-1",
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {"id": "tc-1", "name": "get_help", "arguments": {"topic": "billing"}},
                ],
            },
        ]
        _, assistant_msgs, tool_call_msgs = _convert_and_split(messages)

        assert len(assistant_msgs) == 1, "Assistant message must be emitted for direct-style tool calls"
        assert assistant_msgs[0]["content"] == ""

        assert len(tool_call_msgs) == 1
        assert tool_call_msgs[0]["parentMessageId"] == "ai-1"

    def test_tool_call_without_id_is_skipped(self):
        """Tool calls missing an id should be silently skipped."""
        messages = [
            {
                "id": "ai-1",
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {"function": {"name": "no_id_tool", "arguments": json.dumps({})}},
                    {"id": "tc-1", "function": {"name": "search", "arguments": json.dumps({"q": "x"})}},
                ],
            },
        ]
        _, assistant_msgs, tool_call_msgs = _convert_and_split(messages)

        assert len(assistant_msgs) == 1
        assert len(tool_call_msgs) == 1, "Only tool calls with an id should be emitted"
        assert tool_call_msgs[0]["id"] == "tc-1"

    def test_no_orphaned_parent_message_ids(self):
        """Every parentMessageId must reference an existing assistant message."""
        messages = [
            {"id": "h-1", "role": "user", "content": "help me"},
            {
                "id": "ai-1",
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {"id": "tc-1", "function": {"name": "get_help", "arguments": json.dumps({"topic": "billing"})}},
                    {"id": "tc-2", "function": {"name": "search", "arguments": json.dumps({"query": "docs"})}},
                ],
            },
            {"id": "tm-1", "role": "tool", "tool_call_id": "tc-1", "content": "done"},
            {"id": "tm-2", "role": "tool", "tool_call_id": "tc-2", "content": "found"},
        ]
        result, _, tool_call_msgs = _convert_and_split(messages)

        message_ids = {m["id"] for m in result if "role" in m}

        for tc in tool_call_msgs:
            assert tc["parentMessageId"] in message_ids, (
                f"Tool call {tc['id']} has orphaned parentMessageId {tc['parentMessageId']}"
            )

    def test_plain_assistant_message_without_tool_calls(self):
        """Plain assistant message (no tool calls) emits just the assistant message."""
        messages = [{"id": "ai-1", "role": "assistant", "content": "Hello!"}]
        result, _, _ = _convert_and_split(messages)

        assert len(result) == 1
        assert result[0]["role"] == "assistant"
        assert result[0]["content"] == "Hello!"
