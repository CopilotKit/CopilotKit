"""LangGraph agent for the A2UI Error Recovery demo (OSS-158 / OSS-375).

Same dynamic-schema A2UI setup as `a2ui_dynamic.py` (declarative-gen-ui), but
with the toolkit's validate->retry recovery loop made *visible*. The two
aimock pills drive the inner `render_a2ui` sub-agent two ways:

  - HEAL pill: attempt 1 is structurally invalid because the root references a
    missing child; attempt 2 is valid and paints. Aimock stages those attempts
    with per-test `sequenceIndex` 0 and 1, so the inner model request must keep
    its active request headers instead of falling into the global default test.
  - EXHAUST pill: every attempt is structurally invalid (the root references a
    missing child), so the validate->retry loop hits the cap and the tool
    returns the `a2ui_recovery_exhausted` hard-fail envelope, which the renderer
    (`@ag-ui/a2ui-middleware`) surfaces as a tasteful `failed` state (no broken
    surface).

Backend-owned wiring: unlike the declarative-gen-ui demo (which relies on the
CopilotKit runtime auto-injecting `generate_a2ui`), this agent OWNS the tool via
`ag_ui_langgraph.get_a2ui_tools`, whose body runs the `render_a2ui` sub-agent +
the toolkit recovery loop IN-GRAPH. The dedicated route sets
`injectA2UITool: false` so the runtime does not inject a second copy. Only this
backend-owned path surfaces the recovery loop + `a2ui_recovery_exhausted`
hard-fail explicitly (the runtime auto-injection path has no equivalent loop).

The A2UI tool invokes a separate inner model from inside a LangGraph tool node,
and that inner call is not handed the usual RunnableConfig. The compatibility
middleware below rebinds the active `x-*` headers at the tool boundary and hooks
that inner model's HTTP clients before `generate_a2ui` runs.

Mirrors `showcase/integrations/google-adk/src/agents/recovery_agent.py` (the
ADK sibling, which uses the singular `get_a2ui_tool`). Catalog is reused from
declarative-gen-ui ("declarative-gen-ui-catalog") so no new components are
introduced; the Vantage Threads sales dataset + composition rules arrive from
the frontend via App Context (declarative-gen-ui/sales-context.ts).
"""

from __future__ import annotations

import logging
import os

from copilotkit import CopilotKitMiddleware
from langchain.agents import create_agent
from langchain_openai import ChatOpenAI
from ag_ui_langgraph import get_a2ui_tools

from src.agents._header_forwarding_middleware import (
    AuxiliaryModelHeaderForwardingMiddleware,
)

logger = logging.getLogger(__name__)


def _log_attempt(record: dict) -> None:
    """Dev observability: log each recovery attempt (incl. rejected ones)."""
    logger.info(
        "[a2ui recovery] attempt %s: %s %s",
        record.get("attempt"),
        "valid" if record.get("ok") else "invalid",
        record.get("errors"),
    )


# Keep this aligned with the ADK `_INSTRUCTION` and the declarative-gen-ui
# SYSTEM_PROMPT: a sales analyst that answers every question by drawing a
# surface. `generate_a2ui` (owned by `get_a2ui_tools` below) handles the
# rendering — and its automatic recovery — internally.
SYSTEM_PROMPT = (
    "You are the embedded sales analyst for Vantage Threads, the fictional "
    "B2B apparel company described in your App Context. Answer every business "
    "question by calling `generate_a2ui` to draw a rich visual surface, and "
    "keep the chat reply to one short sentence. Ground every number in the "
    "sales dataset from your App Context. `generate_a2ui` handles the "
    "rendering — and its automatic recovery — for you."
)

_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o")
_A2UI_MODEL = ChatOpenAI(model=_MODEL)

# Backend-owned A2UI with the recovery loop made explicit. `maxAttempts` is set
# so the renderer's "Retrying… (N/M)" label matches the adapter's cap. Recovery
# + the recovery-exhausted hard-fail are toolkit defaults; pinned here for the
# demo. Catalog/data arrive from the frontend via context (same as declarative).
graph = create_agent(
    model=ChatOpenAI(model=_MODEL),
    tools=[
        get_a2ui_tools(
            {
                "model": _A2UI_MODEL,
                "default_catalog_id": "declarative-gen-ui-catalog",
                "recovery": {"maxAttempts": 3},
                "on_a2ui_attempt": _log_attempt,
            }
        )
    ],
    middleware=[
        AuxiliaryModelHeaderForwardingMiddleware(_A2UI_MODEL),
        CopilotKitMiddleware(),
    ],
    system_prompt=SYSTEM_PROMPT,
)
