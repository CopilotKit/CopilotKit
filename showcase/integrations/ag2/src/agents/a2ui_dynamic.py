"""AG2 agent for the Vantage Threads declarative A2UI demo."""

from __future__ import annotations

import json

from _shared.a2ui_sales import (
    SALES_ANALYST_PROMPT,
    SALES_CATALOG_ID,
    sales_render_tool_description,
)
from ag2 import Agent, Context
from ag2.ag_ui import AGUIStream
from ag2.config.openai import OpenAIResponsesConfig
from ag2.events import ModelRequest, ModelResponse, TextInput
from fastapi import FastAPI
from openai import AsyncOpenAI

from tools import RENDER_A2UI_TOOL_SCHEMA, build_a2ui_operations_from_tool_call

from ._header_forwarding import get_forwarded_headers
from ._loop_cap import loop_cap

SYSTEM_PROMPT = SALES_ANALYST_PROMPT + " Call `generate_a2ui` without arguments."


async def generate_a2ui(ctx: Context) -> str:
    """Generate a dashboard from the conversation and the application's sales data."""
    planner_prompt = "Design a Vantage Threads dashboard and call `render_a2ui`."
    app_prompts = [prompt for prompt in ctx.prompt if prompt != SYSTEM_PROMPT]
    messages = [
        {"role": "system", "content": "\n\n".join([planner_prompt, *app_prompts])}
    ]
    for event in await ctx.stream.history.get_events():
        if isinstance(event, ModelRequest):
            text = "".join(
                part.content for part in event.parts if isinstance(part, TextInput)
            )
            if text:
                messages.append({"role": "user", "content": text})
        elif isinstance(event, ModelResponse) and event.content:
            messages.append({"role": "assistant", "content": event.content})

    async with AsyncOpenAI() as client:
        response = await client.chat.completions.create(
            model="gpt-6-luna",
            reasoning_effort="none",
            messages=messages,
            tools=[
                {
                    "type": "function",
                    "function": {
                        **RENDER_A2UI_TOOL_SCHEMA,
                        "description": sales_render_tool_description(
                            RENDER_A2UI_TOOL_SCHEMA["description"]
                        ),
                    },
                }
            ],
            tool_choice={"type": "function", "function": {"name": "render_a2ui"}},
            extra_headers=get_forwarded_headers() or None,
        )
    calls = response.choices[0].message.tool_calls if response.choices else None
    if not calls:
        return json.dumps({"error": "LLM did not call render_a2ui"})
    args = json.loads(calls[0].function.arguments)
    args["catalogId"] = SALES_CATALOG_ID
    return json.dumps(build_a2ui_operations_from_tool_call(args))


agent = Agent(
    "declarative_gen_ui_assistant",
    prompt=SYSTEM_PROMPT,
    config=OpenAIResponsesConfig(model="gpt-6-luna", streaming=True),
    tools=[generate_a2ui],
    middleware=[loop_cap(8)],
)

stream = AGUIStream(agent)
a2ui_dynamic_app = FastAPI()
a2ui_dynamic_app.mount("", stream.build_asgi())
