"""Dedicated crew for the Declarative Generative UI (A2UI Dynamic Schema) demo.

Mirrors `langgraph-python/src/agents/a2ui_dynamic.py` with CrewAI plumbing:

- A single-agent crew that owns a `GenerateA2uiTool` which invokes a
  secondary LLM bound to a `render_a2ui` function-call, producing A2UI
  `a2ui_operations` that the runtime's A2UI middleware forwards to the
  frontend renderer.
- The agent is tuned via role/backstory to call `generate_a2ui` whenever a
  response would benefit from a rich visual, matching the system prompt in
  the langgraph reference.

CrewAI caveat: `ChatWithCrewFlow` wraps every chat turn in a CrewAI
"platform" system prompt that encourages the LLM to introduce itself and
ask for clarifying inputs before calling tools. We counter that via
`preseed_system_prompt` which installs a stronger `crew_description` so the
surrounding boilerplate still lands on a prompt that steers the LLM towards
tool-calling for visual requests.

Reference:
  langgraph-python/src/agents/a2ui_dynamic.py
"""

from __future__ import annotations

from crewai import Agent, Crew, Process, Task

from ._chat_flow_helpers import preseed_system_prompt
from .tools.custom_tool import GenerateA2uiTool

DECLARATIVE_GEN_UI_BACKSTORY = (
    "You are a demo assistant for Declarative Generative UI (A2UI - Dynamic "
    "Schema). Whenever a response would benefit from a rich visual - a "
    "dashboard, status report, KPI summary, card layout, info grid, a "
    "pie/donut chart of part-of-whole breakdowns, a bar chart comparing "
    "values across categories, or anything more structured than plain text - "
    "call the generate_a2ui tool to draw it. The registered catalog "
    "includes Card, StatusBadge, Metric, InfoRow, PrimaryButton, PieChart, "
    "and BarChart (in addition to the basic A2UI primitives). Prefer "
    "PieChart for part-of-whole breakdowns (sales by region, traffic "
    "sources, portfolio allocation) and BarChart for comparisons across "
    "categories (quarterly revenue, headcount by team, signups per month). "
    "generate_a2ui takes a single `context` argument; pass the user's "
    "request as the context and it handles the rendering automatically. "
    "Keep chat replies to one short sentence; let the UI do the talking."
)

CREW_NAME = "DeclarativeGenUI"

# Pre-seed the ag_ui_crewai cache so ChatWithCrewFlow skips its secondary
# description-generation LLM calls at construction time and embeds our
# verbatim guidance into build_system_message.
preseed_system_prompt(
    CREW_NAME,
    (
        "Declarative Generative UI demo. The registered catalog includes "
        "Card, StatusBadge, Metric, InfoRow, PrimaryButton, PieChart, and "
        "BarChart. Prefer calling generate_a2ui whenever a dashboard, chart, "
        "or card layout would improve the answer. Keep chat replies to one "
        "short sentence."
    ),
)

def _build_crew() -> Crew:
    agent = Agent(
        role="Declarative Generative UI Demo Assistant",
        goal=(
            "Answer the user by rendering branded A2UI components via the "
            "generate_a2ui tool whenever a visual would help."
        ),
        backstory=DECLARATIVE_GEN_UI_BACKSTORY,
        verbose=False,
        tools=[GenerateA2uiTool()],
    )

    task = Task(
        description=(
            "Respond to the user. Call generate_a2ui when a chart, "
            "dashboard, or card layout would improve the answer."
        ),
        expected_output=(
            "A short one-sentence reply alongside any rendered A2UI surface."
        ),
        agent=agent,
    )

    return Crew(
        name=CREW_NAME,
        agents=[agent],
        tasks=[task],
        process=Process.sequential,
        verbose=False,
        chat_llm="gpt-4o",
    )

_cached_crew: Crew | None = None

class DeclarativeGenUI:
    """Adapter matching the `.crew()` + `.name` shape expected by
    `add_crewai_crew_fastapi_endpoint`.
    """

    name: str = CREW_NAME

    def crew(self) -> Crew:
        global _cached_crew
        if _cached_crew is None:
            _cached_crew = _build_crew()
        return _cached_crew
