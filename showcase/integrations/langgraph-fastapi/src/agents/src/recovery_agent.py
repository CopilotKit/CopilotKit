"""LangGraph (FastAPI) agent for the A2UI Error Recovery demo (OSS-158 / OSS-375).

Same dynamic-schema A2UI setup as `a2ui_dynamic.py` (declarative-gen-ui), but
with the toolkit's validate->retry recovery loop made *visible*. The two aimock
pills drive the inner `render_a2ui` sub-agent two ways:

  - HEAL pill: the model emits FREE-FORM / sloppy A2UI args (components and data
    as JSON strings rather than structured arrays) — the toolkit heals them via
    `parse_and_fix` into a valid surface in a single pass, which paints.
  - EXHAUST pill: every attempt is structurally invalid (the root references a
    missing child), so the validate->retry loop hits the cap and the tool
    returns the `a2ui_recovery_exhausted` hard-fail envelope, which the renderer
    surfaces as a tasteful `failed` state (no broken surface).

Backend-owned wiring: unlike the declarative-gen-ui demo (which relies on the
CopilotKit runtime auto-injecting `generate_a2ui`), this agent OWNS the tool via
`ag_ui_langgraph.get_a2ui_tools`, whose body runs the `render_a2ui` sub-agent +
the toolkit recovery loop IN-GRAPH. The dedicated route sets
`injectA2UITool: false` so the runtime does not inject a second copy.

Mirrors `showcase/integrations/langgraph-python/src/agents/recovery_agent.py`.
Catalog is reused from declarative-gen-ui ("declarative-gen-ui-catalog"); the
Vantage Threads sales dataset + composition rules arrive from the frontend via
App Context (declarative-gen-ui/sales-context.ts).
"""

from __future__ import annotations

import logging

from copilotkit import CopilotKitMiddleware
from copilotkit.copilotkit_lg_middleware import (
    _ensure_httpx_hook,
    _extract_forwarded_headers_from_config,
)
from langchain.agents import create_agent
from langchain_openai import ChatOpenAI
from ag_ui_langgraph import get_a2ui_tools

from src.agents.src._header_forwarding_middleware import (
    HeaderForwardingMiddleware,
)

logger = logging.getLogger(__name__)


class _HeaderForwardingChatOpenAI(ChatOpenAI):
    """ChatOpenAI that re-reads LangGraph x-* headers on every model call.

    ``get_a2ui_tools`` invokes ``render_a2ui`` from a tool-node worker thread
    via ``model.bind_tools(...).invoke`` with no config. CopilotKitMiddleware
    only hooks the *agent* model, and a ContextVar set on the main thread
    does not follow ThreadPoolExecutor workers. Re-read the runnable config
    here so the inner call keeps ``x-test-id`` (aimock ``sequenceIndex``) and
    ``x-aimock-context``.
    """

    def _refresh_forwarded_headers(self) -> None:
        try:
            from langgraph.config import get_config

            get_config()
        except Exception:
            return
        _extract_forwarded_headers_from_config()
        _ensure_httpx_hook(self)

    def _generate(self, *args, **kwargs):
        self._refresh_forwarded_headers()
        return super()._generate(*args, **kwargs)

    async def _agenerate(self, *args, **kwargs):
        self._refresh_forwarded_headers()
        return await super()._agenerate(*args, **kwargs)

    def _stream(self, *args, **kwargs):
        self._refresh_forwarded_headers()
        return super()._stream(*args, **kwargs)

    async def _astream(self, *args, **kwargs):
        self._refresh_forwarded_headers()
        async for chunk in super()._astream(*args, **kwargs):
            yield chunk


def _log_attempt(record: dict) -> None:
    """Dev observability: log each recovery attempt (incl. rejected ones)."""
    logger.info(
        "[a2ui recovery] attempt %s: %s %s",
        record.get("attempt"),
        "valid" if record.get("ok") else "invalid",
        record.get("errors"),
    )


SYSTEM_PROMPT = (
    "You are the embedded sales analyst for Vantage Threads, the fictional "
    "B2B apparel company described in your App Context. Answer every business "
    "question by calling `generate_a2ui` to draw a rich visual surface, and "
    "keep the chat reply to one short sentence. Ground every number in the "
    "sales dataset from your App Context. `generate_a2ui` handles the "
    "rendering — and its automatic recovery — for you."
)

_MODEL = "gpt-4.1"

# ONE model for the agent and the inner render_a2ui sub-agent. Two instances
# meant the inner call used an unhooked HTTP client, so aimock never saw
# x-test-id and the heal fixture's sequenceIndex 0/1 was consumed into the
# DEFAULT_TEST_ID bucket (second run on the same aimock then matches the
# outer generate_a2ui stub and returns empty components).
_model = _HeaderForwardingChatOpenAI(model=_MODEL)

graph = create_agent(
    model=_model,
    tools=[
        get_a2ui_tools(
            {
                "model": _model,
                "default_catalog_id": "declarative-gen-ui-catalog",
                "recovery": {"maxAttempts": 3},
                "on_a2ui_attempt": _log_attempt,
            }
        )
    ],
    middleware=[HeaderForwardingMiddleware(), CopilotKitMiddleware()],
    system_prompt=SYSTEM_PROMPT,
)
