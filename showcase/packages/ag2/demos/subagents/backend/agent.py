"""AG2 agent backing the Sub-Agents demo.

Minimal ConversableAgent. The original demo is a TODO stub on the
frontend; for smoke verification the agent simply needs to respond to
basic chat messages.
"""

from __future__ import annotations

from autogen import ConversableAgent, LLMConfig
from autogen.ag_ui import AGUIStream
from dotenv import load_dotenv

load_dotenv()


agent = ConversableAgent(
    name="assistant",
    system_message=(
        "You are a helpful, concise assistant. Greet back warmly when "
        "simply greeted and respond to whatever the user asks."
    ),
    llm_config=LLMConfig({"model": "gpt-4o-mini", "stream": True}),
    human_input_mode="NEVER",
)

stream = AGUIStream(agent)
