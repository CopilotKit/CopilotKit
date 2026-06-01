"""
Simple voice agent for Strands — no tools.

The voice demo tests transcription and basic chat, not tool execution.
Using a tool-free agent avoids the tool-call loop problem where the backend
agent executes a tool but doesn't loop back to the LLM for a text summary,
resulting in empty assistant responses in the AG-UI stream.
"""

from __future__ import annotations

from strands import Agent
from ag_ui_strands import StrandsAgent

from agents.agent import _build_model


def build_voice_agent() -> StrandsAgent:
    """Construct a simple StrandsAgent with no tools for voice demos."""
    strands_agent = Agent(
        model=_build_model(),
        system_prompt="You are a helpful, concise assistant.",
        tools=[],
    )

    return StrandsAgent(
        agent=strands_agent,
        name="voice_agent",
        description="Simple assistant for voice demo — no tools.",
    )
