"""Minimal FastAPI replica of the claude-sdk-python :8000 event-loop wedge.

Faithfully reproduces the production topology from
``src/agents/agent.py`` (``_execute_tool`` -> ``anthropic.Anthropic()`` ->
``client.messages.create()``) and ``src/agents/a2ui_dynamic.py``
(``_generate_a2ui`` same pattern): a *real* synchronous ``anthropic.Anthropic``
client whose blocking ``messages.create()`` call is invoked from within an
``async def`` request handler.

Controlled by env var:
  FIXED=0 (default) -- sync blocking call directly on the event loop (RED):
                       exactly the bug — the uvicorn loop parks in the sync
                       httpx call for the full LLM round-trip.
  FIXED=1           -- ``await asyncio.to_thread(...)`` offload (GREEN):
                       the fix — the blocking call runs on a worker thread so
                       the event loop stays live and ``/health`` keeps
                       answering.

The LLM latency is provided by a real HTTP round-trip to the companion
``slow_anthropic.py`` endpoint (base_url override), so the sync
``httpx.Client`` transport inside the anthropic SDK is exercised for real —
not a bare ``time.sleep`` stand-in.
"""

from __future__ import annotations

import asyncio
import os

import anthropic
from fastapi import FastAPI

app = FastAPI()

# CANONICAL FIXED PREDICATE — must be byte-identical with run.sh. FIXED is true
# IFF the lowercased value is exactly "1" or "true". Any other value is RED.
# This closes the false-GREEN hole where run.sh labels a run GREEN while the
# server actually ran the RED (blocking) topology.
_FIXED_RAW = os.getenv("FIXED", "0").strip().lower()
FIXED = _FIXED_RAW in ("1", "true")

# Point the REAL anthropic client at the local slow endpoint. This is the exact
# production construct: anthropic.Anthropic() with a sync httpx transport.
_SLOW_BASE_URL = os.getenv("SLOW_BASE_URL", "http://127.0.0.1:8099")


def _blocking_llm_call() -> str:
    """The load-bearing production construct: a SYNC anthropic client call.

    Mirrors ``src/agents/agent.py:793,814`` and
    ``src/agents/a2ui_dynamic.py:90,106`` — build ``anthropic.Anthropic()`` and
    call ``client.messages.create()`` synchronously. Blocks the calling OS
    thread for the full LLM round-trip.
    """
    client = anthropic.Anthropic(
        api_key=os.getenv("ANTHROPIC_API_KEY", "sk-repro-not-a-real-key"),
        base_url=_SLOW_BASE_URL,
        max_retries=0,
    )
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=16,
        messages=[{"role": "user", "content": "generate a dashboard"}],
    )
    return response.content[0].text


@app.post("/generate")
async def generate() -> dict[str, str]:
    if FIXED:
        # GREEN: offload the blocking sync call to a worker thread so the
        # event loop stays free to serve /health.
        result = await asyncio.to_thread(_blocking_llm_call)
    else:
        # RED: blocking sync call directly on the event loop thread — the bug.
        # The uvicorn loop freezes for the LLM round-trip; /health cannot answer.
        result = _blocking_llm_call()
    return {"result": result}


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
