"""Google ADK agent backing the Shared State (Writing) demo.

The frontend page is a minimal chat surface. The agent just needs to respond
to user prompts — it doesn't need to write state in this reference cell.
"""

from __future__ import annotations

from dotenv import load_dotenv
from google.adk.agents import LlmAgent

load_dotenv()


shared_state_write_agent = LlmAgent(
    name="SharedStateWriteAgent",
    model="gemini-2.5-flash",
    instruction="You are a helpful, concise assistant.",
    tools=[],
)
