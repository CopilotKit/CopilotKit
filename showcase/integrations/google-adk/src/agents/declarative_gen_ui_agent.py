"""Agent backing the Declarative Generative UI (A2UI dynamic) demo.

Owns the A2UI tool explicitly via the middleware's `get_a2ui_tool()`
(ag-ui-adk >= 0.7.0): the model calls the no-arg `generate_a2ui`, and the
tool drives a forced `render_a2ui` sub-agent plus the toolkit's
validate->retry recovery loop + recovery-exhausted hard-fail envelope
(OSS-158). The result is wrapped as `a2ui_operations`, which the A2UI
middleware detects and renders.

This replaces the previous hand-rolled `google.genai` secondary planner
with the published middleware sub-agent, using the **backend-owned** wiring
(`injectA2UITool: false` on the route) — matching the AWS Strands / ag2
external-framework convention rather than langgraph-python's runtime-driven
`injectA2UITool: true`. Backend-owned is required here: with the planner now
living in the ADK middleware, letting the runtime also inject its tool would
double-bind (and CopilotKit#5611 makes a provider catalog default
`injectA2UITool` to true unless the route sets it false explicitly).

The instruction mirrors LP's `a2ui_dynamic.py` SYSTEM_PROMPT so both
showcases steer the LLM toward the same sales-analyst persona and
composition heuristics. The fictional sales dataset and the per-question
composition rules arrive via frontend context entries (registered in
declarative-gen-ui/sales-context.ts); the middleware routes that copilotkit
context — and the frontend catalog schema — into the sub-agent prompt
automatically (see ag-ui-adk CONTEXT_STATE_KEY routing).
"""

from __future__ import annotations

from google.adk.agents import LlmAgent
from ag_ui_adk import get_a2ui_tool

from agents.shared_chat import get_a2ui_model, get_model, stop_on_terminal_text

_INSTRUCTION = (
    "You are the embedded sales analyst for Vantage Threads, the fictional "
    "B2B apparel company described in your context. Answer every business "
    "question by calling `generate_a2ui` to draw a rich visual surface, and "
    "keep the chat reply to one short sentence.\n"
    "\n"
    "Ground every number in the sales dataset from your context — never "
    "invent figures that contradict it. Follow the dashboard composition "
    "rules from your context when choosing components: pick the component "
    "by the shape of the question (snapshot → composed KPI dashboard with "
    "charts; team performance → DataTable; risk → StatusBadge cards; "
    "single account → InfoRow facts; part-of-whole → PieChart; "
    "trend/comparison → BarChart). Never ask the user which chart they "
    "want. `generate_a2ui` takes no arguments and handles the rendering "
    "automatically. Compose generously — a dashboard should feel like a "
    "real analytics product, not a single widget."
)

# Backend-owned A2UI: wire the middleware's `generate_a2ui` (no-arg) tool
# directly. `default_catalog_id` matches the frontend `defaultCatalogId` and
# the page's `createCatalog({ catalogId: "declarative-gen-ui-catalog" })`; the
# actual catalog schema still arrives from the client via context. Recovery +
# hard-fail are enabled by the toolkit defaults (resolve_a2ui_tool_params).
declarative_gen_ui_agent = LlmAgent(
    name="DeclarativeGenUiAgent",
    model=get_model(),
    instruction=_INSTRUCTION,
    tools=[
        get_a2ui_tool(
            {
                "model": get_a2ui_model(),
                "default_catalog_id": "declarative-gen-ui-catalog",
            }
        )
    ],
    after_model_callback=stop_on_terminal_text,
)
