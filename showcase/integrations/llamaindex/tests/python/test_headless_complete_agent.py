"""Headless contracts exercised through installed workflow and SDK boundaries."""

import asyncio
import json
import unittest

from ag_ui.core import AssistantMessage, FunctionCall, ToolCall, ToolMessage
from llama_index.core.llms import ChatMessage
from llama_index.core.base.llms.types import TextBlock, ToolCallBlock
from llama_index.llms.openai.utils import to_openai_message_dicts
from llama_index.protocols.ag_ui.utils import ag_ui_message_to_llama_index_message
from openai.types.chat import ChatCompletionMessageToolCall

from agents.gen_ui_tool_based_agent import _ChartOpenAI, _normalize_chart_messages
from agents.headless_complete_agent import _headless_workflow_factory


class EventCollector:
    def __init__(self):
        self.events = []

    def write_event_to_stream(self, event):
        self.events.append(event)


def completed_weather():
    return [
        ag_ui_message_to_llama_index_message(message)
        for message in [
            AssistantMessage(
                id="weather-assistant",
                content="Weather  \n",
                tool_calls=[
                    ToolCall(
                        id="weather-call",
                        function=FunctionCall(
                            name="get_weather", arguments='{"location":"Tokyo"}'
                        ),
                    )
                ],
            ),
            ToolMessage(
                id="weather-result",
                tool_call_id="weather-call",
                content='{"city":"Tokyo","temperature":85,"conditions":"Sunny"}',
            ),
        ]
    ]


def new_stock():
    return ChatMessage(
        role="assistant",
        blocks=[
            TextBlock(text="Checking the demo quote  \n"),
            ToolCallBlock(
                tool_call_id="stock-call",
                tool_name="get_stock_price",
                tool_kwargs='{"ticker":"AAPL"}',
            ),
        ],
        additional_kwargs={
            "id": "stock-assistant",
            "tool_calls": [
                ChatCompletionMessageToolCall(
                    id="stock-call",
                    type="function",
                    function={
                        "name": "get_stock_price",
                        "arguments": '{"ticker":"AAPL"}',
                    },
                )
            ],
        },
    )


