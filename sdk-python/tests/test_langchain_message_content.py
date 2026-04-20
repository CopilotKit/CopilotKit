"""Tests for multi-part content handling in langchain_messages_to_copilotkit.

Covers the fix in PR #3844 / issue #1748: when AIMessage.content is a list
of content blocks (e.g. Anthropic models), all text parts must be extracted
and concatenated — not just the first element.
"""

import pytest
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from copilotkit.langgraph import langchain_messages_to_copilotkit


class TestMultiPartContentList:
    """AIMessage.content as a list should concatenate all text parts."""

    def test_list_of_text_dicts(self):
        """Multiple {"type": "text", "text": "..."} dicts are all concatenated."""
        msg = AIMessage(
            id="ai-1",
            content=[
                {"type": "text", "text": "Hello "},
                {"type": "text", "text": "world"},
            ],
        )
        result = langchain_messages_to_copilotkit([msg])
        assert len(result) == 1
        assert result[0]["content"] == "Hello world"
        assert result[0]["role"] == "assistant"

    def test_list_of_strings(self):
        """Content list of plain strings should be concatenated."""
        msg = AIMessage(
            id="ai-2",
            content=["Part A", " Part B"],
        )
        result = langchain_messages_to_copilotkit([msg])
        assert len(result) == 1
        assert result[0]["content"] == "Part A Part B"

    def test_mixed_strings_and_text_dicts(self):
        """Mix of plain strings and text dicts should all be concatenated."""
        msg = AIMessage(
            id="ai-3",
            content=[
                "Start ",
                {"type": "text", "text": "middle "},
                {"text": "end"},
            ],
        )
        result = langchain_messages_to_copilotkit([msg])
        assert len(result) == 1
        assert result[0]["content"] == "Start middle end"

    def test_non_text_parts_are_skipped(self):
        """Non-text content blocks (e.g. images) should be ignored."""
        msg = AIMessage(
            id="ai-4",
            content=[
                {"type": "text", "text": "Sample png file"},
                {
                    "type": "image",
                    "image_data": {"data": "base64data", "format": "image/png"},
                },
            ],
        )
        result = langchain_messages_to_copilotkit([msg])
        assert len(result) == 1
        assert result[0]["content"] == "Sample png file"

    def test_empty_list_returns_empty_content(self):
        """Empty content list should produce assistant message with empty string."""
        msg = AIMessage(
            id="ai-5",
            content=[],
        )
        result = langchain_messages_to_copilotkit([msg])
        # Assistant messages are always emitted (even with empty content)
        # so that tool call entries can reference them via parentMessageId.
        assert len(result) == 1
        assert result[0]["content"] == ""
        assert result[0]["role"] == "assistant"

    def test_single_text_dict_in_list(self):
        """Single text dict in a list should still be extracted."""
        msg = AIMessage(
            id="ai-6",
            content=[{"type": "text", "text": "Only one part"}],
        )
        result = langchain_messages_to_copilotkit([msg])
        assert len(result) == 1
        assert result[0]["content"] == "Only one part"

    def test_dict_without_type_but_with_text_key(self):
        """A dict with "text" key but no "type" should still have text extracted."""
        msg = AIMessage(
            id="ai-7",
            content=[{"text": "no type field"}],
        )
        result = langchain_messages_to_copilotkit([msg])
        assert len(result) == 1
        assert result[0]["content"] == "no type field"


class TestSingleDictContent:
    """AIMessage.content as a single dict (Anthropic style) should extract text.

    Note: langchain_core.messages.AIMessage validates content as str | list,
    so a raw dict cannot be passed directly. We use a mock to exercise the
    dict-handling code path in langchain_messages_to_copilotkit, which exists
    to handle edge cases from deserialized or non-standard message objects.
    """

    def test_dict_with_text_key(self):
        """A content dict with "text" key should have its text extracted."""
        from unittest.mock import MagicMock

        msg = MagicMock(spec=AIMessage)
        msg.content = {"text": "dict content"}
        msg.id = "ai-8"
        msg.tool_calls = []
        result = langchain_messages_to_copilotkit([msg])
        assert len(result) == 1
        assert result[0]["content"] == "dict content"


class TestPlainStringContent:
    """Standard string content should still work as before."""

    def test_plain_string_content(self):
        """Normal string content passes through unchanged."""
        msg = AIMessage(
            id="ai-9",
            content="Just a string",
        )
        result = langchain_messages_to_copilotkit([msg])
        assert len(result) == 1
        assert result[0]["content"] == "Just a string"

    def test_human_message_string(self):
        """HumanMessage with string content still works."""
        msg = HumanMessage(id="human-1", content="Hello")
        result = langchain_messages_to_copilotkit([msg])
        assert len(result) == 1
        assert result[0]["role"] == "user"
        assert result[0]["content"] == "Hello"

    def test_system_message_string(self):
        """SystemMessage with string content still works."""
        msg = SystemMessage(id="sys-1", content="System prompt")
        result = langchain_messages_to_copilotkit([msg])
        assert len(result) == 1
        assert result[0]["role"] == "system"
        assert result[0]["content"] == "System prompt"


class TestIssue1748Reproduction:
    """Directly reproduces the scenario from issue #1748.

    The original bug: when content is a list of dicts including an image block,
    only the first element was taken via `content[0]`, which was the dict itself,
    not a string. This caused the message to be silently dropped or mangled.
    """

    def test_text_and_image_content_preserves_text(self):
        """The exact scenario from issue #1748: text + image content blocks."""
        msg = AIMessage(
            id="ai-repro",
            content=[
                {"type": "text", "text": "Sample png file"},
                {
                    "type": "image",
                    "image_data": {"data": "aW1hZ2VfZGF0YQ==", "format": "image/png"},
                },
            ],
        )
        result = langchain_messages_to_copilotkit([msg])
        assert len(result) == 1
        assert result[0]["content"] == "Sample png file"
        assert result[0]["role"] == "assistant"

    def test_multiple_text_parts_are_not_truncated(self):
        """The core bug: only the first element was kept. All text must survive."""
        msg = AIMessage(
            id="ai-trunc",
            content=[
                {"type": "text", "text": "First part. "},
                {"type": "text", "text": "Second part. "},
                {"type": "text", "text": "Third part."},
            ],
        )
        result = langchain_messages_to_copilotkit([msg])
        assert len(result) == 1
        assert result[0]["content"] == "First part. Second part. Third part."
