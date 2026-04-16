"""Render-mode middleware for context-driven GenUI strategy switching.

Reads ``render_mode`` and ``output_schema`` from the CopilotKit context list
and adapts agent output accordingly:

- **tool-based**: no changes (default)
- **a2ui**: no changes (agent decides when to call generate_a2ui tool)
- **json-render**: append JSONL instruction to system prompt
- **hashbrown**: apply ``response_format`` with the ``output_schema`` from context
The ``apply_render_mode`` function is a ``@wrap_model_call`` decorator for
LangGraph agents that plugs into the CopilotKit middleware chain.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any


# ---------------------------------------------------------------------------
# Prompt fragments
# ---------------------------------------------------------------------------

JSONL_RENDER_INSTRUCTION = (
    "\n\n## Output format — JSONL spec patches\n"
    "You MUST emit your UI updates as JSONL (one JSON object per line) inside\n"
    "a fenced code block with the ``spec`` language tag. Each line is a patch\n"
    "object with at minimum an ``op`` field (\"add\", \"replace\", \"remove\")\n"
    "and a ``path`` field (JSON-Pointer into the component tree).\n\n"
    "Example:\n"
    "```spec\n"
    '{"op":"replace","path":"/title","value":"Updated Dashboard"}\n'
    '{"op":"add","path":"/widgets/-","value":{"type":"chart","data":[1,2,3]}}\n'
    "```\n"
    "Do NOT wrap the block in any other markup. The frontend renderer will\n"
    "parse each line and apply the patches incrementally.\n"
)


# ---------------------------------------------------------------------------
# Context extraction helpers
# ---------------------------------------------------------------------------

def get_render_mode(context: list[dict[str, Any]]) -> str:
    """Extract render_mode from CopilotKit context entries.

    Scans the context list for an entry whose ``description`` is
    ``"render_mode"`` and returns its ``value``.  Falls back to
    ``"tool-based"`` when no matching entry is found.
    """
    for entry in context:
        if entry.get("description") == "render_mode":
            return entry.get("value", "tool-based")
    return "tool-based"


def get_output_schema(context: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Extract output_schema (HashBrown kit schema) from context.

    Returns the parsed JSON schema dict, or ``None`` if the context does not
    contain an ``output_schema`` entry.
    """
    for entry in context:
        if entry.get("description") == "output_schema":
            val = entry.get("value")
            if isinstance(val, str):
                try:
                    return json.loads(val)
                except json.JSONDecodeError:
                    return None
            return val
    return None


# ---------------------------------------------------------------------------
# Prompt augmentation
# ---------------------------------------------------------------------------

def apply_render_mode_prompt(system_prompt: str, render_mode: str) -> str:
    """Return *system_prompt* with render-mode instructions appended.

    For ``tool-based`` and ``a2ui`` modes the prompt is returned unchanged.
    For ``json-render`` the relevant instruction block is appended.
    """
    if render_mode == "json-render":
        return system_prompt + JSONL_RENDER_INSTRUCTION
    return system_prompt


# ---------------------------------------------------------------------------
# LangGraph @wrap_model_call decorator
# ---------------------------------------------------------------------------

def apply_render_mode(fn=None):
    """``@wrap_model_call`` middleware that adapts the model request.

    Usage with the CopilotKit middleware chain::

        from middleware.render_mode import apply_render_mode

        agent = create_agent(
            ...,
            middleware=[CopilotKitMiddleware(), apply_render_mode()],
        )

    Behaviour per mode:

    * **tool-based / a2ui** -- pass through unchanged.
    * **json-render** -- prepend JSONL instruction to system messages.
    * **hashbrown** -- set ``response_format`` with the ``output_schema``
      extracted from context.
    """
    try:
        from langchain.agents.middleware import wrap_model_call
        from langchain.agents.structured_output import ProviderStrategy
    except ImportError:
        # Fallback for environments without the CopilotKit langchain extensions
        from copilotkit.langchain import wrap_model_call, ProviderStrategy

    @wrap_model_call
    async def _apply_render_mode(request, handler):
        # --- Extract context from copilotkit state -------------------------
        copilot_context: list[dict[str, Any]] | None = None
        state = getattr(request, "state", None)
        if isinstance(state, dict):
            copilot_context = state.get("copilotkit", {}).get("context")

        if not isinstance(copilot_context, list):
            return await handler(request)

        render_mode = get_render_mode(copilot_context)

        # --- Prompt-injection modes ----------------------------------------
        if render_mode == "json-render":
            messages = list(getattr(request, "messages", []))
            augmented = []
            for msg in messages:
                if getattr(msg, "type", None) == "system" or (
                    isinstance(msg, dict) and msg.get("role") == "system"
                ):
                    content = (
                        msg.content
                        if hasattr(msg, "content")
                        else msg.get("content", "")
                    )
                    new_content = apply_render_mode_prompt(content, render_mode)
                    if hasattr(msg, "content"):
                        # LangChain message object — copy with new content
                        msg = msg.copy(update={"content": new_content})
                    else:
                        msg = {**msg, "content": new_content}
                augmented.append(msg)
            request = request.override(messages=augmented)

        # --- HashBrown mode: structured output via response_format ---------
        elif render_mode == "hashbrown":
            schema = get_output_schema(copilot_context)
            if isinstance(schema, dict):
                if not schema.get("title"):
                    schema["title"] = "StructuredOutput"
                if not schema.get("description"):
                    schema["description"] = (
                        "Structured response schema for the CopilotKit agent."
                    )
                request = request.override(
                    response_format=ProviderStrategy(schema=schema, strict=True),
                )

        return await handler(request)

    if fn is not None:
        return _apply_render_mode(fn)
    return _apply_render_mode
