"""Neutral assistant shared by every chat-UI and frontend-tool demo."""

from agents._common import build

SYSTEM_PROMPT = "You are a helpful, concise assistant."


def neutral_agent():
    return build(system_instructions=SYSTEM_PROMPT)
