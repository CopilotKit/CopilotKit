"""LangGraph agent for the Declarative Generative UI (A2UI — Dynamic Schema) demo."""

from __future__ import annotations

from copilotkit import CopilotKitMiddleware
from langchain.agents import create_agent
from langchain_openai import ChatOpenAI


SYSTEM_PROMPT = (
    "You are a demo assistant for Declarative Generative UI (A2UI — Dynamic "
    "Schema). Whenever a response would benefit from a rich visual — a "
    "dashboard, status report, KPI summary, card layout, info grid, a "
    "pie/donut chart of part-of-whole breakdowns, or a bar chart comparing "
    "values across categories — call `generate_a2ui` to draw it. Keep chat "
    "replies to one short sentence and let the UI do the talking."
)


graph = create_agent(
    model=ChatOpenAI(model="gpt-5.4"),
    tools=[],
    middleware=[CopilotKitMiddleware()],
    system_prompt=SYSTEM_PROMPT,
)
