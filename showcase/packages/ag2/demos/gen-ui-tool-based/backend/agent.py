"""AG2 agent backing the Tool-Based Generative UI (Haiku) demo.

The agent's role is to call the frontend-registered generate_haiku tool
with japanese, english, image_name, and gradient fields. The frontend
renders the resulting haiku as a card via useFrontendTool's render.
Since generate_haiku is registered frontend-side, the backend has no
functions of its own — the tool description reaches the model via
the AG-UI bridge.
"""

from __future__ import annotations

from autogen import ConversableAgent, LLMConfig
from autogen.ag_ui import AGUIStream
from dotenv import load_dotenv

load_dotenv()


agent = ConversableAgent(
    name="assistant",
    system_message=(
        "You are a creative Haiku generator. When the user asks for a "
        "haiku, call the generate_haiku tool with three-line arrays "
        "'japanese' (3 lines in Japanese) and 'english' (3 lines in "
        "English), an 'image_name' from the supplied list, and a CSS "
        "'gradient' string for the card background. Always call the "
        "tool rather than replying in plain text."
    ),
    llm_config=LLMConfig({"model": "gpt-4o-mini", "stream": True}),
    human_input_mode="NEVER",
)

stream = AGUIStream(agent)
