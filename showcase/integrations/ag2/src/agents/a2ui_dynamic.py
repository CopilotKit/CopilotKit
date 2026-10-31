"""AG2 agent for the Declarative Generative UI (A2UI Dynamic Schema) demo.

Option A (JS-runtime-injected A2UI): the agent wires a no-arg
``generate_a2ui`` tool stub whose body raises loudly if called — the
CopilotKit runtime middleware (``a2ui.injectA2UITool: true``, enabled by
default in route.ts) intercepts the toolcall before it reaches Python and
drives the secondary ``render_a2ui`` LLM pass itself.  The frontend renderer
paints the emitted ``a2ui_operations``.

Reference: langgraph-python/src/agents/a2ui_dynamic.py (same pattern).
"""

from __future__ import annotations

import logging

from ag2 import Agent
from ag2.ag_ui import AGUIStream
from ag2.config.openai import OpenAIResponsesConfig
from fastapi import FastAPI

from ._loop_cap import loop_cap

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are a demo assistant for Declarative Generative UI (A2UI — Dynamic "
    "Schema). Whenever a response would benefit from a rich visual — a "
    "dashboard, status report, KPI summary, card layout, info grid, a "
    "pie/donut chart of part-of-whole breakdowns, a bar chart comparing "
    "values across categories, or anything more structured than plain text — "
    "call `generate_a2ui` to draw it. The registered catalog includes "
    "`Card`, `StatusBadge`, `Metric`, `InfoRow`, `PrimaryButton`, `PieChart`, "
    "and `BarChart` (in addition to the basic A2UI primitives). Prefer "
    "`PieChart` for part-of-whole breakdowns (sales by region, traffic "
    "sources, portfolio allocation) and `BarChart` for comparisons across "
    "categories (quarterly revenue, headcount by team, signups per month). "
    "`generate_a2ui` takes no arguments and handles the rendering "
    "automatically. Never ask clarifying questions: if a request is "
    "underspecified (time period, region, metric), assume sensible defaults "
    "and call `generate_a2ui` immediately. Keep chat replies to one short "
    "sentence; let the UI do the talking."
)


def generate_a2ui() -> str:
    """Generate dynamic A2UI components based on the conversation.

    Takes NO arguments. The CopilotKit runtime middleware
    (``a2ui.injectA2UITool: true``) intercepts this toolcall before it
    reaches the Python body and drives the secondary ``render_a2ui`` LLM
    pass itself. If this body actually executes, the middleware is
    misconfigured — raise loudly so the failure is visible.
    """
    raise RuntimeError(
        "generate_a2ui called directly — the CopilotKit a2ui middleware "
        "should intercept this call before it reaches the agent. "
        "Check the route configuration at "
        "app/api/copilotkit-declarative-gen-ui/route.ts."
    )


agent = Agent(
    "declarative_gen_ui_assistant",
    prompt=SYSTEM_PROMPT,
    config=OpenAIResponsesConfig(model="gpt-5-mini", streaming=True),
    tools=[generate_a2ui],
    middleware=[loop_cap(8)],
)

stream = AGUIStream(agent)
a2ui_dynamic_app = FastAPI()
a2ui_dynamic_app.mount("", stream.build_asgi())
