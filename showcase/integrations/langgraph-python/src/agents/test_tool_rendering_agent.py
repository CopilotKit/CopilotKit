"""The tool-rendering agent must not narrate failed tool results as success."""

import unittest

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.runtime import Runtime

from src.agents import tool_rendering_agent


class ToolFailureGuardTests(unittest.TestCase):
    def guard(self, messages):
        self.assertTrue(hasattr(tool_rendering_agent, "stop_after_tool_failure"))
        return tool_rendering_agent.stop_after_tool_failure.before_model(
            {"messages": messages}, Runtime()
        )

    def test_failed_tool_ends_batch_without_rewriting_error(self):
        failure = ToolMessage(
            content="location: Field required", tool_call_id="weather-1", status="error"
        )
        messages = [HumanMessage(content="Weather in Tokyo"), failure]
        result = self.guard(messages)
        self.assertEqual(result["jump_to"], "end")
        self.assertIsInstance(result["messages"][0], AIMessage)
        self.assertIn("retry", result["messages"][0].content.lower())
        self.assertIs(messages[-1], failure)
        self.assertEqual(failure.content, "location: Field required")
        self.assertEqual(failure.status, "error")

    def test_successful_tool_does_not_end_batch(self):
        self.assertIsNone(
            self.guard(
                [ToolMessage(content='{"city":"Tokyo"}', tool_call_id="weather-1")]
            )
        )

    def test_new_user_turn_does_not_reuse_historical_failure(self):
        self.assertIsNone(
            self.guard(
                [
                    ToolMessage(
                        content="failed", tool_call_id="weather-1", status="error"
                    ),
                    HumanMessage(content="Weather in Tokyo"),
                ]
            )
        )

    def test_successful_sibling_does_not_hide_error_in_current_batch(self):
        result = self.guard(
            [
                HumanMessage(content="Weather and flights"),
                ToolMessage(content="failed", tool_call_id="weather-1", status="error"),
                ToolMessage(content="flights found", tool_call_id="flight-1"),
            ]
        )
        self.assertEqual(result["jump_to"], "end")


if __name__ == "__main__":
    unittest.main()
