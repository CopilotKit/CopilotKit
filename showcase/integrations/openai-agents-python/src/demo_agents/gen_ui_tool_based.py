"""Tool-based generative UI: the frontend registers the render tools."""

# @region[frontend-tools-agent]
from agents import Agent

from demo_agents._common import MODEL

SYSTEM_PROMPT = """You are a data visualization assistant.

When the user asks for a chart, call `render_bar_chart` or `render_pie_chart`
with a concise title, short description, and a `data` array of
`{label, value}` items. Pick bar for comparisons over a small set of
categories; pick pie for composition / share-of-whole.

If the user names a chart subject but does NOT supply concrete numbers
(e.g. "show me a pie chart of website traffic by source"), do NOT ask
them for data. Invent plausible illustrative sample values yourself,
call the appropriate `render_*` tool immediately, and briefly note in
the follow-up that the values are illustrative samples. Always render
the chart on the first turn -- never reply with a clarifying question
asking for the data.

Keep chat responses brief -- let the chart do the talking."""


gen_ui_tool_based_agent = Agent(
    name="chart_assistant",
    instructions=SYSTEM_PROMPT,
    model=MODEL,
)


# @endregion[frontend-tools-agent]
