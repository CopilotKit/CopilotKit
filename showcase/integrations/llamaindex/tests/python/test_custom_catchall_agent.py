"""Catchall catalog and history exercised through the installed SDK."""

import asyncio
import json
import unittest

from ag_ui.core import ToolMessage
from llama_index.core.llms import ChatMessage
from llama_index.core.base.llms.types import TextBlock, ToolCallBlock
from llama_index.llms.openai.utils import to_openai_message_dicts
from llama_index.protocols.ag_ui.utils import ag_ui_message_to_llama_index_message
from openai.types.chat import ChatCompletionMessageToolCall

from agents.agent import _agent_workflow_factory
from agents.custom_catchall_agent import _custom_catchall_workflow_factory
from agents.gen_ui_tool_based_agent import _ChartOpenAI, _normalize_chart_messages
from test_headless_complete_agent import EventCollector, completed_weather


STOCK_ARGUMENTS = {"ticker": "AAPL", "price_usd": 338.37, "change_pct": -2.96}


def pending_stock():
    arguments = json.dumps(STOCK_ARGUMENTS)
    return ChatMessage(
        role="assistant",
        blocks=[
            TextBlock(text="Quote  \n"),
            ToolCallBlock(
                tool_call_id="stock-call",
                tool_name="get_stock_price",
                tool_kwargs=arguments,
            ),
        ],
        additional_kwargs={
            "id": "stock-assistant",
            "tool_calls": [
                ChatCompletionMessageToolCall(
                    id="stock-call",
                    type="function",
                    function={"name": "get_stock_price", "arguments": arguments},
                )
            ],
        },
    )


