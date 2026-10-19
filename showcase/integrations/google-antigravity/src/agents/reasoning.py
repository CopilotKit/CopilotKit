"""Reasoning demos: same neutral prompt as the reference, on a reasoning model."""

from agents._common import REASONING_MODEL, build

SYSTEM_PROMPT = (
    "You are a helpful assistant. For each user question, first think "
    "step-by-step about the approach, then give a concise answer."
)


def reasoning_agent():
    return build(system_instructions=SYSTEM_PROMPT, model=REASONING_MODEL)
