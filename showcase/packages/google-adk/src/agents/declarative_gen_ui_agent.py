"""Agent backing the Declarative Generative UI (A2UI dynamic) demo.

Re-exports the `generate_a2ui` tool defined in agents/main.py; this
secondary-LLM A2UI planner is already wired up there. The agent calls
`generate_a2ui` whenever the user's request can be served by a dashboard
component (cards, charts, lists, forms, etc.) and the runtime middleware
detects the a2ui_operations container in the tool result.
"""

from __future__ import annotations

from google.adk.agents import LlmAgent

# `agents.main` defines `generate_a2ui` — reuse it here instead of cloning.
from agents.main import generate_a2ui

_INSTRUCTION = (
    "You are a dashboard generator. Whenever the user asks for a dashboard, "
    "report, summary, or any structured visual output, call the "
    "`generate_a2ui` tool. The tool invokes a secondary LLM that designs "
    "the UI schema and data; the runtime renders the result in the chat. "
    "After the tool returns, briefly describe what you rendered."
)

declarative_gen_ui_agent = LlmAgent(
    name="DeclarativeGenUiAgent",
    model="gemini-2.5-flash",
    instruction=_INSTRUCTION,
    tools=[generate_a2ui],
)
