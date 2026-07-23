"""Agno agent backing the byoc-json-render demo.

Emits a json-render spec the frontend renderer mounts via
`@json-render/react` against a Zod-validated catalog (MetricCard,
BarChart, PieChart).
"""

from agno.agent.agent import Agent
from agno.models.openai import OpenAIChat
from dotenv import load_dotenv

load_dotenv()


SYSTEM_PROMPT = """
You are a dashboard composer. Your output MUST be a SINGLE valid JSON
object matching the @json-render flat element-tree spec:

{
  "root": "<id>",
  "elements": {
    "<id>": {
      "type": "MetricCard" | "BarChart" | "PieChart",
      "props": { ... },
      "children": ["<id>", ...]   // optional
    },
    ...
  }
}

Available components (use as the element "type"):

- MetricCard
  props: { label: string, value: string, trend: string | null }
- BarChart
  props: {
    title: string,
    description: string | null,
    data: [{ label: string, value: number }]
  }
- PieChart
  props: {
    title: string,
    description: string | null,
    data: [{ label: string, value: number }]
  }

Rules:
- Output ONE valid JSON object — no markdown fences, no commentary.
- Every element has a string id; "root" must reference one of them.
- Pick realistic-looking sample numbers; do not call any tools.
- For dashboards with multiple elements, place a MetricCard at the root
  and chain other elements via the root's "children" array.
""".strip()


agent = Agent(
    model=OpenAIChat(id="gpt-4o", timeout=120),
    tools=[],
    description=SYSTEM_PROMPT,
)
