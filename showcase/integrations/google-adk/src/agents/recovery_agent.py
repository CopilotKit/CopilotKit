"""Agent backing the A2UI Error Recovery demo (OSS-158, ADK-only).

Same dynamic-schema setup as declarative_gen_ui_agent, but with the toolkit's
validate->retry recovery loop made *visible*. The aimock fixtures force two
sequences against the inner `render_a2ui` sub-agent:

  - HEAL pill: attempt 0 emits a structurally-invalid surface (an unresolved
    child reference) that never paints; the middleware feeds the validation
    errors back and attempt 1 emits a valid surface that paints. The renderer
    (`@ag-ui/a2ui-middleware` >= 0.0.10) shows the `building -> retrying (N/M)
    -> painted` lifecycle.
  - EXHAUST pill: every attempt is invalid, so the loop hits the cap and the
    tool returns the `a2ui_recovery_exhausted` hard-fail envelope, which the
    renderer surfaces as a tasteful `failed` state (no broken surface).

Backend-owned wiring (route sets `injectA2UITool: false`), mirroring
declarative-gen-ui and the AWS Strands / ag2 convention. The recovery loop +
hard-fail envelope live in the ADK middleware (`ag_ui_adk` >= 0.7.0); the
runtime path langgraph-python uses has no equivalent loop, which is why this
demo is ADK-only. Catalog is reused from declarative-gen-ui
("declarative-gen-ui-catalog") so no new components are introduced.

Ported from ag-ui `integrations/adk-middleware/python/examples/server/api/
a2ui_recovery.py`.
"""

from __future__ import annotations

import logging

from google.adk.agents import LlmAgent
from ag_ui_adk import get_a2ui_tool

from agents.shared_chat import get_a2ui_model, get_model, stop_on_terminal_text

logger = logging.getLogger(__name__)


def _log_attempt(record: dict) -> None:
    """Dev observability: log each recovery attempt (incl. rejected ones)."""
    logger.info(
        "[a2ui recovery] attempt %s: %s %s",
        record.get("attempt"),
        "valid" if record.get("ok") else "invalid",
        record.get("errors"),
    )


_INSTRUCTION = (
    "You are the embedded sales analyst for Vantage Threads, the fictional "
    "B2B apparel company described in your context. Answer every business "
    "question by calling `generate_a2ui` to draw a rich visual surface, and "
    "keep the chat reply to one short sentence. Ground every number in the "
    "sales dataset from your context. `generate_a2ui` takes no arguments and "
    "handles the rendering — and its automatic recovery — for you."
)

# Backend-owned A2UI with the recovery loop made explicit. `maxAttempts` is set
# so the renderer's "Retrying… (N/M)" label matches the adapter's cap. Recovery
# + the recovery-exhausted hard-fail are toolkit defaults; pinned here for the
# demo. Catalog/data arrive from the frontend via context (same as declarative).
recovery_agent = LlmAgent(
    name="A2uiRecoveryAgent",
    model=get_model(),
    instruction=_INSTRUCTION,
    tools=[
        get_a2ui_tool(
            {
                "model": get_a2ui_model(),
                "default_catalog_id": "declarative-gen-ui-catalog",
                "recovery": {"maxAttempts": 3},
                "on_a2ui_attempt": _log_attempt,
            }
        )
    ],
    after_model_callback=stop_on_terminal_text,
)
