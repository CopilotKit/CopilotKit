"""Real AG-UI conversion and OpenAI serialization for the chart continuation."""

import unittest

from ag_ui.core import AssistantMessage, FunctionCall, ToolCall, ToolMessage
from llama_index.core.llms import ChatMessage
from llama_index.llms.openai.utils import to_openai_message_dicts
from llama_index.protocols.ag_ui.utils import ag_ui_message_to_llama_index_message

from agents.gen_ui_tool_based_agent import _normalize_chart_messages


def converted_history(count=1, narration=""):
    calls = [
        ToolCall(
            id=f"chart-{index}",
            function=FunctionCall(
                name="render_pie_chart",
                arguments='{"title": "Revenue", "data": [{"label": "Books", "value": 12000}]}',
            ),
        )
        for index in range(count)
    ]
    messages = [
        AssistantMessage(id="assistant", content=narration, tool_calls=calls),
        *[
            ToolMessage(id=f"result-{index}", tool_call_id=call.id, content="")
            for index, call in enumerate(calls)
        ],
    ]
    return [ag_ui_message_to_llama_index_message(message) for message in messages]


def wire(messages):
    return to_openai_message_dicts(_normalize_chart_messages(messages))


class ChartHistoryTests(unittest.TestCase):
    def test_actual_converter_history_becomes_valid_provider_continuation(self):
        original = converted_history()
        result = wire(original)
        self.assertEqual(result[0]["role"], "assistant")
        for private_key in ["id", "ag_ui_tool_calls"]:
            with self.subTest(private_key=private_key):
                self.assertNotIn(private_key, result[0])
        self.assertEqual(result[0]["content"], None)
        call = result[0]["tool_calls"][0]
        self.assertEqual(call["id"], "chart-0")
        self.assertEqual(call["type"], "function")
        self.assertEqual(call["function"]["name"], "render_pie_chart")
        self.assertEqual(
            call["function"]["arguments"],
            original[0].additional_kwargs["ag_ui_tool_calls"][0]["arguments"],
        )
        self.assertEqual(
            result[1], {"role": "tool", "content": "", "tool_call_id": "chart-0"}
        )

    def test_multiple_calls_keep_each_result_id(self):
        result = wire(converted_history(count=2))
        self.assertEqual(
            [call["id"] for call in result[0]["tool_calls"]], ["chart-0", "chart-1"]
        )
        self.assertEqual(
            [message["tool_call_id"] for message in result[1:]], ["chart-0", "chart-1"]
        )
        self.assertTrue(all(message["role"] == "tool" for message in result[1:]))

    def test_preserves_genuine_narration_including_unrelated_xml(self):
        for narration in [
            "Keep <tool_call>quoted example</tool_call> in this explanation.",
            "First line  \n",
        ]:
            with self.subTest(narration=narration):
                self.assertEqual(
                    wire(converted_history(narration=narration))[0]["content"],
                    narration,
                )

    def test_copies_history_and_retains_unrelated_metadata(self):
        original = converted_history()
        original[0].additional_kwargs["trace"] = {"nested": ["keep"]}
        before = [message.model_dump() for message in original]
        normalized = _normalize_chart_messages(original)
        self.assertEqual([message.model_dump() for message in original], before)
        self.assertIsNot(normalized[0], original[0])
        self.assertEqual(normalized[0].additional_kwargs["trace"], {"nested": ["keep"]})
        self.assertEqual(original[0].additional_kwargs["id"], "assistant")

    def test_ordinary_messages_and_valid_structured_calls_remain_intact(self):
        call = {
            "id": "known",
            "type": "function",
            "function": {"name": "render_pie_chart", "arguments": "{}"},
        }
        messages = [
            ChatMessage(role="user", content="Show a chart"),
            ChatMessage(
                role="assistant",
                content="Here is a chart",
                additional_kwargs={"tool_calls": [call]},
            ),
            ChatMessage(
                role="tool",
                content="complete",
                additional_kwargs={"tool_call_id": "known"},
            ),
        ]
        self.assertEqual(wire(messages), to_openai_message_dicts(messages))

    def test_metadata_without_generated_suffix_preserves_content(self):
        messages = converted_history()
        messages[0].content = "An explanation with no generated XML suffix."
        self.assertEqual(wire(messages)[0]["content"], messages[0].content)

    def test_malformed_metadata_is_an_explicit_error(self):
        for metadata in [
            "wrong",
            [{"id": "chart", "name": "render_pie_chart"}],
            [{"id": "chart", "name": "render_pie_chart", "arguments": 42}],
        ]:
            with self.subTest(metadata=metadata):
                message = ChatMessage(
                    role="assistant",
                    content="keep",
                    additional_kwargs={"ag_ui_tool_calls": metadata},
                )
                with self.assertRaises(ValueError):
                    _normalize_chart_messages([message])

    def test_conflicting_structured_calls_are_not_overwritten(self):
        messages = converted_history()
        messages[0].additional_kwargs["tool_calls"] = [
            {
                "id": "other",
                "type": "function",
                "function": {"name": "other", "arguments": "{}"},
            }
        ]
        with self.assertRaises(ValueError):
            _normalize_chart_messages(messages)


if __name__ == "__main__":
    unittest.main()
