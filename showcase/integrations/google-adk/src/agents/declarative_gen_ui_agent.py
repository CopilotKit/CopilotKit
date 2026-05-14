"""Agent backing the Declarative Generative UI (A2UI dynamic) demo.

Re-exports the `generate_a2ui` tool defined in agents/main.py; this
secondary-LLM A2UI planner is already wired up there. The agent calls
`generate_a2ui` whenever the user's request can be served by a dashboard
component (cards, charts, lists, forms, etc.) and the runtime middleware
detects the a2ui_operations container in the tool result.

The instruction mirrors LP's `a2ui_dynamic.py` SYSTEM_PROMPT verbatim so
both showcases steer the LLM toward the same catalog usage patterns and
chart-vs-card heuristics. See
`showcase/integrations/langgraph-python/src/agents/a2ui_dynamic.py` for
the canonical source.
"""

from __future__ import annotations

from google.adk.agents import LlmAgent

from agents.shared_chat import get_model, stop_on_terminal_text

# `agents.main` defines `generate_a2ui` — reuse it here instead of cloning.
from agents.main import generate_a2ui

# Ported verbatim from LP's a2ui_dynamic.SYSTEM_PROMPT so the catalog usage
# heuristics, chart-type preferences, and "one short sentence" reply rule
# are identical across showcases. The catalog ("declarative-gen-ui-catalog")
# is registered by the frontend via <CopilotKit a2ui={{ catalog: myCatalog }}>
# and is serialised into the secondary LLM's context inside `generate_a2ui`.
_INSTRUCTION = (
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

declarative_gen_ui_agent = LlmAgent(
    name="DeclarativeGenUiAgent",
    model=get_model(),
    instruction=_INSTRUCTION,
    tools=[generate_a2ui],
    after_model_callback=stop_on_terminal_text,
)
