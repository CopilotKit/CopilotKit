"""Agent backing the Shared State (Read + Write) demo.

Mirrors langgraph-python/src/agents/shared_state_read_write.py:

- UI -> agent (write): The UI owns a `preferences` object and writes it
  into agent state via agent.setState({preferences: ...}). A
  before-model callback reads the latest preferences from session state
  every turn and prepends a preferences SystemMessage so the LLM adapts.

- agent -> UI (read): The agent calls `set_notes` to update a `notes`
  list in session state; the UI reflects every update via useAgent.
"""

from __future__ import annotations

import logging
from typing import Optional

from google.adk.agents import LlmAgent
from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.adk.tools import ToolContext
from google.genai import types

logger = logging.getLogger(__name__)

PREFS_PREFIX_SIGNATURE = "[shared-state-read-write] preferences:"
# Single source of truth for the trailing sentence — the strip-prior-block
# logic in `_inject_preferences` looks for this exact string.
PREFS_END_MARKER = "Address the user by name when appropriate."


def set_notes(tool_context: ToolContext, notes: list[str]) -> dict:
    """Replace the notes array in shared state with the full updated list.

    Always pass the FULL list of short note strings (existing notes + new),
    not a diff. Keep each note short (< 120 chars).
    """
    tool_context.state["notes"] = notes
    return {"status": "ok", "count": len(notes)}


def _build_prefs_block(prefs: dict | None) -> str | None:
    if not isinstance(prefs, dict):
        if prefs is not None:
            logger.warning(
                "shared-state-read-write: state['preferences'] is %s, "
                "expected dict; treating as empty",
                type(prefs).__name__,
            )
        return None
    if not prefs:
        return None
    lines = [PREFS_PREFIX_SIGNATURE]
    if prefs.get("name"):
        lines.append(f"- Name: {prefs['name']}")
    if prefs.get("tone"):
        lines.append(f"- Preferred tone: {prefs['tone']}")
    if prefs.get("language"):
        lines.append(f"- Preferred language: {prefs['language']}")
    interests = prefs.get("interests") or []
    if interests:
        lines.append(f"- Interests: {', '.join(interests)}")
    if len(lines) == 1:
        # Truthy dict but no recognized keys (schema drift /
        # forward-extension UI prop). Don't emit a meaningless
        # [SIGNATURE, "Tailor every response..."] block. Mirrors the
        # same guard in agent_config_agent._format_config.
        return None
    lines.append(
        "Tailor every response to these preferences. " + PREFS_END_MARKER
    )
    return "\n".join(lines)


def _inject_preferences(
    callback_context: CallbackContext, llm_request: LlmRequest
) -> Optional[LlmResponse]:
    """Prepend a freshly-built preferences block onto the system instruction.

    Strips any prior preferences block (signature-prefixed) so multiple turns
    don't stack the same prefs N times.
    """
    prefs = callback_context.state.get("preferences")
    block = _build_prefs_block(prefs)

    original = llm_request.config.system_instruction
    if original is None:
        original_text = ""
    elif isinstance(original, types.Content):
        parts = original.parts or []
        original_text = (parts[0].text or "") if parts else ""
    else:
        original_text = str(original)

    sig_idx = original_text.find(PREFS_PREFIX_SIGNATURE)
    stripped_prior_block = False
    if sig_idx != -1:
        # Splice out only the prior block (preserve head + tail).
        # See agent_config_agent.py for the full rationale.
        end_idx = original_text.find(PREFS_END_MARKER, sig_idx)
        if end_idx != -1:
            stripped_prior_block = True
            original_text = (
                original_text[:sig_idx]
                + original_text[end_idx + len(PREFS_END_MARKER) :]
            ).lstrip("\n")
        else:
            logger.warning(
                "shared-state-read-write: prior prefs block has signature "
                "but no end marker; leaving original_text untouched to "
                "avoid losing user content"
            )

    if block:
        new_text = (block + "\n\n" + original_text) if original_text else block
    else:
        new_text = original_text

    if not new_text and not stripped_prior_block:
        # Nothing to inject AND we didn't strip anything. Leave
        # system_instruction as-is — writing Content(text="") would
        # clobber the LlmAgent's static `instruction=`. If we DID
        # strip a prior block we must fall through and write the
        # result so the stale block doesn't stay embedded in the
        # existing Content. See agent_config_agent.py for full
        # rationale.
        return None

    llm_request.config.system_instruction = types.Content(
        role="system", parts=[types.Part(text=new_text)]
    )
    return None


_INSTRUCTION = (
    "You are a helpful, concise assistant. The user's preferences are "
    "supplied via shared state and added as a system message at the start "
    "of every turn — always respect them. When the user asks you to "
    "remember something, or you observe something worth surfacing in the "
    "UI's notes panel, call `set_notes` with the FULL updated list of "
    "short notes."
)

shared_state_read_write_agent = LlmAgent(
    name="SharedStateReadWriteAgent",
    model="gemini-2.5-flash",
    instruction=_INSTRUCTION,
    tools=[set_notes],
    before_model_callback=_inject_preferences,
)
