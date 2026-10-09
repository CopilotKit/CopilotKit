"""gen-ui-agent — Strands `set_steps` planner backend.

Mirrors the per-demo specialization pattern used by `byoc_hashbrown.py` and
`byoc_json_render.py`: this module owns the tool definition, the state hook
that turns the tool's args into a ``StateSnapshotEvent``, and the
prompt addendum. ``agent.py`` imports these and wires them into the shared
``StrandsAgent`` instance (Strands runs one shared backend agent for all
demos — see PARITY_NOTES.md).

Contract (see harness probe `d5-gen-ui-agent.ts` + langgraph-python /
ms-agent-python siblings):

* Tool name: ``set_steps``
* Tool args: ``{"steps": [{"id", "title", "status"}, ...]}``
* Status values: ``"pending" | "in_progress" | "completed"``
* Every ``set_steps`` call must trigger a ``StateSnapshotEvent`` carrying
  ``{"steps": [...]}`` so the frontend's ``useAgent`` subscription
  re-renders ``[data-testid="agent-state-card"]`` and the per-step
  ``[data-testid="agent-step"][data-status=...]`` markers.

The planner walks each step pending → in_progress → completed by calling
``set_steps`` on every transition, so a normal 3-step plan emits 7 tool
calls (1 initial enumeration + 2 transitions × 3 steps).

Single-shared-agent caveat: this prompt addendum lives at the top-level
SYSTEM_PROMPT so it's seen by every demo's chat, but the instructions are
gated on "when the user asks you to plan / orchestrate a multi-step task"
so other demos (weather lookup, sales pipeline, etc.) are not regressed
into emitting set_steps for unrelated requests.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from strands import tool


logger = logging.getLogger(__name__)


# ---- Tool ---------------------------------------------------------------


@tool
def set_steps(steps: list[dict]) -> str:
    """Publish the current plan and step statuses.

    Call this every time a step transitions (including the first
    enumeration of steps). ALWAYS pass the COMPLETE list of steps on each
    call — the frontend treats this as the source of truth for the live
    progress card.

    Each step is an object with:

    * ``id``: stable string id (e.g. ``"step-1"``)
    * ``title``: short human-readable description
    * ``status``: one of ``"pending"``, ``"in_progress"``, ``"completed"``

    Args:
        steps: The complete list of steps with current statuses.

    Returns:
        Confirmation string for the LLM to summarise back to the user.
    """
    return f"Published {len(steps)} step(s)."


# ---- State hook ---------------------------------------------------------


async def steps_state_from_args(context: Any) -> dict | None:
    """Emit a StateSnapshotEvent for the ``steps`` slot on every ``set_steps``.

    Mirrors ``notes_state_from_args`` / ``sales_state_from_args``: accept
    str-or-dict tool input, validate, return a snapshot dict for
    ag_ui_strands to publish to the frontend's ``useAgent`` subscription.

    Returns ``None`` (no snapshot) when the input shape is unrecognized,
    matching the error-degradation policy of the sibling hooks in
    agent.py.
    """
    raw_input = getattr(context, "tool_input", None)
    if raw_input is None:
        logger.warning("steps_state_from_args: context has no tool_input")
        return None

    tool_input = raw_input
    if isinstance(tool_input, str):
        try:
            tool_input = json.loads(tool_input)
        except json.JSONDecodeError as exc:
            logger.warning(
                "steps_state_from_args: malformed JSON tool input (%s); input excerpt: %s",
                exc,
                repr(raw_input)[:200],
            )
            return None

    if isinstance(tool_input, dict):
        steps_data = tool_input.get("steps")
    elif isinstance(tool_input, list):
        steps_data = tool_input
    else:
        logger.warning(
            "steps_state_from_args: unsupported tool_input type %s",
            type(tool_input).__name__,
        )
        return None

    if not isinstance(steps_data, list):
        return None

    # Defensive normalization — preserve only the keys the frontend reads
    # (id/title/status). Coerce non-dict entries to empty dicts so
    # downstream serialization never crashes; the frontend will render
    # such entries as "pending" placeholders.
    cleaned: list[dict] = []
    for s in steps_data:
        if not isinstance(s, dict):
            continue
        cleaned.append(
            {
                "id": str(s.get("id", "")),
                "title": str(s.get("title", "")),
                "status": str(s.get("status", "pending")),
            }
        )
    return {"steps": cleaned}


# ---- Prompt addendum ----------------------------------------------------


GEN_UI_AGENT_PROMPT = (
    "When the user asks you to plan, organize, research, or otherwise "
    'orchestrate a multi-step task (e.g. "plan a product launch", '
    '"organize a team offsite", "research a competitor"), enter '
    "planner mode and follow this exact sequence:\n"
    "1. Plan exactly 3 concrete steps and call `set_steps` ONCE with all "
    'three steps at status="pending".\n'
    '2. Step 1: call `set_steps` with step 1 at status="in_progress", '
    'then call `set_steps` again with step 1 at status="completed".\n'
    '3. Step 2: call `set_steps` with step 2 at status="in_progress", '
    'then call `set_steps` again with step 2 at status="completed".\n'
    '4. Step 3: call `set_steps` with step 3 at status="in_progress", '
    'then call `set_steps` again with step 3 at status="completed".\n'
    "5. Send ONE final conversational assistant message summarising the "
    "plan, then stop. Do not call any more tools after step 3 is "
    "completed.\n"
    "Rules: ALWAYS pass the full list of 3 steps on every set_steps call "
    "(not a diff). Never call set_steps in parallel — wait for one call "
    'to return before the next. Use stable string ids like "step-1", '
    '"step-2", "step-3". Planner mode does NOT apply to weather / '
    "sales / shared-state / sub-agent demos — only enter it when the "
    "user explicitly asks you to plan or orchestrate."
)
