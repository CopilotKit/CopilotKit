"""LlamaIndex agent backing the Agent Config Object demo.

Mirrors `langgraph-python/src/agents/agent_config_agent.py`. The LangGraph
original reads three forwarded properties — `tone`, `expertise`,
`responseLength` — from the run's `RunnableConfig.configurable.properties`
and composes the system prompt dynamically per turn.

`get_ag_ui_workflow_router` does not expose the same `RunnableConfig` hook
surface, so the LlamaIndex port applies the default profile at startup and
exposes the same three-axis prompt composition for parity. The frontend
provider wiring (`<CopilotKitProvider properties={{ tone, ... }}>`) still
demonstrates the client-side API — the forwarded props are visible in the
run payload even if the current router does not yet recompose the prompt
per turn. Extending the router to read forwarded props is tracked as a
TODO in the package-level PARITY_NOTES.
"""

from __future__ import annotations

from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router

DEFAULT_TONE = "professional"
DEFAULT_EXPERTISE = "intermediate"
DEFAULT_RESPONSE_LENGTH = "concise"

TONE_RULES = {
    "professional": "Use neutral, precise language. No emoji. Short sentences.",
    "casual": "Use friendly, conversational language. Contractions OK. Light humor welcome.",
    "enthusiastic": "Use upbeat, energetic language. Exclamation points OK. Emoji OK.",
}
EXPERTISE_RULES = {
    "beginner": "Assume no prior knowledge. Define jargon. Use analogies.",
    "intermediate": "Assume common terms are understood; explain specialized terms.",
    "expert": "Assume technical fluency. Use precise terminology. Skip basics.",
}
LENGTH_RULES = {
    "concise": "Respond in 1-3 sentences.",
    "detailed": "Respond in multiple paragraphs with examples where relevant.",
}

def build_system_prompt(tone: str, expertise: str, response_length: str) -> str:
    return (
        "You are a helpful assistant.\n\n"
        f"Tone: {TONE_RULES[tone]}\n"
        f"Expertise level: {EXPERTISE_RULES[expertise]}\n"
        f"Response length: {LENGTH_RULES[response_length]}"
    )

DEFAULT_SYSTEM_PROMPT = build_system_prompt(
    DEFAULT_TONE, DEFAULT_EXPERTISE, DEFAULT_RESPONSE_LENGTH
)

agent_config_router = get_ag_ui_workflow_router(
    llm=OpenAI(model="gpt-4o-mini", temperature=0.4),
    frontend_tools=[],
    backend_tools=[],
    system_prompt=DEFAULT_SYSTEM_PROMPT,
    initial_state={},
)
