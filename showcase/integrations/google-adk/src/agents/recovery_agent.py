"""Agent backing the A2UI Error Recovery demo (OSS-158, ADK-only).

The agent owns one generate_a2ui tool and the runtime disables auto-injection.
Express uses the official SDK response stream; Direct JSON is selectable through
forwardedProps.a2ui.inferenceFormat. The adapter clones the owned tool per run,
so concurrent requests retain their own selection. The toolkit validates and
retries malformed model output up to three times, preserving any already
validated progressive surface operations and reporting exhaustion explicitly.

The fixtures deterministically exercise invalid-then-valid output and repeated
failure. The frontend catalog remains the source of truth. See requirements.txt
for the release prerequisites; no local wheel is a published dependency.
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
                "inference_format": "express",
                "default_catalog_id": "declarative-gen-ui-catalog",
                "recovery": {"maxAttempts": 3},
                "on_a2ui_attempt": _log_attempt,
            }
        )
    ],
    after_model_callback=stop_on_terminal_text,
)
