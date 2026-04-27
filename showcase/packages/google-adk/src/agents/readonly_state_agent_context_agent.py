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
    lines.append("Treat this context as read-only background information.")
    return "\n".join(lines)


def _inject_context(
    callback_context: CallbackContext, llm_request: LlmRequest
) -> Optional[LlmResponse]:
    copilotkit_state = callback_context.state.get("copilotkit") or {}
    if not isinstance(copilotkit_state, dict):
        return None
    raw_entries = copilotkit_state.get("context") or []
    if not isinstance(raw_entries, list):
        return None

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
    if sig_idx != -1:
        end_marker = "Treat this context as read-only background information."
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
