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

from autogen import ConversableAgent, LLMConfig
from autogen.ag_ui import AGUIStream  # type: ignore[import-not-found]  # runtime-only submodule (ag2[ag-ui] extra); not present in static type stubs
from fastapi import FastAPI

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
    "automatically. Keep chat replies to one short sentence; let the UI do "
    "the talking."
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


agent = ConversableAgent(
    name="declarative_gen_ui_assistant",
    system_message=SYSTEM_PROMPT,
    llm_config=LLMConfig({"model": "gpt-4o-mini", "stream": True}),
    human_input_mode="NEVER",
    max_consecutive_auto_reply=8,
    functions=[generate_a2ui],
)

stream = AGUIStream(agent)
a2ui_dynamic_app = FastAPI()
a2ui_dynamic_app.mount("", stream.build_asgi())
