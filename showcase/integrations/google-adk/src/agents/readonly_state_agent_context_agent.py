"""Agent backing the Readonly Agent-Context demo.

The frontend exposes some read-only context to the agent via
useAgentContext({ description, value }) — CopilotKit forwards those
entries into session state under state["copilotkit"]["context"]. A
before-model callback reads them every turn and prepends a context block
so the LLM can reference them.
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

CONTEXT_PREFIX_SIGNATURE = "[agent-context] frontend-supplied context:"
# Single source of truth for the trailing sentence — the strip-prior-block
# logic in `_inject_context` looks for this exact string.
CONTEXT_END_MARKER = "Treat this context as read-only background information."


def _format_context(context_entries: list[dict]) -> str | None:
    if not context_entries:
        return None
    lines = [CONTEXT_PREFIX_SIGNATURE]
    for entry in context_entries:
        if not isinstance(entry, dict):
            continue
        desc = entry.get("description") or ""
        value = entry.get("value")
        if value is None:
            continue
        if desc:
            lines.append(f"- {desc}: {value}")
        else:
            lines.append(f"- {value}")
    if len(lines) == 1:
        return None
    lines.append(CONTEXT_END_MARKER)
    return "\n".join(lines)


def _inject_context(
    callback_context: CallbackContext, llm_request: LlmRequest
) -> Optional[LlmResponse]:
    copilotkit_state = callback_context.state.get("copilotkit")
    # Coerce malformed state to empty rather than early-return; a stale
    # context block from a prior turn would otherwise stay embedded in
    # `system_instruction` indefinitely (the strip path runs unconditionally
    # below). Log when shape drifts so the regression surfaces server-side.
    if copilotkit_state is None:
        raw_entries: list = []
    elif not isinstance(copilotkit_state, dict):
        logger.warning(
            "agent-context: state['copilotkit'] is %s, expected dict; "
            "treating as empty",
            type(copilotkit_state).__name__,
        )
        raw_entries = []
    else:
        raw_entries_candidate = copilotkit_state.get("context")
        if raw_entries_candidate is None:
            raw_entries = []
        elif not isinstance(raw_entries_candidate, list):
            logger.warning(
                "agent-context: state['copilotkit']['context'] is %s, "
                "expected list; treating as empty",
                type(raw_entries_candidate).__name__,
            )
            raw_entries = []
        else:
            raw_entries = raw_entries_candidate

    block = _format_context(raw_entries)

    original = llm_request.config.system_instruction
    if original is None:
        original_text = ""
    elif isinstance(original, types.Content):
        parts = original.parts or []
        original_text = (parts[0].text or "") if parts else ""
    else:
        original_text = str(original)

    sig_idx = original_text.find(CONTEXT_PREFIX_SIGNATURE)
    stripped_prior_block = False
    if sig_idx != -1:
        end_idx = original_text.find(CONTEXT_END_MARKER, sig_idx)
        if end_idx != -1:
            stripped_prior_block = True
            # Splice out only the prior block (preserve head + tail).
            # See agent_config_agent.py for the full rationale.
            original_text = (
                original_text[:sig_idx]
                + original_text[end_idx + len(CONTEXT_END_MARKER) :]
            ).lstrip("\n")
        else:
            logger.warning(
                "agent-context: prior context block has signature but no "
                "end marker; leaving original_text untouched to avoid "
                "losing user content"
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
    "You are an assistant that uses frontend-supplied context to give "
    "more relevant answers. The frontend passes read-only context entries "
    "via useAgentContext; they are added to your system prompt every "
    "turn. Use them when relevant."
)

readonly_state_agent_context_agent = LlmAgent(
    name="ReadonlyStateAgentContextAgent",
    model="gemini-2.5-flash",
    instruction=_INSTRUCTION,
    tools=[],
    before_model_callback=_inject_context,
)
