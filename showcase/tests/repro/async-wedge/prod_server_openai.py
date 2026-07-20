"""Repro server that drives the REAL production OpenAI-SDK a2ui generators.

Sibling of ``prod_server.py`` for the OpenAI-SDK wedge sites. It runs the ACTUAL
production ``_generate_a2ui`` sync function from a selected integration module
(ag2 ``beautiful_chat`` or llamaindex ``agent`` / ``a2ui_dynamic``). Whether the
uvicorn event loop stays responsive under load depends ENTIRELY on the
production source — specifically whether the async ``generate_a2ui`` wrapper
offloads ``_generate_a2ui`` with ``asyncio.to_thread`` (the fix) or the blocking
``.chat.completions.create()`` runs synchronously on the loop (the bug).

The real ``openai`` client inside ``_generate_a2ui`` is pointed at the slow mock
endpoint via ``OPENAI_BASE_URL``, so the secondary sync call exercises the true
httpx transport with multi-second latency.

TARGET selects the production module under test:
    TARGET=ag2-beautiful-chat  -> integrations/ag2/src/agents/beautiful_chat.py
    TARGET=llamaindex-agent     -> integrations/llamaindex/src/agents/agent.py
    TARGET=llamaindex-a2ui      -> integrations/llamaindex/src/agents/a2ui_dynamic.py

MODE controls which production surface is exercised:
    MODE=direct (only mode supported here) -- call the REAL production
        _generate_a2ui sync function the way the async generate_a2ui wrapper
        calls it. FIXED toggles the call shape so the harness owns RED vs GREEN
        on the real function (mutation guard): FIXED=1 => await
        asyncio.to_thread(...) (the fix), else sync-on-loop (the pre-fix bug).
"""

from __future__ import annotations

import asyncio  # noqa: E402
import importlib
import os
import sys

from fastapi import FastAPI

_HERE = os.path.dirname(__file__)
_INTEGRATIONS = os.path.abspath(os.path.join(_HERE, "..", "..", "..", "integrations"))

# TARGET -> (integration dir name, dotted module under agents.*)
_TARGETS = {
    "ag2-beautiful-chat": ("ag2", "agents.beautiful_chat"),
    "llamaindex-agent": ("llamaindex", "agents.agent"),
    "llamaindex-a2ui": ("llamaindex", "agents.a2ui_dynamic"),
}

TARGET = os.getenv("TARGET", "ag2-beautiful-chat").strip().lower()
if TARGET not in _TARGETS:
    raise SystemExit(
        f"TARGET={TARGET!r} not recognised; choose one of {sorted(_TARGETS)}"
    )

_integ_name, _module_path = _TARGETS[TARGET]
_pkg_root = os.path.join(_INTEGRATIONS, _integ_name)
_integ_src = os.path.join(_pkg_root, "src")
for _p in (_pkg_root, _integ_src):
    if _p not in sys.path:
        sys.path.insert(0, _p)

_module = importlib.import_module(_module_path)

_FIXED_RAW = os.getenv("FIXED", "0").strip().lower()
FIXED = _FIXED_RAW in ("1", "true")

# Count how many times the REAL production _generate_a2ui function actually
# executes. Wrapping the module attribute means the counter fires only when the
# bug site is genuinely reached, regardless of call shape. Closes the false-green
# hole: if _generate_a2ui never runs, this stays 0 and the shell GREEN assertion
# (tool_dispatch_fired >= 1) FAILS instead of trivially passing on WEDGE==0.
TOOL_DISPATCH_FIRED = 0
_real_generate_a2ui = _module._generate_a2ui


def _counting_generate_a2ui(*args: object, **kwargs: object) -> object:
    global TOOL_DISPATCH_FIRED
    TOOL_DISPATCH_FIRED += 1
    return _real_generate_a2ui(*args, **kwargs)


_module._generate_a2ui = _counting_generate_a2ui

app = FastAPI()


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/stats")
async def stats() -> dict[str, int]:
    return {"tool_dispatch_fired": TOOL_DISPATCH_FIRED}


@app.post("/generate")
async def generate() -> dict[str, object]:
    # Exercise the REAL production _generate_a2ui sync function. FIXED selects
    # the exact call shape used by the async generate_a2ui wrapper at the offload
    # site, isolating the blocking construct so the mutation guard is
    # deterministic.
    if FIXED:
        result = await asyncio.to_thread(_module._generate_a2ui, "repro context")
    else:
        result = _module._generate_a2ui("repro context")
    return {"ok": bool(result), "tool_dispatch_fired": TOOL_DISPATCH_FIRED}
