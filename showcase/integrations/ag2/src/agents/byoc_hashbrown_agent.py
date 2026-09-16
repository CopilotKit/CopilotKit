"""AG2 agent backing the byoc-hashbrown demo.

Emits hashbrown-shaped structured output that the ported HashBrownDashboard
renderer (`src/app/demos/byoc-hashbrown/hashbrown-renderer.tsx`) progressively
parses via `@hashbrownai/react`'s `useJsonParser` + `useUiKit`.

Wire format
-----------
A single JSON object literal of the form:

    {
      "ui": [
        { "metric":   { "props": { "label": "...", "value": "..." } } },
        { "pieChart": { "props": { "title": "...", "data": "[{...}]" } } },
        { "barChart": { "props": { "title": "...", "data": "[{...}]" } } },
        { "dealCard": { "props": { "title": "...", "stage": "prospect", "value": 100000 } } },
        { "Markdown": { "props": { "children": "## heading\\nbody" } } }
      ]
    }

Every node is a single-key object `{tagName: {props: {...}}}`. `pieChart` and
`barChart` receive `data` as a JSON-encoded string (kept stable under partial
streaming).
"""

from ag2 import Agent
from ag2.ag_ui import AGUIStream
from ag2.config import OpenAIConfig
from fastapi import FastAPI


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
  chart — do not refuse for lack of data.
- Prefer 3-6 rows of data in charts; keep labels short.
- Use "Markdown" for short headings or linking sentences between visual
  components. Do not emit long prose.
- Do not emit components that are not listed above.
- `data` props on charts MUST be a JSON STRING — escape inner quotes.

Example response (sales dashboard):
{"ui":[{"Markdown":{"props":{"children":"## Q4 Sales Summary"}}},{"metric":{"props":{"label":"Total Revenue","value":"$1.2M"}}},{"metric":{"props":{"label":"New Customers","value":"248"}}},{"pieChart":{"props":{"title":"Revenue by Segment","data":"[{\\"label\\":\\"Enterprise\\",\\"value\\":600000},{\\"label\\":\\"SMB\\",\\"value\\":400000},{\\"label\\":\\"Startup\\",\\"value\\":200000}]"}}},{"barChart":{"props":{"title":"Monthly Revenue","data":"[{\\"label\\":\\"Oct\\",\\"value\\":350000},{\\"label\\":\\"Nov\\",\\"value\\":400000},{\\"label\\":\\"Dec\\",\\"value\\":450000}]"}}}]}
"""


byoc_hashbrown_agent = Agent(
    name="byoc_hashbrown_assistant",
    prompt=BYOC_HASHBROWN_SYSTEM_PROMPT,
    config=OpenAIConfig(
        model="gpt-4o-mini",
        streaming=True,
        # OpenAIConfig has no first-class response_format field; extra_body is
        # merged into the Chat Completions request, preserving JSON mode.
        extra_body={"response_format": {"type": "json_object"}},
    ),
    tools=[],
)

byoc_hashbrown_stream = AGUIStream(byoc_hashbrown_agent)

byoc_hashbrown_app = FastAPI()
byoc_hashbrown_app.mount("/", byoc_hashbrown_stream.build_asgi())
