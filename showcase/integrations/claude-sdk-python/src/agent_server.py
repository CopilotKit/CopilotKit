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
  POST /shared-state-read-write    — bidirectional shared state: UI
                                      writes preferences, agent writes
                                      notes back via ``set_notes`` tool.
  POST /subagents                  — supervisor delegates to research /
                                      writing / critique sub-agents,
                                      each its own Anthropic SDK call.
  POST /mcp-apps                   — MCP Apps demo: no bespoke tools,
                                      forwards MCP middleware-injected
                                      tools straight to Claude.

Each dedicated endpoint reuses the shared AG-UI <-> Anthropic streaming
plumbing in ``agents.agent`` but swaps the system prompt and/or tool set
as the demo requires.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator, Callable
from typing import Any

import uvicorn
from ag_ui.core import RunAgentInput
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from agents.a2ui_dynamic import run_a2ui_dynamic_agent
from agents.a2ui_fixed import run_a2ui_fixed_agent
from agents.agent import create_app, run_agent
from agents.agent_config_agent import build_system_prompt, read_properties
from agents.byoc_hashbrown_agent import BYOC_HASHBROWN_SYSTEM_PROMPT
from agents.byoc_json_render_agent import BYOC_JSON_RENDER_SYSTEM_PROMPT
from agents.hitl_in_chat_agent import run_hitl_in_chat_agent
from agents.interrupt_agent import run_interrupt_agent
from agents.mcp_apps_agent import run_mcp_apps_agent
from agents.multimodal_agent import SYSTEM_PROMPT as MULTIMODAL_SYSTEM_PROMPT
from agents.multimodal_agent import convert_part_for_claude
from agents.reasoning_agent import run_reasoning_agent
from agents.shared_state_read_write_agent import (
    run_shared_state_read_write_agent,
)
from agents.subagents_agent import run_subagents_agent
from agents.tool_rendering_reasoning_chain_agent import (
    run_tool_rendering_reasoning_chain_agent,
)

load_dotenv()


def _stream_agent_response(
    input_data: RunAgentInput,
    *,
    system_prompt_override: str | None = None,
    disable_tools: bool = False,
    preprocess_user_parts: Callable[..., Any] | None = None,
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


@app.get("/health")
async def health() -> dict[str, str]:
    """Liveness probe.

    The Next.js runtime route at ``src/app/api/copilotkit/route.ts`` polls
    ``GET ${AGENT_URL}/health`` to surface backend reachability in its own
    health response. Without this endpoint the probe always reports
    ``unreachable`` even when FastAPI is healthy.
    """
    return {"status": "ok"}


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


@app.post("/shared-state-read-write")
async def shared_state_read_write_endpoint(request: Request) -> StreamingResponse:
    """Bidirectional shared state demo — UI writes preferences, agent writes notes.

    Uses its own streaming loop (not the shared sales-assistant
    ``run_agent``) because the state schema, tools, and prompt-injection
    middleware are all demo-specific.
    """
    body = await request.json()
    input_data = RunAgentInput(**body)

    async def event_stream() -> AsyncIterator[str]:
        async for chunk in run_shared_state_read_write_agent(input_data):
            yield chunk

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/reasoning")
async def reasoning_endpoint(request: Request) -> StreamingResponse:
    """Reasoning demo backend — emits AG-UI REASONING_MESSAGE_* events.

    Shared by the agentic-chat-reasoning and reasoning-default-render
    demos. Both demos hit the same backend; the difference is purely
    on the frontend slot configuration.
    """
    body = await request.json()
    input_data = RunAgentInput(**body)

    async def event_stream() -> AsyncIterator[str]:
        async for chunk in run_reasoning_agent(input_data):
            yield chunk

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/tool-rendering-reasoning-chain")
async def tool_rendering_reasoning_chain_endpoint(
    request: Request,
) -> StreamingResponse:
    """Sequential tool calls + visible reasoning chain."""
    body = await request.json()
    input_data = RunAgentInput(**body)

    async def event_stream() -> AsyncIterator[str]:
        async for chunk in run_tool_rendering_reasoning_chain_agent(input_data):
            yield chunk

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/mcp-apps")
async def mcp_apps_endpoint(request: Request) -> StreamingResponse:
    """MCP Apps demo — pass-through tools forwarded by the runtime middleware.

    The dedicated runtime at ``/api/copilotkit-mcp-apps`` configures
    ``mcpApps: { servers: [...] }``, which auto-applies the MCP Apps
    middleware to the agent. The middleware appends the remote MCP
    server's tools to the AG-UI request's ``tools`` array; this endpoint
    forwards them straight to Claude.
    """
    body = await request.json()
    input_data = RunAgentInput(**body)

    async def event_stream() -> AsyncIterator[str]:
        async for chunk in run_mcp_apps_agent(input_data):
            yield chunk

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/subagents")
async def subagents_endpoint(request: Request) -> StreamingResponse:
    """Sub-agents demo — supervisor delegates to research/writing/critique."""
    body = await request.json()
    input_data = RunAgentInput(**body)

    async def event_stream() -> AsyncIterator[str]:
        async for chunk in run_subagents_agent(input_data):
            yield chunk

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/hitl-in-chat")
async def hitl_in_chat_endpoint(request: Request) -> StreamingResponse:
    """In-Chat HITL demo — frontend `book_call` tool via `useHumanInTheLoop`."""
    body = await request.json()
    input_data = RunAgentInput(**body)

    async def event_stream() -> AsyncIterator[str]:
        async for chunk in run_hitl_in_chat_agent(input_data):
            yield chunk

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/interrupt-adapted")
async def interrupt_adapted_endpoint(request: Request) -> StreamingResponse:
    """Interrupt-adapted scheduling agent — shared by gen-ui-interrupt and
    interrupt-headless. The ``schedule_meeting`` tool is registered on the
    frontend via ``useFrontendTool``; the backend only provides the system
    prompt and forwards frontend tools to Claude."""
    body = await request.json()
    input_data = RunAgentInput(**body)

    async def event_stream() -> AsyncIterator[str]:
        async for chunk in run_interrupt_agent(input_data):
            yield chunk

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/declarative-gen-ui")
async def declarative_gen_ui_endpoint(request: Request) -> StreamingResponse:
    """Declarative Generative UI (A2UI Dynamic Schema) demo."""
    body = await request.json()
    input_data = RunAgentInput(**body)

    async def event_stream() -> AsyncIterator[str]:
        async for chunk in run_a2ui_dynamic_agent(input_data):
            yield chunk

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/a2ui-fixed-schema")
async def a2ui_fixed_schema_endpoint(request: Request) -> StreamingResponse:
    """A2UI Fixed Schema demo — backend ships flight_schema.json."""
    body = await request.json()
    input_data = RunAgentInput(**body)

    async def event_stream() -> AsyncIterator[str]:
        async for chunk in run_a2ui_fixed_agent(input_data):
            yield chunk

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


def main() -> None:
    """Run the uvicorn server."""
    port = int(os.getenv("AGENT_PORT", "8000"))
    uvicorn.run("agent_server:app", host="0.0.0.0", port=port, reload=True)


if __name__ == "__main__":
    main()
