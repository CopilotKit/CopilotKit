"""PydanticAI agent backing the Tool-Based Generative UI demo.

Mirrors showcase/integrations/langgraph-python/src/agents/gen_ui_tool_based.py.

The frontend registers `render_bar_chart` and `render_pie_chart` tools via
`useComponent`. CopilotKit's runtime injects those tool definitions into the
agent request at runtime, so the agent does not need to declare them locally —
PydanticAI's AG-UI bridge surfaces frontend-registered tools to the model on
each run, and the model decides when to call them.
"""

from __future__ import annotations

from textwrap import dedent

from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIResponsesModel


SYSTEM_PROMPT = dedent(
    """
    You are a data visualization assistant.

    When the user asks for a chart, call `render_bar_chart` or
    `render_pie_chart` with a concise title, short description, and a
    `data` array of `{label, value}` items. Pick bar for comparisons over
    a small set of categories; pick pie for composition / share-of-whole.

    Keep chat responses brief — let the chart do the talking.
    """
).strip()


agent = Agent(
    model=OpenAIResponsesModel("gpt-4.1-mini"),
    system_prompt=SYSTEM_PROMPT,
)
