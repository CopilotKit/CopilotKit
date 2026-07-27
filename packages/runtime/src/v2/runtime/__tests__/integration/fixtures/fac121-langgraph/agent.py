"""FAC-121 integration fixture — LangGraph auth-token proof agent.

This module proves the documented CopilotKit auth path for LangGraph Python
agents:

  CopilotRuntime
    → mergeForwardableHeaders (x-* admitted, agent.headers set)
    → HTTP backend (langgraph-api or this standalone FastAPI server)
        configurable_headers.include: ["x-*"]  (in langgraph.json)
    → LangGraph RunnableConfig: config["configurable"]["x-copilotkit-auth"]
    → graph node reads token via (config.get("configurable") or {}).get("x-copilotkit-auth")

Auth tokens accessed through this path are NEVER serialized into the LLM
system prompt ("App Context:"). The CopilotKitMiddleware's _build_app_context_note
strips all x-* keys before rendering App Context.

Usage (with langgraph-api):

    cd packages/runtime/src/v2/runtime/__tests__/integration/fixtures/fac121-langgraph
    langgraph dev --host 0.0.0.0 --port 2024

Usage (standalone, without langgraph-api):

    cd packages/runtime/src/v2/runtime/__tests__/integration/fixtures/fac121-langgraph
    pip install fastapi uvicorn langgraph langchain-core
    uvicorn agent:app --port 2024

The TypeScript integration test (fac-121-langgraph-http.test.ts) uses a
Node.js HTTP server that implements the same configurable-header admission
layer as langgraph-api, so it can run without Python or langgraph-api.
"""

import hashlib
import json
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph


# ---------------------------------------------------------------------------
# Graph node — the FAC-121 proof point.
# Reads x-copilotkit-auth from config["configurable"] (the non-model-visible
# auth path) and returns only a boolean flag and a 12-char hash prefix.
# The raw token is never stored in state, logged, or returned in any response.
# ---------------------------------------------------------------------------


def auth_node(state: dict[str, Any], config: RunnableConfig) -> dict[str, Any]:
    """LangGraph node that reads x-copilotkit-auth from config['configurable'].

    langgraph-api copies admitted x-* request headers (per configurable_headers
    in langgraph.json) into config['configurable'] before invoking the graph.
    This node reads the token from that location and records ONLY a boolean
    presence flag and a 12-char SHA-256 hash prefix — never the raw token.
    """
    configurable = config.get("configurable") or {}
    raw_token = configurable.get("x-copilotkit-auth")

    token_present = isinstance(raw_token, str) and len(raw_token) > 0
    token_hash_prefix = (
        hashlib.sha256(raw_token.encode()).hexdigest()[:12] if token_present else ""
    )

    return {
        "token_present": token_present,
        "token_hash_prefix": token_hash_prefix,
    }


# ---------------------------------------------------------------------------
# Build the LangGraph graph
# ---------------------------------------------------------------------------

builder = StateGraph(dict)
builder.add_node("auth", auth_node)
builder.add_edge(START, "auth")
builder.add_edge("auth", END)

graph = builder.compile(checkpointer=MemorySaver())


# ---------------------------------------------------------------------------
# FastAPI app — standalone server (without langgraph-api)
# Implements the same configurable-header admission layer as langgraph-api:
# x-* request headers are placed in config["configurable"].
# ---------------------------------------------------------------------------

app = FastAPI()


def _format_sse(data: str) -> str:
    return f"data: {data}\n\n"


@app.post("/runs/stream")
async def run_stream(request: Request):
    """AG-UI compatible SSE endpoint for the fac121_auth_agent graph.

    Reads x-* headers from the incoming HTTP request and places them into
    config["configurable"] — exactly what langgraph-api does when
    configurable_headers.include: ["x-*"] is set in langgraph.json.
    """
    body = await request.json()
    # HttpAgent sends threadId (camelCase) as a top-level field in the body.
    # Fall back to the legacy configurable path for direct langgraph-api usage.
    thread_id = body.get("threadId") or body.get("config", {}).get(
        "configurable", {}
    ).get("thread_id", "default")
    run_id = body.get("runId") or body.get("run_id", "run-1")

    # Admission layer: copy x-* headers into configurable (langgraph-api behavior)
    configurable: dict[str, str] = {"thread_id": thread_id}
    for header_name, header_value in request.headers.items():
        if header_name.lower().startswith("x-") and isinstance(header_value, str):
            configurable[header_name.lower()] = header_value

    config: RunnableConfig = {"configurable": configurable}

    # Invoke the real LangGraph graph node
    result = graph.invoke({}, config=config)

    token_present = result.get("token_present", False)
    token_hash_prefix = result.get("token_hash_prefix", "")

    # Return AG-UI SSE events with safe proof output only
    async def generate():
        # RUN_STARTED and RUN_FINISHED require threadId per AG-UI EventSchemas.
        yield _format_sse(
            json.dumps({"type": "RUN_STARTED", "runId": run_id, "threadId": thread_id})
        )
        yield _format_sse(
            json.dumps(
                {
                    "type": "TEXT_MESSAGE_START",
                    "messageId": "m1",
                }
            )
        )
        proof_text = (
            f"token_present:{token_present} token_hash_prefix:{token_hash_prefix}"
        )
        yield _format_sse(
            json.dumps(
                {
                    "type": "TEXT_MESSAGE_CONTENT",
                    "messageId": "m1",
                    "delta": proof_text,
                }
            )
        )
        yield _format_sse(json.dumps({"type": "TEXT_MESSAGE_END", "messageId": "m1"}))
        yield _format_sse(
            json.dumps({"type": "RUN_FINISHED", "runId": run_id, "threadId": thread_id})
        )

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/health")
async def health():
    return {"status": "ok"}
