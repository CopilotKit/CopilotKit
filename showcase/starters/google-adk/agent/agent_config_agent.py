"""Agent backing the Agent Config Object demo.

The frontend forwards a typed config object (`tone`, `expertise`,
`response_length`) into shared session state; a before-model callback
reads it every turn and prepends a config-derived system message. This
lets the same agent behave very differently based on UI controls without
restarting a session.
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

def _format_config(config: dict | None) -> str | None:
    if not config or not isinstance(config, dict):
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
    lines.append("Honour every directive above on every turn.")
    return "\n".join(lines)

def _inject_config(
    callback_context: CallbackContext, llm_request: LlmRequest
) -> Optional[LlmResponse]:
    config = callback_context.state.get("config") or {}
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
    if sig_idx != -1:
        end_marker = "Honour every directive above on every turn."
        end_idx = original_text.find(end_marker, sig_idx)
        if end_idx != -1:
            original_text = original_text[end_idx + len(end_marker) :].lstrip("\n")

    if block:
        new_text = block + "\n\n" + original_text if original_text else block
    else:
        new_text = original_text

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
