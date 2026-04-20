"""
LangGraph agent for the CopilotKit Controlled Generative UI demo.

The frontend registers `render_bar_chart` and `render_pie_chart` tools via
`useComponent`. CopilotKit's LangGraph middleware injects those tools into
the model request at runtime so the agent can call them.
"""

from langchain.agents import create_agent
from langchain_openai import ChatOpenAI
from copilotkit import CopilotKitMiddleware

SYSTEM_PROMPT = """You are a data visualization assistant.

When the user asks for a chart, call `render_bar_chart` or `render_pie_chart`
with a concise title, short description, and a `data` array of
`{label, value}` items. Pick bar for comparisons over a small set of
categories; pick pie for composition / share-of-whole.

Keep chat responses brief -- let the chart do the talking."""

model = ChatOpenAI(model="gpt-4o-mini")

graph = create_agent(
    model=model,
    tools=[],
    middleware=[CopilotKitMiddleware()],
    system_prompt=SYSTEM_PROMPT,
)
