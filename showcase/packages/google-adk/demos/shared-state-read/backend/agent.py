"""Google ADK agent backing the Shared State (Reading) demo.

The frontend syncs a recipe object into agent state via `useAgent` and the
agent reads/responds to edits. This reference cell keeps the agent minimal —
it receives the recipe in session state and answers conversationally.
"""

from __future__ import annotations

from dotenv import load_dotenv
from google.adk.agents import LlmAgent

load_dotenv()


shared_state_read_agent = LlmAgent(
    name="SharedStateReadAgent",
    model="gemini-2.5-flash",
    instruction=(
        "You are a helpful recipe assistant. The user may ask you to modify "
        "or improve a recipe. Respond conversationally with suggestions."
    ),
    tools=[],
)
