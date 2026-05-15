"""
Simple voice agent for MS Agent Framework — no tools.

The voice demo tests transcription and basic chat, not tool execution.
Using a tool-free agent avoids the tool-call loop problem where the backend
agent executes a tool but doesn't loop back to the LLM for a text summary,
resulting in empty assistant responses in the AG-UI stream.
"""

from __future__ import annotations

from agent_framework import Agent, BaseChatClient
from agent_framework_ag_ui import AgentFrameworkAgent


def create_voice_agent(chat_client: BaseChatClient) -> AgentFrameworkAgent:
    """Instantiate a simple voice demo agent with no tools."""
    base_agent = Agent(
        client=chat_client,
        name="voice_agent",
        instructions="You are a helpful, concise assistant.",
        tools=[],
    )

    return AgentFrameworkAgent(
        agent=base_agent,
        name="VoiceDemoAgent",
        description="Simple assistant for voice demo — no tools.",
        require_confirmation=False,
    )
