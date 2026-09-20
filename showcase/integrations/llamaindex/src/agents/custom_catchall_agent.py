"""Dedicated catalog and preserved history for the custom wildcard demo."""

import json
import os
from typing import Annotated

from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router

from agents.agent import _agent_workflow_factory
from agents.gen_ui_tool_based_agent import _ChartOpenAI
from agents.headless_complete_agent import _HeadlessWorkflow


async def get_stock_price(
    ticker: Annotated[str, "Stock ticker symbol for this demonstration."],
    price_usd: Annotated[float, "Supplied demonstration quote in USD."],
    change_pct: Annotated[float, "Supplied demonstration percentage change."],
) -> str:
    """Return the supplied demo quote; this does not fetch a live market price."""
    return json.dumps(
        {"ticker": ticker, "price_usd": price_usd, "change_pct": change_pct}
    )


async def _custom_catchall_workflow_factory():
    baseline = await _agent_workflow_factory()
    openai_kwargs = {}
    if os.environ.get("OPENAI_BASE_URL"):
        openai_kwargs["api_base"] = os.environ["OPENAI_BASE_URL"]
    workflow = _HeadlessWorkflow(
        llm=_ChartOpenAI(model="gpt-5-mini", **openai_kwargs),
        frontend_tools=list(baseline.frontend_tools.values()),
        backend_tools=[*baseline.backend_tools.values(), get_stock_price],
        system_prompt=(
            baseline.system_prompt
            + " Use get_stock_price for supplied demonstration stock quotes."
        ),
        initial_state=baseline.initial_state,
    )
    workflow.render_only_tool_names = set(baseline.render_only_tool_names)
    return workflow


custom_catchall_router = get_ag_ui_workflow_router(
    workflow_factory=_custom_catchall_workflow_factory,
)
