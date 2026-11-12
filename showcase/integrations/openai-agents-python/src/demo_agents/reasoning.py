"""Reasoning demos: the neutral prompt on a model that streams reasoning summaries.

``reasoning_settings()`` asks the Responses API for a reasoning summary; the
adapter streams it as REASONING_* events, which the chat renders as the
reasoning card.
"""

from agents import Agent

from demo_agents._common import REASONING_MODEL, reasoning_settings

SYSTEM_PROMPT = (
    "You are a helpful assistant. For each user question, first think "
    "step-by-step about the approach, then give a concise answer."
)


reasoning_agent = Agent(
    name="reasoning_assistant",
    instructions=SYSTEM_PROMPT,
    model=REASONING_MODEL,
    model_settings=reasoning_settings(),
)