class HeadlessTests(unittest.TestCase):
    def setUp(self):
        self.workflow = asyncio.run(_headless_workflow_factory())

    def snapshot(self, history):
        before = [message.model_dump() for message in history]
        collector = EventCollector()
        self.workflow._snapshot_messages(collector, history)
        self.assertEqual([message.model_dump() for message in history], before)
        self.assertEqual(len(collector.events), 1)
        return collector.events[0].messages

    def test_catalog_matches_four_headless_tools(self):
        self.assertEqual(
            set(self.workflow.frontend_tools), {"get_weather", "highlight_note"}
        )
        self.assertEqual(
            set(self.workflow.backend_tools), {"get_stock_price", "get_revenue_chart"}
        )
        self.assertEqual(self.workflow.render_only_tool_names, {"get_weather"})
        self.assertIsInstance(self.workflow.llm, _ChartOpenAI)

    def test_real_stock_tool_returns_retained_demo_contract(self):
        self.assertIn("get_stock_price", self.workflow.backend_tools)
        tool = self.workflow.backend_tools["get_stock_price"]
        self.assertEqual(tool.metadata.get_parameters_dict()["required"], ["ticker"])
        result = asyncio.run(tool.acall(ticker="aapl"))
        self.assertFalse(result.is_error)
        self.assertEqual(
            json.loads(result.content),
            {
                "ticker": "AAPL",
                "price_usd": 189.42,
                "change_pct": 1.27,
            },
        )

    def test_real_revenue_tool_reads_shared_six_month_series(self):
        self.assertIn("get_revenue_chart", self.workflow.backend_tools)
        result = asyncio.run(self.workflow.backend_tools["get_revenue_chart"].acall())
        self.assertFalse(result.is_error)
        chart = json.loads(result.content)
        self.assertEqual(chart["title"], "Quarterly revenue")
        self.assertEqual(chart["subtitle"], "Last six months · USD thousands")
        self.assertEqual(
            chart["data"],
            [
                {"label": label, "value": value}
                for label, value in zip(
                    ["Jan", "Feb", "Mar", "Apr", "May", "Jun"], [38, 47, 52, 49, 63, 71]
                )
            ],
        )

    def test_highlight_is_frontend_owned_not_render_only(self):
        self.assertIn("highlight_note", self.workflow.frontend_tools)
        self.assertNotIn("highlight_note", self.workflow.render_only_tool_names)
        tool = self.workflow.frontend_tools["highlight_note"]
        schema = tool.metadata.get_parameters_dict()
        self.assertEqual(
            schema["properties"]["color"]["enum"], ["yellow", "pink", "green", "blue"]
        )
        result = asyncio.run(tool.acall(text="ship the demo on Friday", color="yellow"))
        self.assertEqual(result.content, "")

    def test_pre_chunk_snapshot_keeps_prior_call_and_hides_only_new_call(self):
        messages = self.snapshot([*completed_weather(), new_stock()])
        self.assertEqual(messages[0].tool_calls[0].id, "weather-call")
        self.assertEqual(messages[0].content, "Weather  \n")
        self.assertEqual(messages[1].tool_call_id, "weather-call")
        self.assertEqual(messages[2].id, "stock-assistant")
        self.assertFalse(messages[2].tool_calls)
        self.assertEqual(messages[2].content, "Checking the demo quote  \n")

    def test_result_snapshot_preserves_both_call_result_pairs(self):
        messages = self.snapshot(
            [
                *completed_weather(),
                new_stock(),
                ChatMessage(
                    role="tool",
                    content='{"ticker":"AAPL","price_usd":189.42,"change_pct":1.27}',
                    additional_kwargs={
                        "id": "stock-result",
                        "tool_call_id": "stock-call",
                    },
                ),
            ]
        )
        self.assertEqual(messages[0].tool_calls[0].id, "weather-call")
        self.assertEqual(messages[2].tool_calls[0].id, "stock-call")
        self.assertEqual(
            json.loads(messages[2].tool_calls[0].function.arguments), {"ticker": "AAPL"}
        )
        self.assertEqual(messages[3].tool_call_id, "stock-call")
        self.assertEqual(messages[3].id, "stock-result")
        imported = [
            ag_ui_message_to_llama_index_message(message) for message in messages
        ]
        wire = to_openai_message_dicts(_normalize_chart_messages(imported))
        for assistant, result in [(wire[0], wire[1]), (wire[2], wire[3])]:
            self.assertEqual(assistant["tool_calls"][0]["id"], result["tool_call_id"])
            self.assertEqual(result["role"], "tool")
            self.assertNotIn("ag_ui_tool_calls", assistant)
            self.assertNotIn("id", assistant)
        self.assertEqual(wire[0]["content"], "Weather  \n")

    def test_distinct_historical_content_stays_with_its_message(self):
        narration = "Keep <tool_call>quoted example</tool_call>  \n"
        stock = ag_ui_message_to_llama_index_message(
            AssistantMessage(
                id="stock-old",
                content=narration,
                tool_calls=[
                    ToolCall(
                        id="stock-old-call",
                        function=FunctionCall(
                            name="get_stock_price", arguments='{"ticker":"AAPL"}'
                        ),
                    )
                ],
            )
        )
        result = ag_ui_message_to_llama_index_message(
            ToolMessage(
                id="stock-old-result",
                tool_call_id="stock-old-call",
                content="result stays verbatim  \n",
            )
        )
        messages = self.snapshot(
            [
                *completed_weather(),
                stock,
                result,
                ChatMessage(
                    role="assistant",
                    content="Final answer  \n",
                    additional_kwargs={"id": "final"},
                ),
            ]
        )
        self.assertEqual(
            [message.content for message in messages],
            [
                "Weather  \n",
                '{"city":"Tokyo","temperature":85,"conditions":"Sunny"}',
                narration,
                "result stays verbatim  \n",
                "Final answer  \n",
            ],
        )
        self.assertEqual(messages[2].tool_calls[0].id, "stock-old-call")

    def test_text_snapshot_preserves_completed_calls(self):
        messages = self.snapshot(
            [
                *completed_weather(),
                ChatMessage(
                    role="assistant",
                    content="A clear answer.",
                    additional_kwargs={"id": "answer"},
                ),
            ]
        )
        self.assertEqual(messages[0].tool_calls[0].id, "weather-call")
        self.assertEqual(messages[-1].content, "A clear answer.")
        self.assertEqual(messages[-1].id, "answer")


if __name__ == "__main__":
    unittest.main()
