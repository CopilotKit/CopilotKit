"""Agent backing the Tool-Based Generative UI demo.

The frontend registers `render_bar_chart` and `render_pie_chart` tools via
`useComponent`. The ADKAgent middleware injects those tools into the model
request at runtime so the agent can call them.
"""

from __future__ import annotations

from google.adk.agents import LlmAgent
from ag_ui_adk import AGUIToolset

from agents.shared_chat import get_model, stop_on_terminal_text

_INSTRUCTION = (
    "You are a data visualization assistant.\n\n"
    "When the user asks for a chart, call `render_bar_chart` or "
    "`render_pie_chart` with a concise title, short description, and a "
    "`data` array of `{label, value}` items. Pick bar for comparisons over "
    "a small set of categories; pick pie for composition / share-of-whole.\n\n"
    "Keep chat responses brief -- let the chart do the talking."
)

gen_ui_tool_based_agent = LlmAgent(
    name="GenUiToolBasedAgent",
    model=get_model(),
    instruction=_INSTRUCTION,
    tools=[AGUIToolset()],
    after_model_callback=stop_on_terminal_text,
)
