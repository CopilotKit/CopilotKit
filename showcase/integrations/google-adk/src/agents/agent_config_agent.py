"""Agent backing the Agent Config Object demo.

The frontend forwards a typed config object (`tone`, `expertise`,
`response_length`, `language`) into shared session state; a
before-model callback reads it every turn and prepends a config-derived
system message. This lets the same agent behave very differently based
on UI controls without restarting a session.
"""

from __future__ import annotations

import logging
from typing import Optional

from google.adk.agents import LlmAgent
from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types

logger = logging.getLogger(__name__)

CONFIG_PREFIX_SIGNATURE = "[agent-config] config:"
# Single source of truth for the trailing sentence — the strip-prior-block
# logic in `_inject_config` looks for this exact string. Don't mutate the
# literal in just one place.
CONFIG_END_MARKER = "Honour every directive above on every turn."


def _format_config(config: dict | None) -> str | None:
    if not isinstance(config, dict):
        # Schema drift signal — the frontend sent something other than a
        # dict for `config`. Log so a downstream UI regression doesn't
        # masquerade as the agent silently ignoring user settings.
        if config is not None:
            logger.warning(
                "agent-config: state['config'] is %s, expected dict; "
                "treating as empty",
                type(config).__name__,
            )
        return None
    if not config:
        return None
    lines = [CONFIG_PREFIX_SIGNATURE]
    if config.get("tone"):
        lines.append(f"- Tone: {config['tone']}")
    if config.get("expertise"):
        lines.append(f"- Expertise level: {config['expertise']}")
    if config.get("response_length"):
        lines.append(f"- Response length: {config['response_length']}")
    if config.get("language"):
        lines.append(f"- Language: {config['language']}")
    if len(lines) == 1:
        # Truthy dict but no recognized keys (schema drift or
        # future-extension forwardedProps). Avoid emitting a meaningless
        # [SIG, END_MARKER] block that tells the LLM to "Honour every
        # directive above" with no actual directives. Mirrors the same
        # guard in readonly_state_agent_context_agent._format_context.
        return None
    lines.append(CONFIG_END_MARKER)
    return "\n".join(lines)


def _inject_config(
    callback_context: CallbackContext, llm_request: LlmRequest
) -> Optional[LlmResponse]:
    config = callback_context.state.get("config")
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
            # Splice out only the prior block. Earlier versions sliced
            # `original_text[end_idx + len(...):]` which silently DROPPED
            # everything from position 0 to sig_idx — fine when our prior
            # block sits at the start of the system instruction (the
            # steady-state pattern), but if any other middleware ever
            # prepends content to system_instruction between turns, that
            # prefix would be lost. Splice preserves both the head and
            # the tail.
            original_text = (
                original_text[:sig_idx]
                + original_text[end_idx + len(CONFIG_END_MARKER) :]
            ).lstrip("\n")
        else:
            # Signature present without trailing end-marker — likely a
            # mangled prior block. Log so the drift surfaces server-side
            # rather than silently stacking on subsequent turns.
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
        # Nothing to inject AND we didn't strip anything from `original`.
        # Leave system_instruction as-is — writing an empty Content here
        # would stomp whatever the LlmAgent's `instruction=` field
        # provided to ADK.
        #
        # If we DID strip a prior block (stripped_prior_block=True) we
        # must fall through and write the result, even if empty —
        # otherwise the stale block stays embedded in the existing
        # Content. In practice this branch is unreachable for our agents
        # (their `_INSTRUCTION` is non-empty so `original_text` after
        # stripping always contains at least the static instruction),
        # but the explicit gate keeps the invariant honest if anyone
        # ever wires up an LlmAgent with an empty `instruction=`.
        return None

    llm_request.config.system_instruction = types.Content(
        role="system", parts=[types.Part(text=new_text)]
    )
    return None


_INSTRUCTION = (
    "You are a configurable assistant. Your tone, expertise, and response "
    "length are controlled by a config object the user sets in the UI; "
    "that config is supplied via shared state and added as a system "
    "message at the start of every turn. Always follow it."
)

agent_config_agent = LlmAgent(
    name="AgentConfigAgent",
    model="gemini-2.5-flash",
    instruction=_INSTRUCTION,
    tools=[],
    before_model_callback=_inject_config,
)
