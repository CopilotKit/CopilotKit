"""AG2 agent for the Declarative Generative UI (A2UI Dynamic Schema) demo.

Mirrors the langgraph-python `a2ui_dynamic.py` pattern: the agent owns the
`generate_a2ui` tool explicitly. When called, it invokes a secondary LLM
bound to `render_a2ui` (tool_choice forced) using the registered client
catalog injected via the runtime's `copilotkit.context`. The tool result
returns an `a2ui_operations` container which the runtime's A2UI middleware
detects and forwards to the frontend renderer.

The dedicated runtime route (`api/copilotkit-declarative-gen-ui/route.ts`)
sets `injectA2UITool: false` so the runtime does not double-bind a second
A2UI tool on top of this one.
"""

from __future__ import annotations

import json
import logging
from typing import Annotated

import openai
from autogen import ConversableAgent, LLMConfig
from autogen.ag_ui import AGUIStream
from fastapi import FastAPI

from tools import (
    build_a2ui_operations_from_tool_call,
    RENDER_A2UI_TOOL_SCHEMA,
)

from ._header_forwarding import get_forwarded_headers
from ._request_context import get_latest_user_message

logger = logging.getLogger(__name__)

# Module-level async client: re-used across requests (httpx connection pool is
# thread-safe). Using AsyncOpenAI inside an `async def` avoids blocking the
# ASGI event loop on the secondary LLM call.
_async_openai_client = openai.AsyncOpenAI()


SYSTEM_PROMPT = (
    "You are a demo assistant for Declarative Generative UI (A2UI — Dynamic "
    "Schema). Whenever a response would benefit from a rich visual — a "
    "dashboard, status report, KPI summary, card layout, info grid, a "
    "pie/donut chart of part-of-whole breakdowns, a bar chart comparing "
    "values across categories, or anything more structured than plain text — "
    "call `generate_a2ui` to draw it. The registered catalog includes "
    "`Card`, `StatusBadge`, `Metric`, `InfoRow`, `PrimaryButton`, `PieChart`, "
    "and `BarChart` (in addition to the basic A2UI primitives). Prefer "
    "`PieChart` for part-of-whole breakdowns (sales by region, traffic "
    "sources, portfolio allocation) and `BarChart` for comparisons across "
    "categories (quarterly revenue, headcount by team, signups per month). "
    "`generate_a2ui` takes a single `context` argument summarising the "
    "conversation. Keep chat replies to one short sentence; let the UI do "
    "the talking."
)


async def generate_a2ui(
    context: Annotated[
        str, "Conversation context summary the secondary LLM should design UI from"
    ],
) -> str:
    """Generate dynamic A2UI components based on the conversation.

    A secondary LLM designs the UI schema and data using the `render_a2ui`
    tool schema. The result is returned as an `a2ui_operations` container
    for the runtime A2UI middleware to detect and forward to the frontend.
    """
    # A4 / R2-A3: thread the latest user prompt from the outer conversation
    # into the inner call so each pill's request body is byte-distinct
    # (without this, all 4 declarative pills produce IDENTICAL wire payloads
    # because the outer agent calls generate_a2ui with arguments="{}" →
    # context defaults → system message is constant, and the user message
    # below is hardcoded).
    #
    # The prompt is read from a per-request ContextVar populated by
    # ``RequestUserMessageMiddleware`` at the inbound HTTP boundary — NOT
    # from ``agent.chat_messages`` (which is shared module-level mutable
    # state racing across concurrent requests). If the middleware did not
    # capture anything (non-AG-UI request, parse failure already logged at
    # WARNING) we fall back to the original hardcoded prompt so the inner
    # LLM call still produces a sensible default.
    user_prompt = get_latest_user_message() or (
        "Generate a dynamic A2UI dashboard based on the conversation."
    )
    # A13: forward inbound x-* headers via extra_headers as a defense in depth
    # alongside the global httpx hook (see _header_forwarding.py). The hook
    # patches httpx at module load, but extra_headers makes the intent
    # explicit at the call site and is robust to alternative HTTP transports.
    forwarded = get_forwarded_headers()
    try:
        response = await _async_openai_client.chat.completions.create(
            model="gpt-4.1",
            messages=[
                {
                    "role": "system",
                    "content": context or "Generate a useful dashboard UI.",
                },
                {"role": "user", "content": user_prompt},
            ],
            tools=[
                {
                    "type": "function",
                    "function": RENDER_A2UI_TOOL_SCHEMA,
                }
            ],
            tool_choice={"type": "function", "function": {"name": "render_a2ui"}},
            extra_headers=forwarded or None,
        )
    except Exception as exc:
        logger.error(
            "generate_a2ui: inner LLM call failed type=%s err=%s",
            type(exc).__name__,
            exc,
            exc_info=True,
        )
        return json.dumps({"error": f"inner LLM call failed: {type(exc).__name__}"})

    if not response.choices:
        logger.warning("generate_a2ui: LLM returned no choices")
        return json.dumps({"error": "LLM returned no choices"})

    choice = response.choices[0]
    if not choice.message.tool_calls:
        logger.warning("generate_a2ui: secondary LLM produced no render_a2ui tool call")
        return json.dumps({"error": "LLM did not call render_a2ui"})

    try:
        args = json.loads(choice.message.tool_calls[0].function.arguments)
        result = build_a2ui_operations_from_tool_call(args)
        return json.dumps(result)
    except (json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        logger.error(
            "generate_a2ui: failed to parse render_a2ui args type=%s err=%s",
            type(exc).__name__,
            exc,
            exc_info=True,
        )
        return json.dumps(
            {"error": f"failed to parse render_a2ui args: {type(exc).__name__}"}
        )


agent = ConversableAgent(
    name="declarative_gen_ui_assistant",
    system_message=SYSTEM_PROMPT,
    llm_config=LLMConfig({"model": "gpt-4o-mini", "stream": True}),
    human_input_mode="NEVER",
    max_consecutive_auto_reply=8,
    functions=[generate_a2ui],
)

stream = AGUIStream(agent)
a2ui_dynamic_app = FastAPI()
a2ui_dynamic_app.mount("", stream.build_asgi())
