"""Agent backing the Declarative Generative UI (A2UI dynamic) demo.

Re-exports the `generate_a2ui` tool defined in agents/main.py; this
secondary-LLM A2UI planner is already wired up there. The agent calls
`generate_a2ui` whenever the user's request can be served by a dashboard
component (cards, charts, lists, forms, etc.) and the runtime middleware
detects the a2ui_operations container in the tool result.

The instruction mirrors LP's `a2ui_dynamic.py` SYSTEM_PROMPT (plus an
ADK-specific note that `generate_a2ui` takes no arguments) so both
showcases steer the LLM toward the same sales-analyst persona and
composition heuristics. See
`showcase/integrations/langgraph-python/src/agents/a2ui_dynamic.py` for
the canonical source. The fictional sales dataset and the per-question
composition rules arrive via frontend context entries (registered in
declarative-gen-ui/sales-context.ts), which `generate_a2ui` serialises
into the secondary planner's system instruction.
"""

from __future__ import annotations

from google.adk.agents import LlmAgent

from agents.shared_chat import get_model, stop_on_terminal_text

# `agents.main` defines `generate_a2ui` — reuse it here instead of cloning.
from agents.main import generate_a2ui

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

declarative_gen_ui_agent = LlmAgent(
    name="DeclarativeGenUiAgent",
    model=get_model(),
    instruction=_INSTRUCTION,
    tools=[generate_a2ui],
    after_model_callback=stop_on_terminal_text,
)
