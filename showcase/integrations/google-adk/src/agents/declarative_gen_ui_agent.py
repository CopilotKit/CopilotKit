"""Agent backing the Declarative Generative UI (A2UI dynamic) demo.

Runtime-driven auto-injection: this is a plain agent with no generation tool.
The runtime forwards injectA2UITool and the selected inference format; the ADK
adapter injects exactly one generate_a2ui tool. Express uses the official
progressive response stream and compiles validated standard A2UI operations.
Direct JSON remains selectable. Both calls use the primary agent's model and
existing aimock routing. See requirements.txt for the release prerequisites.

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
