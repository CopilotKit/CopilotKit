"""Dedicated crew for the BYOC json-render demo.

Mirrors `langgraph-python/src/agents/byoc_json_render_agent.py`:

Emits a single JSON object shaped like `@json-render/react`'s flat spec
format (`{ root, elements }`) so the frontend can feed it directly into
`<Renderer />` against a Zod-validated catalog of three components
(MetricCard, BarChart, PieChart).

CrewAI caveat: ChatWithCrewFlow wraps every chat turn in a CrewAI
"platform" system prompt that fights JSON-only output. We install a hard
override via `install_custom_system_message` that replaces the composed
system message with our json-render schema prompt.
"""

from __future__ import annotations

from crewai import Agent, Crew, Process, Task

from agents._chat_flow_helpers import (
    install_custom_system_message,
    preseed_system_prompt,
)


CREW_NAME = "ByocJsonRender"


BYOC_JSON_RENDER_SYSTEM_PROMPT = """
You are a sales-dashboard UI generator for a BYOC json-render demo.

When the user asks for a UI, respond with **exactly one JSON object** and
nothing else - no prose, no markdown fences, no leading explanation, no
tool calls, no clarifying questions. The object must match this schema
(the "flat element map" format consumed by `@json-render/react`):

{
  "root": "<id of the root element>",
  "elements": {
    "<id>": {
      "type": "<component name>",
      "props": { ... component-specific props ... },
      "children": [ "<id>", ... ]
    },
    ...
  }
}

Available components (use each name verbatim as "type"):

- MetricCard
  props: { "label": string, "value": string, "trend": string | null }
  Example trend strings: "+12% vs last quarter", "-3% vs last month", null.

- BarChart
  props: {
    "title": string,
    "description": string | null,
    "data": [ { "label": string, "value": number }, ... ]
  }

- PieChart
  props: {
    "title": string,
    "description": string | null,
    "data": [ { "label": string, "value": number }, ... ]
  }

Rules:

1. Output **only** valid JSON. No markdown code fences. No text outside
   the object.
2. Every id referenced in `root` or any `children` array must be a key
   in `elements`.
3. For a multi-component dashboard, use a root MetricCard and list the
   charts in its `children` array, OR pick any element as root and list
   the others as its children. Do not emit orphan elements.
4. Use realistic sales-domain values (revenue, pipeline, conversion,
   categories, months) - the demo is a sales dashboard.
5. `children` is optional but when present must be an array of strings.
6. Never invent component types outside the three listed above.

### Worked example - "Show me the sales dashboard with metrics and a revenue chart"

{
  "root": "revenue-metric",
  "elements": {
    "revenue-metric": {
      "type": "MetricCard",
      "props": {
        "label": "Revenue (Q3)",
        "value": "$1.24M",
        "trend": "+18% vs Q2"
      },
      "children": ["revenue-bar"]
    },
    "revenue-bar": {
      "type": "BarChart",
      "props": {
        "title": "Monthly revenue",
        "description": "Revenue by month across Q3",
        "data": [
          { "label": "Jul", "value": 380000 },
          { "label": "Aug", "value": 410000 },
          { "label": "Sep", "value": 450000 }
        ]
      }
    }
  }
}

### Worked example - "Break down revenue by category as a pie chart"

{
  "root": "category-pie",
  "elements": {
    "category-pie": {
      "type": "PieChart",
      "props": {
        "title": "Revenue by category",
        "description": "Share of total revenue by product category",
        "data": [
          { "label": "Enterprise", "value": 540000 },
          { "label": "SMB", "value": 310000 },
          { "label": "Self-serve", "value": 220000 },
          { "label": "Partner", "value": 170000 }
        ]
      }
    }
  }
}

### Worked example - "Show me monthly expenses as a bar chart"

{
  "root": "expense-bar",
  "elements": {
    "expense-bar": {
      "type": "BarChart",
      "props": {
        "title": "Monthly expenses",
        "description": "Operating expenses by month",
        "data": [
          { "label": "Jul", "value": 210000 },
          { "label": "Aug", "value": 225000 },
          { "label": "Sep", "value": 240000 }
        ]
      }
    }
  }
}

Respond with the JSON object only.
""".strip()


preseed_system_prompt(CREW_NAME, BYOC_JSON_RENDER_SYSTEM_PROMPT)
install_custom_system_message(CREW_NAME, BYOC_JSON_RENDER_SYSTEM_PROMPT)


def _build_crew() -> Crew:
    agent = Agent(
        role="JSON-Render Spec Emitter",
        goal="Emit a valid `{root, elements}` JSON spec.",
        backstory=BYOC_JSON_RENDER_SYSTEM_PROMPT,
        verbose=False,
        tools=[],
    )

    task = Task(
        description=(
            "Respond with a single JSON object matching the "
            "@json-render/react flat-element spec."
        ),
        expected_output="A `{ root, elements }` JSON object.",
        agent=agent,
    )

    return Crew(
        name=CREW_NAME,
        agents=[agent],
        tasks=[task],
        process=Process.sequential,
        verbose=False,
        chat_llm="gpt-4o-mini",
    )


_cached_crew: Crew | None = None


class ByocJsonRender:
    """Adapter matching `add_crewai_crew_fastapi_endpoint` shape."""

    name: str = CREW_NAME

    def crew(self) -> Crew:
        global _cached_crew
        if _cached_crew is None:
            _cached_crew = _build_crew()
        return _cached_crew
