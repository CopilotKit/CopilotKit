"""Agent backing the Agent Config Object demo.

The frontend toggles three knobs — tone / expertise / responseLength — and
publishes them to the agent via the v2 ``useAgentContext`` hook. The
ag-ui-adk middleware lands those entries under
``state["copilotkit"]["context"]`` as a list of ``{description, value}``
dicts; a before-model callback reads the most recent agent-config payload
on every turn and prepends a derived directive block to the static system
instruction. The single static prompt below adapts its style based on
whatever values the frontend currently has selected.

LP parity (showcase/integrations/langgraph-python/src/agents/agent_config_agent.py):
schema is ``{tone, expertise, responseLength}`` with values
``professional|casual|enthusiastic`` / ``beginner|intermediate|expert`` /
``concise|detailed``. Missing or unrecognized fields fall back to
``professional / intermediate / concise``.
"""

from __future__ import annotations

import logging
from typing import Optional

from google.adk.agents import LlmAgent
from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types

from agents.shared_chat import get_model, stop_on_terminal_text

logger = logging.getLogger(__name__)

CONFIG_PREFIX_SIGNATURE = "[agent-config] config:"
# Single source of truth for the trailing sentence — the strip-prior-block
# logic in `_inject_config` looks for this exact string. Don't mutate the
# literal in just one place.
CONFIG_END_MARKER = "Honour every directive above on every turn."

# LP schema — strictly camelCase `responseLength` (matches
# `useAgentContext({ value: { tone, expertise, responseLength } })` in
# src/app/demos/agent-config/config-context-relay.tsx).
_TONE_OPTIONS = {"professional", "casual", "enthusiastic"}
_EXPERTISE_OPTIONS = {"beginner", "intermediate", "expert"}
_RESPONSE_LENGTH_OPTIONS = {"concise", "detailed"}

_DEFAULT_TONE = "professional"
_DEFAULT_EXPERTISE = "intermediate"
_DEFAULT_RESPONSE_LENGTH = "concise"


def _coerce(value: object, allowed: set[str], default: str) -> str:
    if isinstance(value, str) and value in allowed:
        return value
    return default


def _extract_agent_config(state: dict | None) -> dict | None:
    """Pull the most recent `{tone, expertise, responseLength}` payload off
    the agent runtime state.

    `useAgentContext` publishes each entry as `{description, value}`. The
    middleware appends these onto `state["copilotkit"]["context"]` as a
    list — multiple entries may be present (other components on the same
    page can publish their own). We pick the latest entry whose `value`
    is a dict containing at least one of our known keys, so unrelated
    context entries can coexist without breaking the config relay.
    """
    if not isinstance(state, dict):
        return None
    copilotkit_state = state.get("copilotkit")
    if not isinstance(copilotkit_state, dict):
        return None
    entries = copilotkit_state.get("context")
    if not isinstance(entries, list):
        return None
    for entry in reversed(entries):
        if not isinstance(entry, dict):
            continue
        value = entry.get("value")
        if not isinstance(value, dict):
            continue
        if any(k in value for k in ("tone", "expertise", "responseLength")):
            return value
    return None


def _format_config(config: dict | None) -> str | None:
    if config is None:
        return None
    if not isinstance(config, dict):
        # Schema drift signal — log so a downstream UI regression doesn't
        # masquerade as the agent silently ignoring user settings.
        logger.warning(
            "agent-config: agent-context entry value is %s, expected dict; "
            "treating as empty",
            type(config).__name__,
        )
        return None
    tone = _coerce(config.get("tone"), _TONE_OPTIONS, _DEFAULT_TONE)
    expertise = _coerce(config.get("expertise"), _EXPERTISE_OPTIONS, _DEFAULT_EXPERTISE)
    response_length = _coerce(
        config.get("responseLength"),
        _RESPONSE_LENGTH_OPTIONS,
        _DEFAULT_RESPONSE_LENGTH,
    )
    lines = [
        CONFIG_PREFIX_SIGNATURE,
        f"- Tone: {tone}",
        f"- Expertise level: {expertise}",
        f"- Response length: {response_length}",
        CONFIG_END_MARKER,
    ]
    return "\n".join(lines)


def _inject_config(
    callback_context: CallbackContext, llm_request: LlmRequest
) -> Optional[LlmResponse]:
    config = _extract_agent_config(callback_context.state)
    block = _format_config(config)

    original = llm_request.config.system_instruction
    if original is None:
        original_text = ""
    elif isinstance(original, types.Content):
        parts = original.parts or []
        original_text = (parts[0].text or "") if parts else ""
    else:
        original_text = str(original)

    sig_idx = original_text.find(CONFIG_PREFIX_SIGNATURE)
    stripped_prior_block = False
    if sig_idx != -1:
        end_idx = original_text.find(CONFIG_END_MARKER, sig_idx)
        if end_idx != -1:
            stripped_prior_block = True
            # Splice out only the prior block (preserve head + tail).
            # See readonly_state_agent_context_agent.py for the full rationale.
            original_text = (
                original_text[:sig_idx]
                + original_text[end_idx + len(CONFIG_END_MARKER) :]
            ).lstrip("\n")
        else:
            logger.warning(
                "agent-config: prior config block has signature but no end "
                "marker; leaving original_text untouched to avoid losing "
                "user content"
            )

    if block:
        new_text = (block + "\n\n" + original_text) if original_text else block
    else:
        new_text = original_text

    if not new_text and not stripped_prior_block:
        return None

    llm_request.config.system_instruction = types.Content(
        role="system", parts=[types.Part(text=new_text)]
    )
    return None


# Mirrors LP's SYSTEM_PROMPT (showcase/integrations/langgraph-python/src/
# agents/agent_config_agent.py) — the static instruction tells the LLM
# how to apply the three knobs. The injected block above just lists the
# currently-selected values; the rulebook is encoded once, here.
_INSTRUCTION = (
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

agent_config_agent = LlmAgent(
    name="AgentConfigAgent",
    model=get_model(),
    instruction=_INSTRUCTION,
    tools=[],
    before_model_callback=_inject_config,
    after_model_callback=stop_on_terminal_text,
)
