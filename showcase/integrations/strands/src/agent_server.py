"""
Agent Server for AWS Strands

FastAPI server that hosts the Strands agent backend.
The Next.js CopilotKit runtime proxies requests here via AG-UI protocol.

IMPORTANT: Do NOT import ``ag_ui_strands`` or ``strands`` (directly or
transitively via ``agents.agent``) above the ``_disabled_instrument`` patch
below. The patch MUST be installed before strands' Tracer is constructed,
otherwise ``ThreadingInstrumentor().instrument()`` runs with the unpatched
implementation and causes recursive ThreadPoolExecutor wrapping.
"""

import os
import sys

# CVDIAG bootstrap — MUST be the first non-stdlib import (folded in from the
# dropped L1-H slot). Importing this module configures the root logger via
# ``logging.basicConfig`` so the ``agents._header_forwarding`` (and sibling
# ``agents.*``) CVDIAG loggers actually EMIT (fixes the silent-drop bug), and
# resolves the verbosity tier + PB writer. It imports pydantic/starlette only
# (NOT strands), so it is safe to run before the OTel ThreadingInstrumentor
# patch below — it does not pull ``strands`` into ``sys.modules``.
import _shared.cvdiag_bootstrap  # noqa: F401,E402  (first non-stdlib import — bootstrap side effects)

# HACK: strands-agents (observed on 1.35.0, requirements.txt floors at 1.15.0)
# unconditionally calls ``ThreadingInstrumentor().instrument()`` when its
# Tracer is constructed (strands/telemetry/tracer.py). In combination with
# strands' async model client dispatching work onto ThreadPoolExecutor, this
# wraps ThreadPoolExecutor.submit in a way that re-enters itself recursively,
# producing ``RecursionError: maximum recursion depth exceeded`` during
# tool-rendering requests and surfacing as an OpenAI APIConnectionError.
#
# Disabling the autoload env var (OTEL_PYTHON_DISABLED_INSTRUMENTATIONS)
# does not help because strands imports and instruments the class
# directly, bypassing the entry_point-based autoloader.
#
# Neutralize the instrument() call before strands imports the module.
# Remove this block once ``strands-agents >= X.Y.Z`` is pinned in
# requirements.txt, where X.Y.Z is the version that makes OTel
# instrumentation opt-in (not yet released as of strands-agents 1.35.0).
from opentelemetry.instrumentation.threading import (  # noqa: E402  (must precede ag_ui_strands / strands imports)
    ThreadingInstrumentor as _ThreadingInstrumentor,
)


# Import-order guard: if ``strands`` was already imported above this line
# (directly or transitively), the Tracer may have been constructed with
# the original ``instrument`` — and patching the class now has no effect
# on the already-wrapped ThreadPoolExecutor. Fail loudly at import rather
# than silently recursing at request time.
#
# NOTE: these guards are implemented as ``if not ...: raise RuntimeError``
# rather than ``assert`` on purpose. ``assert`` statements are stripped
# when Python runs with ``-O`` (some Docker base images and optimized
# CPython builds do this), which would silently re-expose the recursion
# bug. Using an explicit raise keeps the guard active under ``-O``.
def _assert_strands_not_preimported() -> None:
    """Raise RuntimeError if ``strands`` was imported before this patch ran.

    Extracted to a named function so tests can monkey-patch it cleanly
    (rather than having to regex-neutralize an inline assert in the source).
    """
    if "strands" in sys.modules:
        raise RuntimeError(
            "strands imported before OTel patch applied — "
            "remove any strands / ag_ui_strands import that precedes this line in agent_server.py"
        )


_assert_strands_not_preimported()


def _disabled_instrument(self, *args, **kwargs):
    """No-op replacement for ``ThreadingInstrumentor.instrument``.

    Returns ``self`` so fluent callers (``ThreadingInstrumentor().instrument().uninstrument()``)
    don't raise ``AttributeError: 'NoneType' object has no attribute ...``.
    """
    return self


_ThreadingInstrumentor.instrument = _disabled_instrument  # type: ignore[method-assign]


def _assert_instrumentor_patched() -> None:
    """Raise RuntimeError if the ThreadingInstrumentor patch is not in effect.

    Extracted to a named function for the same reason as
    ``_assert_strands_not_preimported`` — survives ``python -O`` and is
    cleanly monkey-patchable from tests.
    """
    if _ThreadingInstrumentor.instrument is not _disabled_instrument:
        raise RuntimeError(
            "ThreadingInstrumentor.instrument patch was not applied — "
            "check import order in agent_server.py"
        )


