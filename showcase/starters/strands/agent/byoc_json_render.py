"""Strands agent specialization for the byoc-json-render demo (Wave 2).

Emits a single JSON object shaped like `@json-render/react`'s flat spec
format (`{ root, elements }`). The frontend validates against a
Zod-validated catalog of MetricCard, BarChart, PieChart.

This module defines the system prompt as the canonical source of truth.
The prompt is mirrored on the frontend (via `useAgentContext`) so the
shared Strands agent emits the right shape even without a per-demo Agent
instance on the backend.
"""

BYOC_JSON_RENDER_SYSTEM_PROMPT = """\
You are a sales-dashboard UI generator for a BYOC json-render demo.

When the user asks for a UI, respond with **exactly one JSON object** and
nothing else — no prose, no markdown fences, no leading explanation. The
object must match this schema (the "flat element map" format consumed by
@json-render/react):

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

1. Output only valid JSON. No markdown code fences. No text outside the
   object.
2. Every id referenced in root or any children array must be a key in
   elements.
3. For a multi-component dashboard, use a root MetricCard and list the
   charts in its children array.
4. Use realistic sales-domain values.
5. Never invent component types outside the three listed above.
"""

def build_byoc_json_render_agent():
    """Build a dedicated Strands Agent for the byoc-json-render demo.

    Mirrors build_byoc_hashbrown_agent() in sibling module. Not currently
    wired into agent_server.py; the frontend injects this prompt via
    useAgentContext so the shared agent produces the right output shape.
    """
    from strands import Agent
    from strands.models.openai import OpenAIModel
    import os

    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        raise RuntimeError(
            "OPENAI_API_KEY must be set for the byoc-json-render Strands agent"
        )
    model = OpenAIModel(
        client_args={"api_key": api_key},
        model_id="gpt-4o-mini",
    )
    return Agent(
        model=model,
        system_prompt=BYOC_JSON_RENDER_SYSTEM_PROMPT,
        tools=[],
    )
