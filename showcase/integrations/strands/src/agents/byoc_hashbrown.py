"""Strands agent specialization for the byoc-hashbrown demo (Wave 2).

The Strands showcase (as documented in `PARITY_NOTES.md`) historically ships
a single shared Strands agent (`src/agents/agent.py`) registered under many
AG-UI agent names. The byoc-hashbrown demo additionally requires the LLM to
emit a strict **hashbrown JSON envelope** (NOT XML) that
`@hashbrownai/react`'s `useJsonParser` + `useUiKit` can progressively parse.

Wire format
-----------
The renderer (`src/app/demos/byoc-hashbrown/hashbrown-renderer.tsx`) consumes
a JSON object shaped like the hashbrown schema itself — not the XML example
DSL used inside `useUiKit({ examples })`. Because this demo drives the LLM
via a Strands Agent (not via hashbrown's own `useUiChat`), we must emit the
raw schema wire format:

    {
      "ui": [
        { "metric":   { "props": { "label": "...", "value": "..." } } },
        { "pieChart": { "props": { "title": "...", "data": "[{...}]" } } },
        { "barChart": { "props": { "title": "...", "data": "[{...}]" } } },
        { "dealCard": { "props": { "title": "...", "stage": "prospect", "value": 100000 } } },
        { "Markdown": { "props": { "children": "## heading\\nbody" } } }
      ]
    }

Every node is a single-key object `{tagName: {props: {...}}}`. The tag names
and prop schemas match `useSalesDashboardKit()` in `hashbrown-renderer.tsx`.
`pieChart` / `barChart` receive `data` as a JSON-encoded string (kept as a
string so the schema is stable under partial streaming).
"""

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

Available components and their prop schemas:

- "metric": { "props": { "label": string, "value": string } }
    A KPI card. `value` is a pre-formatted string like "$1.2M" or "248".

- "pieChart": { "props": { "title": string, "data": string } }
    A donut chart. `data` is a JSON-encoded STRING (embedded JSON) of an
    array of {label, value} objects with at least 3 segments.

- "barChart": { "props": { "title": string, "data": string } }
    A vertical bar chart. `data` is a JSON-encoded STRING of an array of
    {label, value} objects with at least 3 bars, typically time-ordered.

- "dealCard": { "props": { "title": string, "stage": string, "value": number } }
    A single sales deal. `stage` MUST be one of: "prospect", "qualified",
    "proposal", "negotiation", "closed-won", "closed-lost". `value` is a
    raw number (no currency symbol or comma).

- "Markdown": { "props": { "children": string } }
    Short explanatory text. Use for section headings and brief summaries.

Rules:
- Always produce plausible sample data when the user asks for a dashboard or
  chart -- do not refuse for lack of data.
- Prefer 3-6 rows of data in charts; keep labels short.
- Do not emit components that are not listed above.
- `data` props on charts MUST be a JSON STRING -- escape inner quotes.
"""


def build_byoc_hashbrown_agent():
    """Build a StrandsAgent configured with the byoc-hashbrown system prompt.

    Returns an ``ag_ui_strands.StrandsAgent`` wrapper (mirrors
    ``build_voice_agent``) so it can be mounted by ``create_strands_app`` and
    exposed as a dedicated AG-UI endpoint. agent_server.py mounts it at
    ``/byoc-hashbrown`` and the declarative-hashbrown route proxies there.
    The agent takes no tools; it is a pure structured-output generator.
    """
    # Deferred imports so this module remains importable even when the
    # agent_server import-order patches (see agent_server.py) haven't been
    # applied yet. Mirrors build_voice_agent: ``from strands import Agent``
    # plus the ag_ui_strands wrapper. The OpenAI model is built via the
    # shared agents.agent._build_model factory so we don't re-resolve the
    # ``strands.models.openai`` submodule independently.
    from strands import Agent
    from ag_ui_strands import StrandsAgent

    from agents.agent import _build_model

    strands_agent = Agent(
        model=_build_model(),
        system_prompt=BYOC_HASHBROWN_SYSTEM_PROMPT,
        tools=[],
    )
    return StrandsAgent(
        agent=strands_agent,
        name="byoc_hashbrown",
        description="Hashbrown UI-kit envelope generator for the declarative-hashbrown demo.",
    )