_assert_instrumentor_patched()

# ORDER-CRITICAL: install the global httpx hook BEFORE any agent module
# imports. Strands' ``OpenAIModel`` constructs its httpx client at
# ``build_showcase_agent()`` time below (run at module-import scope), so
# the patch must be in place before the agent imports resolve.
from agents._cvdiag_backend import CvdiagBackendMiddleware  # noqa: E402
from agents._header_forwarding import (  # noqa: E402
    HeaderForwardingHTTPMiddleware,
    install_executor_contextvar_propagation,
    install_global_httpx_hook,
)

install_global_httpx_hook()
# Strands dispatches SYNC tools (e.g. the declarative gen-ui
# `generate_a2ui` tool, which makes a secondary OpenAI call) onto the
# default ThreadPoolExecutor via loop.run_in_executor(...), which does NOT
# propagate ContextVars to the worker thread. Without this, the
# forwarded-header ContextVar set on the inbound request task is empty by
# the time the secondary call's outbound httpx hook fires, and aimock
# can't match the right fixture for the request.
install_executor_contextvar_propagation()

import uvicorn  # noqa: E402  (kept after patch for consistent import-ordering policy)
from dotenv import load_dotenv  # noqa: E402
from starlette.middleware.base import BaseHTTPMiddleware  # noqa: E402
from starlette.responses import JSONResponse  # noqa: E402

from ag_ui_strands import create_strands_app  # noqa: E402  (must follow instrumentor patch)
from agents.agent import build_showcase_agent  # noqa: E402  (must follow instrumentor patch)
from agents.byoc_hashbrown import build_byoc_hashbrown_agent  # noqa: E402  (must follow instrumentor patch)
from agents.byoc_json_render import build_byoc_json_render_agent  # noqa: E402  (must follow instrumentor patch)
from agents.voice_agent import build_voice_agent  # noqa: E402  (must follow instrumentor patch)
from agents.a2ui_fixed import build_a2ui_fixed_schema_agent  # noqa: E402  (must follow instrumentor patch)
from agents.a2ui_dynamic import build_a2ui_dynamic_agent  # noqa: E402  (must follow instrumentor patch)
from agents.recovery_agent import build_a2ui_recovery_agent  # noqa: E402  (must follow instrumentor patch)

load_dotenv()

# Build the agent via factory so import-time failures are localized and
# testable. Any env-var / model-init / hook-patching errors surface here,
# not at arbitrary module-import time.
agui_agent = build_showcase_agent()

# Voice agent: tool-free, for voice demos that only need transcription + chat.
voice_agui_agent = build_voice_agent()
voice_app = create_strands_app(voice_agui_agent, "/")

# Declarative-hashbrown agent: tool-free, emits a strict hashbrown `{ "ui": [...] }`
# JSON envelope (see agents/byoc_hashbrown.py) consumed by `@hashbrownai/react`'s
# useJsonParser + useUiKit. The shared showcase agent at "/" cannot emit this
# envelope, so the declarative-hashbrown demo gets a dedicated specialized agent.
byoc_hashbrown_agui_agent = build_byoc_hashbrown_agent()
byoc_hashbrown_app = create_strands_app(byoc_hashbrown_agui_agent, "/")

# Declarative-json-render agent: tool-free, emits a `@json-render/react` flat-spec
# JSON object (`{ root, elements }`, see agents/byoc_json_render.py). Mounted as a
# dedicated specialized agent so the demo no longer relies on the generic "/" agent.
byoc_json_render_agui_agent = build_byoc_json_render_agent()
byoc_json_render_app = create_strands_app(byoc_json_render_agui_agent, "/")

# A2UI fixed-schema agent: owns the `display_flight` backend tool which emits
# an `a2ui_operations` envelope (createSurface/updateComponents/
# updateDataModel) targeting the showcase frontend's fixed catalog
# (`copilotkit://flight-fixed-catalog`). The runtime A2UIMiddleware paints the
# envelope directly — no generate_a2ui injection. Mounted as a dedicated agent
# so the demo no longer relies on the generic "/" agent's search_flights tool.
a2ui_fixed_schema_agui_agent = build_a2ui_fixed_schema_agent()
a2ui_fixed_schema_app = create_strands_app(a2ui_fixed_schema_agui_agent, "/")

