"""Stocks dashboard agent.

The agent calls `render_stocks_dashboard` with a headline + a list of
tickers. The tool builds the A2UI op envelope and returns it. The
CopilotKit A2UI middleware (on the Next.js runtime side) intercepts
the tool result and forwards the operations to the frontend renderer,
which paints the surface using the registered catalog.
"""
from __future__ import annotations

from copilotkit import CopilotKitMiddleware, a2ui
from langchain.agents import create_agent
from langchain.tools import tool
from langgraph.checkpoint.memory import MemorySaver

from src.catalog import CATALOG_ID, CATALOG_PROMPT

SURFACE = "stocks-dashboard"


@tool
def render_stocks_dashboard(headline: str, tickers: list[str]) -> str:
    """Render a stocks dashboard as an A2UI surface.

    Call this whenever the user asks to see, compare, or break down one
    or more stocks. Pass 1–6 tickers and a short headline.

    Allowed tickers: AAPL, MSFT, GOOG, NVDA, TSLA, AMZN.
    """
    card_ids = [f"card-{i}-{t}" for i, t in enumerate(tickers)]
    # A2UI v0.9: props are at the TOP LEVEL of each component object,
    # NOT nested in a `props` field. The showcase JSON confirms this.
    components: list[dict] = [
        {
            "id": "root",
            "component": "Stack",
            "children": ["overline", "heading", "grid"],
            "gap": "md",
        },
        {
            "id": "overline",
            "component": "Overline",
            "text": "DASHBOARD · LIVE",
        },
        {
            "id": "heading",
            "component": "Heading",
            "text": headline,
            "level": "1",
        },
        {
            "id": "grid",
            "component": "Grid",
            "children": card_ids,
            "columns": min(len(tickers), 3),
            "gap": "md",
        },
        *[
            {
                "id": cid,
                "component": "StockCard",
                "ticker": tickers[i],
            }
            for i, cid in enumerate(card_ids)
        ],
    ]
    return a2ui.render(
        operations=[
            a2ui.create_surface(SURFACE, catalog_id=CATALOG_ID),
            a2ui.update_components(SURFACE, components),
        ]
    )


SYSTEM_PROMPT = f"""\
You generate stock dashboards as A2UI surfaces.

When the user asks to see, compare, or visualize stocks, call
render_stocks_dashboard with a headline and the requested tickers. Never
describe the data in plain text when a dashboard is appropriate.

{CATALOG_PROMPT}
"""


def build_stocks_agent():
    return create_agent(
        model="openai:gpt-5.5",
        tools=[render_stocks_dashboard],
        middleware=[CopilotKitMiddleware()],
        system_prompt=SYSTEM_PROMPT,
        checkpointer=MemorySaver(),
    )


graph = build_stocks_agent()
