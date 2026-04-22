"""Tests for langchain_messages_to_copilotkit assistant message emission.

Covers the parentMessageId orphan bug where an `if content:` guard skipped
emitting the assistant message when content was empty. Tool call entries
reference their parent assistant message via parentMessageId, so the
assistant message must always be emitted — even when content is empty
(standard OpenAI behavior for tool-call-only responses).
"""

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from copilotkit.langgraph import langchain_messages_to_copilotkit


def _convert_and_split(messages):
    """Convert messages and split result into assistant vs tool-call entries."""
    result = langchain_messages_to_copilotkit(messages)
    assistant_msgs = [m for m in result if m.get("role") == "assistant"]
    tool_call_msgs = [m for m in result if "parentMessageId" in m]
    return result, assistant_msgs, tool_call_msgs


class TestAssistantMessageAlwaysEmitted:
    """The assistant message must always be present so tool call entries can
    reference it via parentMessageId. Without it, tool calls are orphaned
    and the frontend cannot reconstruct tool call rendering on reconnect."""

    def test_ai_message_with_content_and_tool_calls(self):
        """AIMessage with both content and tool_calls emits assistant + tool calls."""
        messages = [
            AIMessage(
                id="ai-1",
                content="Let me help with that.",
                tool_calls=[{"id": "tc-1", "name": "get_help", "args": {"topic": "billing"}}],
            ),
        ]
        _, assistant_msgs, tool_call_msgs = _convert_and_split(messages)

        assert len(assistant_msgs) == 1
        assert assistant_msgs[0]["id"] == "ai-1"
        assert assistant_msgs[0]["content"] == "Let me help with that."

        assert len(tool_call_msgs) == 1
        assert tool_call_msgs[0]["parentMessageId"] == "ai-1"

    def test_ai_message_with_empty_content_and_tool_calls(self):
        """AIMessage with empty content (OpenAI-style) still emits the assistant message."""
        messages = [
            AIMessage(
                id="ai-1",
                content="",
                tool_calls=[{"id": "tc-1", "name": "get_help", "args": {"topic": "billing"}}],
            ),
        ]
        _, assistant_msgs, tool_call_msgs = _convert_and_split(messages)

        assert len(assistant_msgs) == 1, "Assistant message must be emitted even with empty content"
        assert assistant_msgs[0]["id"] == "ai-1"
        assert assistant_msgs[0]["content"] == ""

        assert len(tool_call_msgs) == 1
        assert tool_call_msgs[0]["parentMessageId"] == "ai-1"

    def test_ai_message_with_none_content_and_tool_calls(self):
        """AIMessage with None content still emits the assistant message."""
        msg = AIMessage(
            id="ai-1",
            content="",
            tool_calls=[{"id": "tc-1", "name": "get_help", "args": {}}],
        )
        # Simulate None content (some models/edge cases)
        msg.content = None  # type: ignore[assignment]

        _, assistant_msgs, _ = _convert_and_split([msg])

        assert len(assistant_msgs) == 1, "Assistant message must be emitted even with None content"
        assert assistant_msgs[0]["content"] == ""

    def test_no_orphaned_parent_message_ids(self):
        """Every parentMessageId must reference an existing assistant message."""
        messages = [
            HumanMessage(id="h-1", content="help me"),
            AIMessage(
                id="ai-1",
                content="",
                tool_calls=[
                    {"id": "tc-1", "name": "get_help", "args": {"topic": "billing"}},
                    {"id": "tc-2", "name": "search", "args": {"query": "docs"}},
                ],
            ),
            ToolMessage(id="tm-1", content="done", tool_call_id="tc-1"),
            ToolMessage(id="tm-2", content="found", tool_call_id="tc-2"),
        ]
        result, _, tool_call_msgs = _convert_and_split(messages)

        message_ids = {m["id"] for m in result if "role" in m}

        for tc in tool_call_msgs:
            assert tc["parentMessageId"] in message_ids, (
                f"Tool call {tc['id']} has orphaned parentMessageId {tc['parentMessageId']}"
            )

    def test_ai_message_with_list_content_and_tool_calls(self):
        """AIMessage with empty list content (Anthropic-style) still emits the assistant message."""
        msg = AIMessage(
            id="ai-1",
            content="",
            tool_calls=[{"id": "tc-1", "name": "get_help", "args": {}}],
        )
        # Anthropic models can return content as a list; empty list is falsy
        msg.content = []  # type: ignore[assignment]

        _, assistant_msgs, tool_call_msgs = _convert_and_split([msg])

        assert len(assistant_msgs) == 1, "Assistant message must be emitted even with empty list content"
        assert assistant_msgs[0]["content"] == ""

        assert len(tool_call_msgs) == 1
        assert tool_call_msgs[0]["parentMessageId"] == "ai-1"

    def test_ai_message_without_tool_calls(self):
        """Plain AIMessage (no tool calls) emits just the assistant message."""
        messages = [AIMessage(id="ai-1", content="Hello!")]
        result, _, _ = _convert_and_split(messages)

        assert len(result) == 1
        assert result[0]["role"] == "assistant"
        assert result[0]["content"] == "Hello!"
