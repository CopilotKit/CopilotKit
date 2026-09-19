"""Dedicated tools and history for the four-turn headless showcase demo."""

import json
import os
from typing import Annotated, Literal

from llama_index.core.llms import ChatMessage, ChatResponse, MessageRole
from llama_index.core.base.llms.types import ToolCallBlock
from llama_index.core.workflow import Context
from llama_index.protocols.ag_ui.events import MessagesSnapshotWorkflowEvent
from llama_index.protocols.ag_ui.utils import (
    llama_index_message_to_ag_ui_message,
    timestamp,
)
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router

from agents.agent import get_weather
from agents.gen_ui_tool_based_agent import _ChartOpenAI, _normalize_chart_messages
from agents.hitl_in_chat_agent import FixedAGUIChatWorkflow
from tools import get_revenue_chart_impl


async def get_stock_price(
    ticker: Annotated[str, "Stock ticker symbol, such as AAPL."],
) -> str:
    """Return the deterministic demo quote, not a live market price."""
    return json.dumps(
        {"ticker": ticker.upper(), "price_usd": 189.42, "change_pct": 1.27}
    )


async def get_revenue_chart() -> str:
    """Get the shared demo revenue series for the last six months."""
    return json.dumps(get_revenue_chart_impl())


def highlight_note(
    text: Annotated[str, "The short note to highlight."],
    color: Annotated[
        Literal["yellow", "pink", "green", "blue"], "The highlight color."
    ],
) -> str:
    """Highlight a short note in a chosen color on the frontend."""
    return ""


class _HeadlessWorkflow(FixedAGUIChatWorkflow):
    def _snapshot_messages(self, ctx: Context, chat_history: list[ChatMessage]) -> None:
        history = [message.model_copy(deep=True) for message in chat_history]
        if history and history[-1].role == MessageRole.ASSISTANT:
            pending = history[-1]
            if pending.additional_kwargs.get("tool_calls") or any(
                isinstance(block, ToolCallBlock) for block in pending.blocks
            ):
                # This snapshot precedes the newest call's streamed chunks.
                # Keep completed history, but avoid sending that call twice.
                pending.additional_kwargs.pop("tool_calls", None)
                pending.additional_kwargs.pop("ag_ui_tool_calls", None)
                pending.blocks = [
                    block
                    for block in pending.blocks
                    if not isinstance(block, ToolCallBlock)
                ]
        genuine_content = [
            message.content for message in _normalize_chart_messages(history)
        ]
        for message in history:
            if message.role == MessageRole.ASSISTANT:
                calls = self.llm.get_tool_calls_from_response(
                    ChatResponse(message=message), error_on_no_tool_call=False
                )
                if calls:
                    message.additional_kwargs["ag_ui_tool_calls"] = [
                        {
                            "id": call.tool_id,
                            "name": call.tool_name,
                            "arguments": json.dumps(call.tool_kwargs),
                        }
                        for call in calls
                    ]
        messages = [
            llama_index_message_to_ag_ui_message(message) for message in history
        ]
        for message, content in zip(messages, genuine_content):
            if message.role == "assistant":
                # The upstream converter strips whitespace and XML-like text.
                # Only its generated tool suffix should disappear from prose.
                message.content = content
        ctx.write_event_to_stream(
            MessagesSnapshotWorkflowEvent(timestamp=timestamp(), messages=messages)
        )


SYSTEM_PROMPT = (
    "You are a concise demo assistant. Use get_weather for weather, "
    "get_stock_price for deterministic demo stock quotes, highlight_note to "
    "highlight notes, and get_revenue_chart for the six-month revenue chart. "
    "Describe the actual tool results briefly and accurately."
)


async def _headless_workflow_factory():
    openai_kwargs = {}
    if os.environ.get("OPENAI_BASE_URL"):
        openai_kwargs["api_base"] = os.environ["OPENAI_BASE_URL"]
    workflow = _HeadlessWorkflow(
        llm=_ChartOpenAI(model="gpt-5-mini", **openai_kwargs),
        frontend_tools=[get_weather, highlight_note],
        backend_tools=[get_stock_price, get_revenue_chart],
        system_prompt=SYSTEM_PROMPT,
        initial_state={},
    )
    workflow.render_only_tool_names = {"get_weather"}
    return workflow


headless_complete_router = get_ag_ui_workflow_router(
    workflow_factory=_headless_workflow_factory,
)
