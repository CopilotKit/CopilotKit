"""AG2 agent backing the Shared State (Read) demo.

Minimal ConversableAgent. The frontend demo reads a recipe state from
the agent via useAgent; for smoke verification the agent simply needs to
respond to basic chat messages.
"""

from __future__ import annotations

from autogen import ConversableAgent, LLMConfig
from autogen.ag_ui import AGUIStream
from dotenv import load_dotenv

load_dotenv()


agent = ConversableAgent(
    name="assistant",
    system_message=(
        "You are a helpful recipe assistant. When the user asks for a "
        "recipe or to improve one, respond concisely in plain text. "
        "Greet back warmly when simply greeted."
    ),
    llm_config=LLMConfig({"model": "gpt-4o-mini", "stream": True}),
    human_input_mode="NEVER",
)

stream = AGUIStream(agent)
