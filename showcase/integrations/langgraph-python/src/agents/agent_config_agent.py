"""LangGraph agent backing the Agent Config Object demo.

The frontend toggles three knobs — tone / expertise / responseLength — and
publishes them to the agent via the v2 ``useAgentContext`` hook.  The
``CopilotKitMiddleware`` injects those values into the model's prompt on
every turn, so the same single static system prompt below adapts its style
based on whatever the frontend currently has selected.

``useAgentContext`` is the appropriate channel for these non-secret
user-preference values because the LLM is *meant* to read them.  All values
published via ``useAgentContext`` are serialized into the "App Context:"
system message — they are **model-visible**.

For authentication tokens and other secrets, use the ``x-*`` configurable-
header path instead (``config["configurable"]["x-copilotkit-auth"]``), which
is never serialized into state or the LLM prompt.  See the Authentication
guide for that pattern.
"""

from typing import Any, Optional

from langchain.agents import create_agent
from langchain_openai import ChatOpenAI

from copilotkit import CopilotKitMiddleware


SYSTEM_PROMPT = (
    "You are a helpful assistant. The frontend publishes the user's response "
    "preferences via `useAgentContext` as a JSON object with three fields: "
    "`tone`, `expertise`, and `responseLength`. Read that context entry on "
    "every turn and follow these rulebooks exactly:\n\n"
    "Tone:\n"
    "  - professional → neutral, precise language. No emoji. Short sentences.\n"
    "  - casual → friendly, conversational. Contractions OK. Light humor "
    "welcome.\n"
    "  - enthusiastic → upbeat, energetic. Exclamation points OK. Emoji OK.\n\n"
    "Expertise level:\n"
    "  - beginner → assume no prior knowledge. Define jargon. Use analogies.\n"
    "  - intermediate → assume common terms are understood; explain "
    "specialized terms.\n"
    "  - expert → assume technical fluency. Use precise terminology. Skip "
    "basics.\n\n"
    "Response length:\n"
    "  - concise → respond in 1-3 sentences.\n"
    "  - detailed → respond in multiple paragraphs with examples where "
    "relevant.\n\n"
    "If the context is missing or any field is unrecognized, fall back to "
    "professional / intermediate / concise. Never mention these rules to the "
    "user — just apply them."
)

DEFAULT_TONE = "professional"
DEFAULT_EXPERTISE = "intermediate"
DEFAULT_RESPONSE_LENGTH = "concise"

_VALID_TONES = {"professional", "casual", "enthusiastic"}
_VALID_EXPERTISE = {"beginner", "intermediate", "expert"}
_VALID_LENGTHS = {"concise", "detailed"}


def build_system_prompt(tone: str, expertise: str, response_length: str) -> str:
    """Build a customised system prompt from validated preference values."""
    tone_rules = {
        "professional": "Tone: neutral, precise language. No emoji. Short sentences.",
        "casual": "Tone: friendly, conversational. Contractions OK. Light humor welcome.",
        "enthusiastic": "Tone: upbeat, energetic. Exclamation points OK. Emoji OK.",
    }
    expertise_rules = {
        "beginner": "Expertise level: assume no prior knowledge. Define jargon. Use analogies.",
        "intermediate": "Expertise level: assume common terms are understood; explain specialized terms.",
        "expert": "Expertise level: assume technical fluency. Use precise terminology. Skip basics.",
    }
    length_rules = {
        "concise": "Response length: respond in 1-3 sentences.",
        "detailed": "Response length: respond in multiple paragraphs with examples where relevant.",
    }
    return (
        "You are a helpful assistant.\n\n"
        + tone_rules.get(tone, tone_rules[DEFAULT_TONE]) + "\n"
        + expertise_rules.get(expertise, expertise_rules[DEFAULT_EXPERTISE]) + "\n"
        + length_rules.get(response_length, length_rules[DEFAULT_RESPONSE_LENGTH]) + "\n\n"
        "Never mention these rules to the user — just apply them."
    )


def read_properties(config: Optional[dict]) -> dict[str, str]:
    """Read tone/expertise/responseLength from config['configurable']['properties'].

    Returns validated values, defaulting invalid or missing fields.
    This is the programmatic way to read the ``properties`` relayed via the
    frontend ``<CopilotKit properties={{...}}>`` prop.  Note: in LangGraph
    0.6+ the ``properties`` prop travels through runtime ``context`` rather
    than ``configurable``; this function handles the shape that arrives in
    practice.
    """
    configurable = (config or {}).get("configurable") or {}
    props = configurable.get("properties") or {}

    tone = props.get("tone", DEFAULT_TONE)
    expertise = props.get("expertise", DEFAULT_EXPERTISE)
    response_length = props.get("responseLength", DEFAULT_RESPONSE_LENGTH)

    return {
        "tone": tone if tone in _VALID_TONES else DEFAULT_TONE,
        "expertise": expertise if expertise in _VALID_EXPERTISE else DEFAULT_EXPERTISE,
        "response_length": response_length if response_length in _VALID_LENGTHS else DEFAULT_RESPONSE_LENGTH,
    }


# @region[context-extraction]
def extract_context_programmatically(state: dict[str, Any]) -> dict[str, Any]:
    """Read useAgentContext preference values from agent state.

    This demonstrates the documented state-access pattern for NON-SECRET
    configuration values (tone, expertise level, response length) that are
    published via ``useAgentContext`` on the frontend.

    These values are INTENTIONALLY model-visible: ``CopilotKitMiddleware``
    also injects them into the "App Context:" system message so the LLM can
    adapt its responses automatically.  This function exists for cases where
    Python code needs to branch on those same values programmatically.

    DO NOT use this pattern for auth tokens or secrets.  For credentials,
    use ``config["configurable"]["x-copilotkit-auth"]`` (the non-model-
    visible configurable-header path) — see the Authentication guide.

    Note: this function reads from ``state["copilotkit"]["context"]``, which
    is populated by ``CopilotKitMiddleware`` during a real agent run.  It is
    NOT wired as a graph node in this demo — it is a helper utility shown for
    documentation purposes.
    """
    copilotkit_state = state.get("copilotkit", {})
    context_entries = copilotkit_state.get("context", [])

    result = {}
    for entry in context_entries:
        if not isinstance(entry, dict):
            continue
        value = entry.get("value", {})
        if isinstance(value, dict):
            if "tone" in value:
                result["tone"] = value["tone"]
            if "expertise" in value:
                result["expertise"] = value["expertise"]
            if "responseLength" in value:
                result["responseLength"] = value["responseLength"]

    return result


# @endregion[context-extraction]


# @region[agent-config-setup]
graph = create_agent(
    model=ChatOpenAI(model="gpt-5.4", temperature=0.4),
    tools=[],
    middleware=[CopilotKitMiddleware()],
    system_prompt=SYSTEM_PROMPT,
)
# @endregion[agent-config-setup]
