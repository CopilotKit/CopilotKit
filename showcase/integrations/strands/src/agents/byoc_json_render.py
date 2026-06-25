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
    """Build a dedicated StrandsAgent for the byoc-json-render demo.

    Returns an ``ag_ui_strands.StrandsAgent`` wrapper (mirrors
    ``build_voice_agent`` / ``build_byoc_hashbrown_agent``) so it can be
    mounted by ``create_strands_app`` and exposed as a dedicated AG-UI
    endpoint. agent_server.py mounts it at ``/byoc-json-render`` and the
    declarative-json-render route proxies there.
    """
    # Deferred imports so this module remains importable before the
    # agent_server import-order patches run. Mirrors build_voice_agent /
    # build_byoc_hashbrown_agent: the OpenAI model is built via the shared
    # agents.agent._build_model factory.
    from strands import Agent
    from ag_ui_strands import StrandsAgent

    from agents.agent import _build_model

    strands_agent = Agent(
        model=_build_model(),
        system_prompt=BYOC_JSON_RENDER_SYSTEM_PROMPT,
        tools=[],
    )
    return StrandsAgent(
        agent=strands_agent,
        name="byoc_json_render",
        description="json-render flat-spec generator for the declarative-json-render demo.",
    )
