"""PydanticAI agent backing the Agent Config Object demo.

Reads three forwarded properties — tone, expertise, responseLength —
from the AG-UI run's ``context`` (populated by the TS runtime route)
and builds its system prompt dynamically per turn.

PydanticAI-specific wiring
--------------------------
The CopilotKit provider's ``properties`` prop is forwarded by the runtime
as ``forwardedProps`` on each AG-UI run. PydanticAI's ``agent.to_ag_ui()``
bridge surfaces that via ``ctx.deps.copilotkit.context`` when the runtime
route repacks it (see ``src/app/api/copilotkit-agent-config/route.ts``)
— the TS route appends a synthetic ``agent-config-properties`` context
entry whose JSON payload carries the three properties.

A ``@agent.system_prompt`` dynamic prompt reads that context entry at
call-time and composes the system prompt from the three axes. When the
context entry is missing (or contains an unknown value), we fall back to
the ``DEFAULT_*`` constants — same defensive behaviour as the
langgraph-python reference.
"""

from __future__ import annotations

import json
from typing import Any, Literal

from pydantic import BaseModel
from pydantic_ai import Agent, RunContext
from pydantic_ai.ag_ui import StateDeps
from pydantic_ai.models.openai import OpenAIResponsesModel

class AgentConfigState(BaseModel):
    """Agent-config demo carries no shared state — the provider properties
    ride on ``context`` instead."""

Tone = Literal["professional", "casual", "enthusiastic"]
Expertise = Literal["beginner", "intermediate", "expert"]
ResponseLength = Literal["concise", "detailed"]

DEFAULT_TONE: Tone = "professional"
DEFAULT_EXPERTISE: Expertise = "intermediate"
DEFAULT_RESPONSE_LENGTH: ResponseLength = "concise"

VALID_TONES: set[str] = {"professional", "casual", "enthusiastic"}
VALID_EXPERTISE: set[str] = {"beginner", "intermediate", "expert"}
VALID_RESPONSE_LENGTHS: set[str] = {"concise", "detailed"}

PROPERTIES_CONTEXT_DESCRIPTION = "agent-config-properties"

def _read_properties_from_context(ctx: RunContext[StateDeps[AgentConfigState]]) -> dict[str, str]:
    """Read the forwarded ``properties`` object with defensive defaults.

    The TS runtime route at ``copilotkit-agent-config/route.ts`` appends a
    context entry with ``description == "agent-config-properties"`` and a
    JSON payload containing ``{tone, expertise, responseLength}``. Any
    missing or unrecognized value falls back to the corresponding
    ``DEFAULT_*`` constant. The function never raises.
    """
    copilotkit_state = getattr(ctx.deps, "copilotkit", None)
    context_entries: list[Any] = []
    if copilotkit_state and hasattr(copilotkit_state, "context"):
        context_entries = copilotkit_state.context or []

    payload: dict[str, Any] = {}
    for entry in context_entries:
        if not isinstance(entry, dict):
            continue
        if entry.get("description") != PROPERTIES_CONTEXT_DESCRIPTION:
            continue
        raw_value = entry.get("value")
        if isinstance(raw_value, dict):
            payload = raw_value
        elif isinstance(raw_value, str):
            try:
                parsed = json.loads(raw_value)
                if isinstance(parsed, dict):
                    payload = parsed
            except json.JSONDecodeError:
                continue
        if payload:
            break

    tone = payload.get("tone", DEFAULT_TONE)
    expertise = payload.get("expertise", DEFAULT_EXPERTISE)
    response_length = payload.get("responseLength", DEFAULT_RESPONSE_LENGTH)

    if tone not in VALID_TONES:
        tone = DEFAULT_TONE
    if expertise not in VALID_EXPERTISE:
        expertise = DEFAULT_EXPERTISE
    if response_length not in VALID_RESPONSE_LENGTHS:
        response_length = DEFAULT_RESPONSE_LENGTH

    return {
        "tone": tone,
        "expertise": expertise,
        "response_length": response_length,
    }

def _build_system_prompt(tone: str, expertise: str, response_length: str) -> str:
    """Compose the system prompt from the three axes."""
    tone_rules = {
        "professional": (
            "Use neutral, precise language. No emoji. Short sentences."
        ),
        "casual": (
            "Use friendly, conversational language. Contractions OK. "
            "Light humor welcome."
        ),
        "enthusiastic": (
            "Use upbeat, energetic language. Exclamation points OK. Emoji OK."
        ),
    }
    expertise_rules = {
        "beginner": "Assume no prior knowledge. Define jargon. Use analogies.",
        "intermediate": (
            "Assume common terms are understood; explain specialized terms."
        ),
        "expert": (
            "Assume technical fluency. Use precise terminology. Skip basics."
        ),
    }
    length_rules = {
        "concise": "Respond in 1-3 sentences.",
        "detailed": (
            "Respond in multiple paragraphs with examples where relevant."
        ),
    }
    return (
        "You are a helpful assistant.\n\n"
        f"Tone: {tone_rules[tone]}\n"
        f"Expertise level: {expertise_rules[expertise]}\n"
        f"Response length: {length_rules[response_length]}"
    )

agent = Agent(
    model=OpenAIResponsesModel("gpt-4o-mini"),
    deps_type=StateDeps[AgentConfigState],
)

@agent.system_prompt
def build_prompt(ctx: RunContext[StateDeps[AgentConfigState]]) -> str:
    props = _read_properties_from_context(ctx)
    return _build_system_prompt(
        props["tone"], props["expertise"], props["response_length"]
    )

__all__ = ["AgentConfigState", "agent"]
