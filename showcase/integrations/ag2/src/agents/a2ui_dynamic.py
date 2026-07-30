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

import openai
from ag2 import Agent
from ag2.config import OpenAIConfig
from ag2.ag_ui import AGUIStream  # type: ignore[import-not-found]  # runtime-only submodule (ag2[ag-ui] extra); not present in static type stubs
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
    # A4 / R2-A3: thread the latest user prompt from the outer conversation
    # into the inner call so each pill's request body is byte-distinct
    # (without this, all 4 declarative pills produce IDENTICAL wire payloads
    # because the outer agent calls generate_a2ui with arguments="{}" →
    # context defaults → system message is constant, and the user message
    # below is hardcoded).
    #
    # The prompt is read from a per-request ContextVar populated by
    # ``RequestUserMessageMiddleware`` at the inbound HTTP boundary — NOT
    # from any agent-held conversation state (which would be shared
    # module-level mutable state racing across concurrent requests). If the
    # middleware did not
    # capture anything (non-AG-UI request, parse failure already logged at
    # WARNING) we fall back to the original hardcoded prompt so the inner
    # LLM call still produces a sensible default.
    user_prompt = get_latest_user_message() or (
        "Generate a dynamic A2UI dashboard based on the conversation."
    )


agent = Agent(
    name="declarative_gen_ui_assistant",
    prompt=SYSTEM_PROMPT,
    config=OpenAIConfig(model="gpt-4o-mini", streaming=True),
    # Guard-rationale note: the 0.x port capped tool-call loops with
    # max_consecutive_auto_reply=8; ag2 1.0 has no direct per-turn
    # auto-reply cap, so no equivalent parameter is set here.
    tools=[generate_a2ui],
)

stream = AGUIStream(agent)
a2ui_dynamic_app = FastAPI()
a2ui_dynamic_app.mount("", stream.build_asgi())
