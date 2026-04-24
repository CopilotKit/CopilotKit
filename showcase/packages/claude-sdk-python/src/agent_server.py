"""
Agent Server for Claude Agent SDK (Python)

FastAPI server that hosts the Claude agent backend via AG-UI protocol.
The Next.js CopilotKit runtime proxies requests here.

Endpoints:
  POST /                           — default shared Claude agent (sales
                                      assistant). Used by most demos.
  POST /byoc-json-render           — BYOC json-render demo: emits a
                                      single JSON spec.
  POST /byoc-hashbrown             — BYOC hashbrown demo: emits
                                      hashbrown UI envelope JSON.
  POST /multimodal                 — vision + PDF support for the
                                      multimodal demo.
  POST /agent-config               — reads tone/expertise/responseLength
                                      from ``forwarded_props`` for the
                                      agent-config demo.

Each dedicated endpoint reuses the shared AG-UI <-> Anthropic streaming
plumbing in ``agents.agent`` but swaps the system prompt and/or tool set
as the demo requires.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator

import uvicorn
from ag_ui.core import RunAgentInput
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from agents.agent import create_app, run_agent
from agents.agent_config_agent import build_system_prompt, read_properties
from agents.byoc_hashbrown_agent import BYOC_HASHBROWN_SYSTEM_PROMPT
from agents.byoc_json_render_agent import BYOC_JSON_RENDER_SYSTEM_PROMPT
from agents.multimodal_agent import SYSTEM_PROMPT as MULTIMODAL_SYSTEM_PROMPT
from agents.multimodal_agent import convert_part_for_claude

load_dotenv()


def _stream_agent_response(
    input_data: RunAgentInput,
    *,
    system_prompt_override: str | None = None,
    disable_tools: bool = False,
    preprocess_user_parts: callable | None = None,
) -> StreamingResponse:
    """Wrap ``run_agent`` in a StreamingResponse with demo-specific overrides.

    The shared ``run_agent`` in ``agents.agent`` accepts keyword overrides
    that let per-demo endpoints swap the system prompt or tool registry
    without duplicating the streaming loop.
    """

    async def event_stream() -> AsyncIterator[str]:
        async for chunk in run_agent(
            input_data,
            system_prompt_override=system_prompt_override,
            disable_tools=disable_tools,
            preprocess_user_parts=preprocess_user_parts,
        ):
            yield chunk

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


app = create_app()

# Tighten CORS: the dedicated endpoints share the same CORS policy as the
# default route, which `create_app` already opens up with `*`. No extra
# middleware needed here.


@app.post("/byoc-json-render")
async def byoc_json_render_endpoint(request: Request) -> StreamingResponse:
    body = await request.json()
    input_data = RunAgentInput(**body)
    return _stream_agent_response(
        input_data,
        system_prompt_override=BYOC_JSON_RENDER_SYSTEM_PROMPT,
        disable_tools=True,
    )


@app.post("/byoc-hashbrown")
async def byoc_hashbrown_endpoint(request: Request) -> StreamingResponse:
    body = await request.json()
    input_data = RunAgentInput(**body)
    return _stream_agent_response(
        input_data,
        system_prompt_override=BYOC_HASHBROWN_SYSTEM_PROMPT,
        disable_tools=True,
    )


@app.post("/multimodal")
async def multimodal_endpoint(request: Request) -> StreamingResponse:
    body = await request.json()
    input_data = RunAgentInput(**body)
    return _stream_agent_response(
        input_data,
        system_prompt_override=MULTIMODAL_SYSTEM_PROMPT,
        disable_tools=True,
        preprocess_user_parts=convert_part_for_claude,
    )


@app.post("/agent-config")
async def agent_config_endpoint(request: Request) -> StreamingResponse:
    body = await request.json()
    input_data = RunAgentInput(**body)
    props = read_properties(input_data.forwarded_props)
    system_prompt = build_system_prompt(
        props["tone"], props["expertise"], props["response_length"]
    )
    return _stream_agent_response(
        input_data,
        system_prompt_override=system_prompt,
        disable_tools=True,
    )


def main() -> None:
    """Run the uvicorn server."""
    port = int(os.getenv("AGENT_PORT", "8000"))
    uvicorn.run("agent_server:app", host="0.0.0.0", port=port, reload=True)


if __name__ == "__main__":
    main()
