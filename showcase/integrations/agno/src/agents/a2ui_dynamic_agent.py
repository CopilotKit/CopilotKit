"""Agno agent for the Vantage Threads declarative A2UI demo."""

from __future__ import annotations

import json
from contextvars import ContextVar

import openai
from ag_ui.core import Context
from agno.agent.agent import Agent
from agno.models.openai import OpenAIChat
from agno.run import RunContext
from dotenv import load_dotenv

from _shared.a2ui_sales import SALES_ANALYST_PROMPT, SALES_CATALOG_ID, with_app_context
from agents._header_forwarding import get_forwarded_headers

from tools import (
    build_a2ui_operations_from_tool_call,
    RENDER_A2UI_TOOL_SCHEMA,
)

load_dotenv()


SYSTEM_PROMPT = (
    SALES_ANALYST_PROMPT + " Pass a `context` string summarizing what to render."
)
app_context: ContextVar[tuple[Context, ...]] = ContextVar(
    "a2ui_app_context", default=()
)


def sales_instructions() -> str:
    return with_app_context(SYSTEM_PROMPT, app_context.get())


def generate_a2ui(run_context: RunContext, context: str) -> str:
    """Generate dynamic A2UI components from a brief and the app's sales data."""
    system_prompt = with_app_context(
        "Generate a useful dashboard UI.", app_context.get()
    )
    if context and context.strip():
        system_prompt = f"{system_prompt}\n\nConversation context:\n{context}"

    # Forward the request-scoped CopilotKit ``x-*`` headers (notably
    # ``x-aimock-context``) onto this SECONDARY OpenAI call explicitly.
    # agno runs under uvloop in prod, where the executor-contextvar shim is
    # inert; relying on the global httpx hook + ContextVar alone is fragile
    # across loop types. Reading the captured headers here (on the request
    # context that invoked the tool) and passing them as ``default_headers``
    # makes the secondary call carry the context REGARDLESS of loop type, so
    # aimock can match the fixture instead of returning 503 on an empty
    # ``x-aimock-context``.
    forwarded_headers = get_forwarded_headers()
    client = openai.OpenAI(default_headers=forwarded_headers or None)
    response = client.chat.completions.create(
        reasoning_effort="none",
        model="gpt-6-luna",
        messages=[
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": (
                    "Generate a dynamic A2UI dashboard based on the conversation."
                ),
            },
        ],
        tools=[
            {
                "type": "function",
                "function": {
                    **RENDER_A2UI_TOOL_SCHEMA,
                    "description": f"Render a dynamic A2UI surface with catalogId {SALES_CATALOG_ID!r}.",
                },
            }
        ],
        tool_choice={
            "type": "function",
            "function": {"name": "render_a2ui"},
        },
    )

    choice = response.choices[0]
    if choice.message.tool_calls:
        args = json.loads(choice.message.tool_calls[0].function.arguments)
        args["catalogId"] = SALES_CATALOG_ID
        result = build_a2ui_operations_from_tool_call(args)
        return json.dumps(result)

    return json.dumps({"error": "LLM did not call render_a2ui"})


agent = Agent(
    model=OpenAIChat(reasoning_effort="none", id="gpt-6-luna", timeout=120),
    tools=[generate_a2ui],
    tool_call_limit=4,
    instructions=sales_instructions,
    cache_callables=False,
)
