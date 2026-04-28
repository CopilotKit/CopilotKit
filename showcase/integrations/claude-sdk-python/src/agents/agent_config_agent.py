"""Claude Agent SDK backing the Agent Config Object demo.

Reads three forwarded properties — tone, expertise, responseLength — from
the AG-UI run's ``forwarded_props`` (which the dedicated runtime route at
``/api/copilotkit-agent-config`` repacks from the CopilotKit provider's
``properties`` prop) and builds the system prompt dynamically per turn.

The companion Next.js route
(``src/app/api/copilotkit-agent-config/route.ts``) ensures the frontend's
``<CopilotKitProvider properties={{tone, expertise, responseLength}}>``
values reach the AG-UI ``forwardedProps`` field on the request body, from
which this backend reads them.

Unlike the langgraph-python reference — which routes through
``RunnableConfig["configurable"]["properties"]`` inside a LangGraph node
— Claude Agent SDK here reads the values directly off the AG-UI run
input's ``forwardedProps`` / ``forwarded_props`` envelope before
constructing the system prompt.
"""

from __future__ import annotations

from typing import Any, Literal

Tone = Literal["professional", "casual", "enthusiastic"]
Expertise = Literal["beginner", "intermediate", "expert"]
ResponseLength = Literal["concise", "detailed"]

DEFAULT_TONE: Tone = "professional"
DEFAULT_EXPERTISE: Expertise = "intermediate"
DEFAULT_RESPONSE_LENGTH: ResponseLength = "concise"

VALID_TONES: set[str] = {"professional", "casual", "enthusiastic"}
VALID_EXPERTISE: set[str] = {"beginner", "intermediate", "expert"}
VALID_RESPONSE_LENGTHS: set[str] = {"concise", "detailed"}


def read_properties(forwarded_props: Any) -> dict[str, str]:
    """Read the three config axes with defensive defaults.

    ``forwarded_props`` may arrive as either the raw top-level dict (when
    the Next.js route forwards provider ``properties`` straight through)
    or nested under ``config.configurable.properties`` (the LangGraph
    convention the shared runtime route adopts for compatibility). We
    accept both shapes — unknown values fall back to the defaults; the
    function never raises.
    """
    if not isinstance(forwarded_props, dict):
        forwarded_props = {}

    # Prefer the nested shape (mirrors the langgraph-python convention
    # the dedicated route repacks into) but fall back to top-level keys
    # so the demo still works if a caller forwards properties directly.
    nested = (
        (forwarded_props.get("config") or {}).get("configurable") or {}
    ).get("properties") or {}
    props = nested if isinstance(nested, dict) and nested else forwarded_props

    tone = props.get("tone", DEFAULT_TONE)
    expertise = props.get("expertise", DEFAULT_EXPERTISE)
    response_length = props.get("responseLength", DEFAULT_RESPONSE_LENGTH)

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


def build_system_prompt(tone: str, expertise: str, response_length: str) -> str:
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


__all__ = [
    "DEFAULT_TONE",
    "DEFAULT_EXPERTISE",
    "DEFAULT_RESPONSE_LENGTH",
    "VALID_TONES",
    "VALID_EXPERTISE",
    "VALID_RESPONSE_LENGTHS",
    "read_properties",
    "build_system_prompt",
]
