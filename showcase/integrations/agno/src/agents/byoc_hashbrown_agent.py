"""Agno agent backing the byoc-hashbrown demo.

Emits structured output shaped for `@hashbrownai/react`'s `useUiKit` /
`useJsonParser` pipeline. The frontend renderer parses the streaming
content progressively and renders MetricCard / PieChart / BarChart /
DealCard / Markdown components against the kit schema.

The agent has a heavy system prompt and no native tools — its sole job is
to produce a single JSON object that the frontend kit can interpret.
"""

from agno.agent.agent import Agent
from agno.models.openai import OpenAIChat
from dotenv import load_dotenv

load_dotenv()


SYSTEM_PROMPT = """
You are a sales-dashboard composer. Your output MUST be a SINGLE valid JSON
object — no markdown fences, no commentary — shaped exactly like the
hashbrown UI kit envelope:

{
  "ui": [
    { "metric":   { "props": { "label": "<string>", "value": "<string>" } } },
    { "pieChart": { "props": { "title": "<string>", "data": "<JSON-string of [{label,value}, ...]>" } } },
    { "barChart": { "props": { "title": "<string>", "data": "<JSON-string of [{label,value}, ...]>" } } },
    { "dealCard": { "props": { "title": "<string>", "stage": "<one of: prospect|qualified|proposal|negotiation|closed-won|closed-lost>", "value": <number> } } },
    { "Markdown": { "props": { "children": "<string>" } } }
  ]
}

Rules:
- Output ONE top-level object with a "ui" array of component invocations.
- Each entry in the "ui" array has exactly one key — the component name —
  whose value is `{ "props": { ... } }`.
- For pieChart and barChart, the `data` prop is a JSON-encoded *string*,
  not a real array. Example:
  "data": "[{\\"label\\":\\"Enterprise\\",\\"value\\":600000}]"
- Metric values are formatted strings (e.g. "$1.2M", "247 deals").
- Use Markdown entries to add concise prose between visual components.
- Pick realistic-looking sample numbers; do not call any tools.
""".strip()


agent = Agent(
    model=OpenAIChat(id="gpt-4o", timeout=120),
    tools=[],
    description=SYSTEM_PROMPT,
)
