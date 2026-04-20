"""Google ADK agent backing the State Streaming demo.

This reference cell keeps the agent minimal — a basic chat responder. A full
implementation would stream incremental state deltas through ADK's state
channel as the agent produces structured output.
"""

from __future__ import annotations

from dotenv import load_dotenv
from google.adk.agents import LlmAgent

load_dotenv()


shared_state_streaming_agent = LlmAgent(
    name="SharedStateStreamingAgent",
    model="gemini-2.5-flash",
    instruction="You are a helpful, concise assistant.",
    tools=[],
)
