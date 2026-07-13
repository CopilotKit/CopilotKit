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
from typing import cast

import openai
from ag2 import Agent
from ag2.config import OpenAIConfig
from ag2.ag_ui import AGUIStream  # type: ignore[import-not-found]  # runtime-only submodule (ag2[ag-ui] extra); not present in static type stubs
from fastapi import FastAPI
from openai.types.chat import ChatCompletionFunctionToolParam
from openai.types.shared_params import FunctionDefinition

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
    "`generate_a2ui` takes no arguments and handles the rendering "
    "automatically. Keep chat replies to one short sentence; let the UI do "
    "the talking."
)


async def generate_a2ui() -> str:
    """Generate dynamic A2UI components based on the conversation.

    Takes NO arguments. The outer agent calls this tool with empty
    arguments (``{}``); the per-request user prompt is read from the
    ``RequestUserMessageMiddleware`` ContextVar (see ``_request_context``)
    rather than threaded through a tool parameter. This mirrors the
    langgraph-python sibling, whose ``generate_a2ui`` also takes no args
    (``a2ui_dynamic.py``), and keeps the tool schema aligned with the D6
    fixtures, which emit ``generate_a2ui`` with ``arguments="{}"``. A
    required ``context`` parameter here would make pydantic reject every
    empty-args call and drive the outer agent into a retry hot loop.

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
    # from any agent-held conversation state (which would be shared
    # module-level mutable state racing across concurrent requests). If the
    # middleware did not
    # capture anything (non-AG-UI request, parse failure already logged at
    # WARNING) we fall back to the original hardcoded prompt so the inner
    # LLM call still produces a sensible default.
    user_prompt = get_latest_user_message() or (
        "Generate a dynamic A2UI dashboard based on the conversation."
    )
    # The inner-call system message is constant; per-pill distinctness comes
    # from ``user_prompt`` above (the outer conversation's latest user
    # message, captured per-request). Previously this was the outer agent's
    # ``context`` tool argument, but the outer agent calls ``generate_a2ui``
    # with empty args ``{}`` (see the no-arg signature + the D6 fixtures),
    # so a required ``context`` param only produced a pydantic hot loop.
    inner_system_prompt = "Generate a useful dashboard UI."
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
                    "content": inner_system_prompt,
                },
                {"role": "user", "content": user_prompt},
            ],
            tools=[
                ChatCompletionFunctionToolParam(
                    type="function",
                    # RENDER_A2UI_TOOL_SCHEMA is an untyped dict literal that
                    # conforms to the OpenAI FunctionDefinition TypedDict shape;
                    # cast so the type checker accepts it (no runtime change).
                    function=cast(FunctionDefinition, RENDER_A2UI_TOOL_SCHEMA),
                )
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

    # tool_calls is a union of function- and custom-tool calls; only the
    # function variant carries `.function`. `tool_choice` above forces the
    # `render_a2ui` FUNCTION tool, so the first call is always the function
    # variant at runtime — narrow on `.type` to make that explicit to the type
    # checker (and degrade gracefully to the same error shape if it ever isn't).
    first_call = choice.message.tool_calls[0]
    if first_call.type != "function":
        logger.warning(
            "generate_a2ui: secondary LLM returned non-function tool call type=%s",
            first_call.type,
        )
        return json.dumps({"error": "LLM did not call render_a2ui"})

    try:
        args = json.loads(first_call.function.arguments)
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


agent = Agent(
    name="declarative_gen_ui_assistant",
    prompt=SYSTEM_PROMPT,
    config=OpenAIConfig(model="gpt-4o-mini", streaming=True),
    # Guard-rationale note: the 0.x port capped tool-call loops with
    # max_consecutive_auto_reply=8; ag2 1.0 has no direct per-turn
    # auto-reply cap, so no equivalent parameter is set here.
    tools=[generate_a2ui],
)

stream = AGUIStream(agent)
a2ui_dynamic_app = FastAPI()
a2ui_dynamic_app.mount("", stream.build_asgi())
