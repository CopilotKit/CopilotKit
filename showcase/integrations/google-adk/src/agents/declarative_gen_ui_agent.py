"""Agent backing the Declarative Generative UI (A2UI dynamic) demo.

Runtime-driven auto-injection, mirroring the langgraph-python and AWS Strands
gold-standard declarative-gen-ui demos: this is a PLAIN agent with no
`generate_a2ui` tool wired. The route sets `a2ui.injectA2UITool: true`, and the
ag-ui-adk >= 0.7.0 adapter sees that forwarded flag and auto-injects the no-arg
`generate_a2ui` tool (via `plan_a2ui_injection`), then drives a forced
`render_a2ui` sub-agent through the toolkit's validate->retry recovery loop and
wraps the result as `a2ui_operations`, which the A2UI middleware detects and
renders. The sub-agent model is inferred from this agent's `canonical_model`,
so it routes through the same aimock proxy as the primary agent.

(The previous hand-rolled `google.genai` secondary planner is gone; the
ADK-only a2ui-recovery demo keeps the backend-owned `get_a2ui_tool` wiring
instead, since only that path surfaces the recovery loop explicitly.)

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

from agents.shared_chat import get_model, stop_on_terminal_text

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

# Plain agent — no A2UI tool wired. The route's `injectA2UITool: true` makes the
# ag-ui-adk adapter auto-inject the no-arg `generate_a2ui` tool before the run
# (USER-PREVAILS: because this agent declares none, the adapter injects its own).
# `defaultCatalogId` is pinned on the route; the catalog schema arrives from the
# client via context.
declarative_gen_ui_agent = LlmAgent(
    name="DeclarativeGenUiAgent",
    model=get_model(),
    instruction=_INSTRUCTION,
    tools=[],
    after_model_callback=stop_on_terminal_text,
)
