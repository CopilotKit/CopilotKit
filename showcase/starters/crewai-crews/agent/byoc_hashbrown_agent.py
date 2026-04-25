"""Dedicated crew for the BYOC (Hashbrown) demo.

Mirrors the langgraph-python reference (origin/main:
src/agents/byoc_hashbrown_agent.py) with CrewAI plumbing:

- Emits a single JSON object matching the hashbrown wire format so the
  frontend's `@hashbrownai/react` `useJsonParser(content, kit.schema)` can
  progressively assemble the UI as tokens stream in.
- Wire format is the schema shape (NOT the XML `<ui>...</ui>` DSL — that DSL
  is what hashbrown compiles into schema documentation when hashbrown itself
  is driving the LLM; because we drive via CrewAI we must emit the raw
  schema shape directly):

      {
        "ui": [
          { "metric":   { "props": { ... } } },
          { "pieChart": { "props": { "title": "...", "data": "[{...}]" } } },
          { "barChart": { "props": { ... } } },
          { "dealCard": { "props": { ... } } },
          { "Markdown": { "props": { "children": "..." } } }
        ]
      }

  `pieChart` and `barChart` receive `data` as a JSON-encoded STRING so the
  schema stays stable under partial streaming.

CrewAI caveat: `ChatWithCrewFlow.build_system_message` wraps the crew
description in fixed "CrewAI platform" boilerplate that actively fights
against pure-JSON output (it tells the LLM to introduce itself, ask for
clarifying inputs, etc.). We install a custom full system message via
`install_custom_system_message` which patches `ChatWithCrewFlow.__init__`
to stash our message onto the instance after construction. The crew itself
has a trivial single-agent body — the chat LLM's behavior is driven
entirely by the custom system message.
"""

from __future__ import annotations

from crewai import Agent, Crew, Process, Task

from ._chat_flow_helpers import (
    install_custom_system_message,
    preseed_system_prompt,
)

CREW_NAME = "ByocHashbrown"

BYOC_HASHBROWN_SYSTEM_PROMPT = """\
You are a sales analytics assistant that replies by emitting a single JSON
object consumed by a streaming JSON parser on the frontend.

ALWAYS respond with a single JSON object of the form:

{
  "ui": [
    { <componentName>: { "props": { ... } } },
    ...
  ]
}

Do NOT wrap the response in code fences. Do NOT include any preface or
explanation outside the JSON object. The response MUST be valid JSON.
Do NOT call any tools. Do NOT ask for clarifying inputs. Emit the JSON
directly as your entire message content.

Available components and their prop schemas:

- "metric": { "props": { "label": string, "value": string } }
    A KPI card. `value` is a pre-formatted string like "$1.2M" or "248".

- "pieChart": { "props": { "title": string, "data": string } }
    A donut chart. `data` is a JSON-encoded STRING (embedded JSON) of an
    array of {label, value} objects with at least 3 segments, e.g.
    "data": "[{\\"label\\":\\"Enterprise\\",\\"value\\":600000}]".

- "barChart": { "props": { "title": string, "data": string } }
    A vertical bar chart. `data` is a JSON-encoded STRING of an array of
    {label, value} objects with at least 3 bars, typically time-ordered.

- "dealCard": { "props": { "title": string, "stage": string, "value": number } }
    A single sales deal. `stage` MUST be one of: "prospect", "qualified",
    "proposal", "negotiation", "closed-won", "closed-lost". `value` is a
    raw number (no currency symbol or comma).

- "Markdown": { "props": { "children": string } }
    Short explanatory text. Use for section headings and brief summaries.
    Standard markdown is supported in `children`.

Rules:
- Always produce plausible sample data when the user asks for a dashboard or
  chart - do not refuse for lack of data.
- Prefer 3-6 rows of data in charts; keep labels short.
- Use "Markdown" for short headings or linking sentences between visual
  components. Do not emit long prose.
- Do not emit components that are not listed above.
- `data` props on charts MUST be a JSON STRING - escape inner quotes.

Example response (sales dashboard):
{"ui":[{"Markdown":{"props":{"children":"## Q4 Sales Summary"}}},{"metric":{"props":{"label":"Total Revenue","value":"$1.2M"}}},{"metric":{"props":{"label":"New Customers","value":"248"}}},{"pieChart":{"props":{"title":"Revenue by Segment","data":"[{\\"label\\":\\"Enterprise\\",\\"value\\":600000},{\\"label\\":\\"SMB\\",\\"value\\":400000},{\\"label\\":\\"Startup\\",\\"value\\":200000}]"}}},{"barChart":{"props":{"title":"Monthly Revenue","data":"[{\\"label\\":\\"Oct\\",\\"value\\":350000},{\\"label\\":\\"Nov\\",\\"value\\":400000},{\\"label\\":\\"Dec\\",\\"value\\":450000}]"}}}]}
"""

# Pre-seed + install hard-override so the chat_llm sees ONLY the JSON
# system prompt, not the CrewAI "Hey I'm here to help you with..."
# boilerplate.
preseed_system_prompt(CREW_NAME, BYOC_HASHBROWN_SYSTEM_PROMPT)
install_custom_system_message(CREW_NAME, BYOC_HASHBROWN_SYSTEM_PROMPT)

def _build_crew() -> Crew:
    """Minimal single-agent crew.

    The agent body is only here because `ChatWithCrewFlow` requires a crew
    with at least one agent + task to wire up the platform boilerplate. The
    actual chat behavior comes from `install_custom_system_message` which
    overrides the system message passed to the chat LLM at request time.
    """
    agent = Agent(
        role="Hashbrown JSON Emitter",
        goal="Emit hashbrown-shaped JSON responses.",
        backstory=BYOC_HASHBROWN_SYSTEM_PROMPT,
        verbose=False,
        tools=[],
    )

    task = Task(
        description="Respond with a single hashbrown-shaped JSON object.",
        expected_output="A JSON object matching the hashbrown schema.",
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

class ByocHashbrown:
    """Adapter matching `add_crewai_crew_fastapi_endpoint` shape."""

    name: str = CREW_NAME

    def crew(self) -> Crew:
        global _cached_crew
        if _cached_crew is None:
            _cached_crew = _build_crew()
        return _cached_crew