# A2UI dynamic-schema agent (declarative-gen-ui demo): a plain agent with no
# generate_a2ui tool wired. When the runtime forwards `injectA2UITool: true`,
# the adapter auto-injects `generate_a2ui` and drives a secondary render
# planner to GENERATE the surface layout, stamped with the catalog id the page
# registers (`declarative-gen-ui-catalog`). Mounted as a dedicated agent so the
# demo no longer relies on the generic "/" agent.
a2ui_dynamic_agui_agent = build_a2ui_dynamic_agent()
a2ui_dynamic_app = create_strands_app(a2ui_dynamic_agui_agent, "/")

# A2UI error-recovery agent: same auto-inject dynamic-schema setup, but the
# aimock fixtures force the inner render_a2ui to emit free-form/sloppy args (heal
# pill) or a structurally-invalid surface on every attempt (exhaust pill); the
# Strands adapter runs the toolkit validate->retry recovery loop on the
# auto-inject path. Mounted as a dedicated agent so the Next.js route can proxy
# to AGENT_URL/a2ui-recovery/.
a2ui_recovery_agui_agent = build_a2ui_recovery_agent()
a2ui_recovery_app = create_strands_app(a2ui_recovery_agui_agent, "/")

# Create the FastAPI app from the AG-UI Strands integration
agent_path = os.getenv("AGENT_PATH", "/")
app = create_strands_app(agui_agent, agent_path)

# Mount the voice agent as a sub-application at /voice so the Next.js
# voice runtime can point HttpAgent at AGENT_URL/voice/ for tool-free chat.
app.mount("/voice", voice_app)

# Mount the specialized declarative-demo agents as sub-applications so each
# Next.js route can point HttpAgent at a dedicated, prompt-tuned endpoint
# (mirrors agno's /byoc-hashbrown and /byoc-json-render mounts). The Next.js
# routes proxy to AGENT_URL/byoc-hashbrown/ and AGENT_URL/byoc-json-render/
# (trailing slash) so the sub-application's root route resolves.
app.mount("/byoc-hashbrown", byoc_hashbrown_app)
app.mount("/byoc-json-render", byoc_json_render_app)
# A2UI fixed-schema: the Next.js route proxies to AGENT_URL/a2ui-fixed-schema/
# (trailing slash) so the sub-application's root route resolves.
app.mount("/a2ui-fixed-schema", a2ui_fixed_schema_app)
# A2UI dynamic-schema: the Next.js route proxies to AGENT_URL/declarative-gen-ui/
# (trailing slash) so the sub-application's root route resolves.
app.mount("/declarative-gen-ui", a2ui_dynamic_app)
# A2UI error-recovery: the Next.js route proxies to AGENT_URL/a2ui-recovery/
# (trailing slash) so the sub-application's root route resolves.
app.mount("/a2ui-recovery", a2ui_recovery_app)


# Serve /health via middleware so it short-circuits BEFORE route resolution.
# `create_strands_app(..., agent_path="/")` installs a catch-all at the root
# that shadows any later `@app.get("/health")` decorator. Middleware runs
# above the routing layer, so /health stays reachable.
class HealthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.url.path == "/health" and request.method == "GET":
            return JSONResponse({"status": "ok"})
        return await call_next(request)


app.add_middleware(HealthMiddleware)

# Capture inbound CopilotKit ``x-*`` headers (e.g. ``x-aimock-context``)
# into a per-request ContextVar so any outbound LLM/provider httpx call
# made inside the request scope copies them onto its outbound request.
# Paired with ``install_global_httpx_hook`` above.
app.add_middleware(HeaderForwardingHTTPMiddleware)

# CVDIAG backend emitter (spec §3 Layer 2) — emits the HTTP-observable backend
# boundaries (request.ingress, sse.first_byte, sse.event, sse.aborted,
# response.complete, error.caught) as structured CVDIAG envelopes. Added LAST so
# it is the OUTERMOST layer: it observes ingress before any inner layer mutates
# the request and wraps the response stream so SSE boundaries fire as chunks
# flow. Gated behind ``CVDIAG_BACKEND_EMITTER`` (default OFF, canary-safe) — the
# middleware fast-paths to a bare pass-through when the flag is unset.
app.add_middleware(CvdiagBackendMiddleware)


def main():
    """Run the uvicorn server."""
    port = int(os.getenv("PORT", "8000"))
    reload = os.getenv("UVICORN_RELOAD", "").lower() == "true"
    uvicorn.run(
        "agent_server:app",
        host="0.0.0.0",
        port=port,
        reload=reload,
    )


if __name__ == "__main__":
    main()