class CustomCatchallTests(unittest.TestCase):
    def setUp(self):
        self.workflow = asyncio.run(_custom_catchall_workflow_factory())

    def snapshot(self, history):
        before = [message.model_dump() for message in history]
        collector = EventCollector()
        self.workflow._snapshot_messages(collector, history)
        self.assertEqual([message.model_dump() for message in history], before)
        self.assertEqual(len(collector.events), 1)
        return collector.events[0].messages

    def test_catalog_preserves_baseline_tools_and_configuration(self):
        baseline = asyncio.run(_agent_workflow_factory())
        for name, tool in baseline.frontend_tools.items():
            self.assertIn(name, self.workflow.frontend_tools)
            self.assertEqual(
                self.workflow.frontend_tools[name].metadata.get_parameters_dict(),
                tool.metadata.get_parameters_dict(),
            )
        self.assertEqual(
            set(self.workflow.frontend_tools), set(baseline.frontend_tools)
        )
        self.assertEqual(
            set(self.workflow.backend_tools),
            {*baseline.backend_tools, "get_stock_price"},
        )
        for name, tool in baseline.backend_tools.items():
            self.assertEqual(
                self.workflow.backend_tools[name].metadata.get_parameters_dict(),
                tool.metadata.get_parameters_dict(),
            )
        self.assertEqual(self.workflow.initial_state, baseline.initial_state)
        self.assertEqual(
            self.workflow.render_only_tool_names, baseline.render_only_tool_names
        )
        self.assertIn(baseline.system_prompt, self.workflow.system_prompt)
        self.assertIsInstance(self.workflow.llm, _ChartOpenAI)

    def test_existing_flight_tool_preserves_supplied_flight_values(self):
        self.assertIn("search_flights", self.workflow.backend_tools)
        flights = [
            {
                "airline": "United Airlines",
                "airlineLogo": "https://www.google.com/s2/favicons?domain=united.com&sz=128",
                "flightNumber": "UA123",
                "origin": "SFO",
                "destination": "JFK",
                "date": "Tue, Apr 15",
                "departureTime": "08:00",
                "arrivalTime": "16:30",
                "duration": "5h 30m",
                "status": "On Time",
                "statusColor": "#22c55e",
                "price": "$349",
                "currency": "USD",
            },
            {
                "airline": "Delta",
                "airlineLogo": "https://www.google.com/s2/favicons?domain=delta.com&sz=128",
                "flightNumber": "DL456",
                "origin": "SFO",
                "destination": "JFK",
                "date": "Tue, Apr 15",
                "departureTime": "10:15",
                "arrivalTime": "18:45",
                "duration": "5h 30m",
                "status": "On Time",
                "statusColor": "#22c55e",
                "price": "$289",
                "currency": "USD",
            },
        ]
        result = asyncio.run(
            self.workflow.backend_tools["search_flights"].acall(flights=flights)
        )
        self.assertFalse(result.is_error)
        operations = json.loads(result.content)["a2ui_operations"]
        update = next(
            operation["updateDataModel"]
            for operation in operations
            if "updateDataModel" in operation
        )
        self.assertEqual(update["value"]["flights"], flights)

    def test_stock_schema_accepts_original_quote_arguments(self):
        self.assertIn("get_stock_price", self.workflow.backend_tools)
        schema = self.workflow.backend_tools[
            "get_stock_price"
        ].metadata.get_parameters_dict()
        self.assertEqual(set(schema["required"]), set(STOCK_ARGUMENTS))
        self.assertEqual(schema["properties"]["ticker"]["type"], "string")
        self.assertEqual(schema["properties"]["price_usd"]["type"], "number")
        self.assertEqual(schema["properties"]["change_pct"]["type"], "number")

    def test_real_stock_execution_preserves_supplied_quote(self):
        self.assertIn("get_stock_price", self.workflow.backend_tools)
        tool = self.workflow.backend_tools["get_stock_price"]
        for quote in [
            STOCK_ARGUMENTS,
            {"ticker": "MSFT", "price_usd": 412.5, "change_pct": 0.25},
        ]:
            with self.subTest(quote=quote):
                result = asyncio.run(tool.acall(**quote))
                self.assertFalse(result.is_error)
                self.assertEqual(json.loads(result.content), quote)

    def test_pending_snapshot_keeps_weather_but_not_duplicate_stock(self):
        messages = self.snapshot([*completed_weather(), pending_stock()])
        self.assertTrue(messages[0].tool_calls)
        self.assertEqual(messages[0].tool_calls[0].id, "weather-call")
        self.assertEqual(messages[0].content, "Weather  \n")
        self.assertEqual(messages[1].tool_call_id, "weather-call")
        self.assertFalse(messages[2].tool_calls)
        self.assertEqual(messages[2].content, "Quote  \n")

    def test_completed_snapshot_and_provider_preserve_both_results(self):
        result = ag_ui_message_to_llama_index_message(
            ToolMessage(
                id="stock-result",
                tool_call_id="stock-call",
                content=json.dumps(STOCK_ARGUMENTS),
            )
        )
        messages = self.snapshot([*completed_weather(), pending_stock(), result])
        self.assertTrue(messages[0].tool_calls)
        self.assertTrue(messages[2].tool_calls)
        self.assertEqual(
            json.loads(messages[2].tool_calls[0].function.arguments), STOCK_ARGUMENTS
        )
        history = [
            ag_ui_message_to_llama_index_message(message) for message in messages
        ]
        wire = to_openai_message_dicts(_normalize_chart_messages(history))
        for assistant, tool in [(wire[0], wire[1]), (wire[2], wire[3])]:
            self.assertEqual(assistant["tool_calls"][0]["id"], tool["tool_call_id"])
            self.assertEqual(tool["role"], "tool")
            self.assertNotIn("id", assistant)
            self.assertNotIn("ag_ui_tool_calls", assistant)
        self.assertEqual(json.loads(wire[3]["content"]), STOCK_ARGUMENTS)
        self.assertEqual(wire[0]["content"], "Weather  \n")
        self.assertEqual(wire[2]["content"], "Quote  \n")


if __name__ == "__main__":
    unittest.main()
