"""Google ADK agent backing the Agentic Generative UI demo.

The frontend subscribes to agent state via `useAgent` and renders a task
progress card whenever `state.steps` is populated. This reference cell keeps
the agent minimal — a real implementation would stream step updates through
ADK's state channel.
"""

from __future__ import annotations

from dotenv import load_dotenv
from google.adk.agents import LlmAgent

load_dotenv()


gen_ui_agent_agent = LlmAgent(
    name="GenUiAgent",
    model="gemini-2.5-flash",
    instruction=(
        "You are a planning assistant. When asked to build a plan, respond "
        "with a numbered list of concrete steps. Keep replies focused and "
        "under 10 steps unless the user asks for more."
    ),
    tools=[],
)
