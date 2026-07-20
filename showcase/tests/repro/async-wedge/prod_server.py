"""Repro server that drives the REAL production a2ui_dynamic generator.

This is the source-level RED->GREEN discriminator: it runs the ACTUAL
``run_a2ui_dynamic_agent`` async generator from
``src/agents/a2ui_dynamic.py`` end-to-end. Whether the uvicorn event loop stays
responsive under load depends ENTIRELY on the production source — specifically
whether the ``_generate_a2ui`` call at a2ui_dynamic.py:287 is offloaded with
``asyncio.to_thread`` (the fix) or invoked synchronously on the loop (the bug).

The real ``anthropic`` clients inside the generator are pointed at the slow mock
endpoint via ``ANTHROPIC_BASE_URL``, so both the primary streaming call and the
secondary ``_generate_a2ui`` sync call exercise the true httpx transport with
multi-second latency.

Driving the generator to actually invoke ``generate_a2ui`` requires the primary
streaming LLM to emit a tool_use for it; the companion ``slow_anthropic.py``
serves a fixed streaming response that does exactly that when TARGET drives it.
To keep the harness robust and framework-version-independent, ``/generate``
consumes the generator fully (draining all SSE chunks); the secondary sync call
fires whenever the model requests the tool.
"""

from __future__ import annotations

import os
import sys

from fastapi import FastAPI

# Mirror tests/python/conftest.py path setup: package root (for the `tools`
# symlink) + src/ (for `agents.*`).
_PKG_ROOT = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "..",
        "..",
        "integrations",
        "claude-sdk-python",
    )
)
_INTEG_SRC = os.path.join(_PKG_ROOT, "src")
for _p in (_PKG_ROOT, _INTEG_SRC):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import asyncio  # noqa: E402

from ag_ui.core import RunAgentInput, UserMessage  # noqa: E402

from agents.a2ui_dynamic import run_a2ui_dynamic_agent  # noqa: E402
from agents import a2ui_dynamic  # noqa: E402

app = FastAPI()

# MODE controls which production surface is exercised:
#   MODE=generator (default) -- drive the full run_a2ui_dynamic_agent generator
#                               end-to-end (integration-level GREEN proof).
#   MODE=direct              -- call the REAL production _generate_a2ui sync
#                               function the way a2ui_dynamic.py:~287 calls it.
#                               FIXED toggles the call shape so the harness owns
#                               RED vs GREEN on the real function (mutation
#                               guard): FIXED=1 => await asyncio.to_thread(...)
#                               (the fix), else sync-on-loop (the pre-fix bug).
MODE = os.getenv("MODE", "generator").strip().lower()
_FIXED_RAW = os.getenv("FIXED", "0").strip().lower()
FIXED = _FIXED_RAW in ("1", "true")

# Count how many times the REAL production _generate_a2ui function actually
# executes. Wrapping the module attribute (rather than a shell-side chunk-count
# heuristic) means the counter fires only when the bug site is genuinely
# reached, regardless of call shape (asyncio.to_thread offload OR sync-on-loop).
# This closes the MODE=generator false-green hole (M1): if the mock's SSE is
# mis-parsed, the generate_a2ui tool_use is dropped, or the generator early-exits
# the dispatch branch, _generate_a2ui is never invoked, this counter stays 0,
# and the shell GREEN assertion (tool_dispatch_fired >= 1) FAILS instead of
# trivially passing on WEDGE==0.
TOOL_DISPATCH_FIRED = 0
_real_generate_a2ui = a2ui_dynamic._generate_a2ui


def _counting_generate_a2ui(*args: object, **kwargs: object) -> object:
    global TOOL_DISPATCH_FIRED
    TOOL_DISPATCH_FIRED += 1
    return _real_generate_a2ui(*args, **kwargs)


a2ui_dynamic._generate_a2ui = _counting_generate_a2ui


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/stats")
async def stats() -> dict[str, int]:
    return {"tool_dispatch_fired": TOOL_DISPATCH_FIRED}


def _build_input() -> RunAgentInput:
    return RunAgentInput(
        thread_id="repro-thread",
        run_id="repro-run",
        messages=[
            UserMessage(
                id="m1",
                role="user",
                content="Show me a dashboard of Q1 sales.",
            )
        ],
        tools=[],
        context=[],
        state=None,
        forwarded_props={},
    )


@app.post("/generate")
async def generate() -> dict[str, object]:
    if MODE == "direct":
        # Exercise the REAL production _generate_a2ui sync function. FIXED
        # selects the exact call shape used by a2ui_dynamic.py at the offload
        # site, isolating the blocking construct from the async-stream phase so
        # the mutation guard is deterministic.
        if FIXED:
            result = await asyncio.to_thread(
                a2ui_dynamic._generate_a2ui, "repro context", None
            )
        else:
            result = a2ui_dynamic._generate_a2ui("repro context", None)
        return {"ok": bool(result), "tool_dispatch_fired": TOOL_DISPATCH_FIRED}

    # MODE=generator: drive the REAL production generator end-to-end. With the
    # source fix present, the secondary sync _generate_a2ui is offloaded via
    # asyncio.to_thread so the loop stays free.
    chunks = 0
    async for _chunk in run_a2ui_dynamic_agent(_build_input()):
        chunks += 1
    return {"chunks": chunks, "tool_dispatch_fired": TOOL_DISPATCH_FIRED}
