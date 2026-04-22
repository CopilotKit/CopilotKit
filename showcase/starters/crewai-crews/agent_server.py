"""
Agent Server for CrewAI (Crews)

FastAPI server that hosts the CrewAI crew backend.
The Next.js CopilotKit runtime proxies requests here via AG-UI protocol.
"""

# ORDER-CRITICAL: load .env and apply aimock redirection FIRST — before any
# crewai / litellm / openai module is imported. Those modules can construct
# clients at import time that latch onto OPENAI_BASE_URL / OPENAI_API_KEY as
# they were at import, making later mutations invisible. Keep these two lines
# at the very top of imports (after stdlib), above the crewai import below.
from dotenv import load_dotenv
from aimock_toggle import configure_aimock

load_dotenv()
configure_aimock()

# NOTE: The pre-bind LLM crash hardening shim that previously lived here has
# been removed. It monkey-patched crewai.cli.crew_chat.generate_*_description_with_ai
# to static strings so that ChatWithCrewFlow.__init__ — which ag-ui-crewai
# <= 0.1.5 invoked at endpoint-registration time (i.e. BEFORE uvicorn bound
# its port) — could not crash the process before the HTTP server was
# listening. Upstream issue: https://github.com/crewAIInc/crewAI/issues/5510.
#
# ag-ui-crewai 0.2.0 (PR ag-ui-protocol/ag-ui#1550, released 2026-04-18)
# defers ChatWithCrewFlow construction to first request via a module-scoped
# `_cached_flow` + `asyncio.Lock` inside `add_crewai_crew_fastapi_endpoint`.
# Any LLM hiccup now surfaces as a 5xx on the first request instead of a
# startup crash, which is the correct failure mode for a runtime outage and
# is what the shim was reaching for. With the requirements.txt pin bumped to
# `>=0.2.0,<0.3.0`, the shim is dead code and has been removed.

from ag_ui_crewai.endpoint import add_crewai_crew_fastapi_endpoint
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from agent.crew import LatestAiDevelopment

app = FastAPI(title="CrewAI (Crews) Agent Server")


# Serve /health via middleware so it short-circuits BEFORE route resolution.
# `add_crewai_crew_fastapi_endpoint(app, crew, "/")` installs a catch-all at
# the root that shadows any later `@app.get("/health")` decorator. Middleware
# runs above the routing layer, so the health endpoint stays reachable.
class HealthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.url.path == "/health" and request.method == "GET":
            return JSONResponse({"status": "ok"})
        return await call_next(request)


app.add_middleware(HealthMiddleware)

# CORS: `allow_origins=["*"]` is intentional for this LOCAL DEMO / SHOWCASE
# STARTER package. The agent server binds to localhost:8000 during `pnpm dev`
# (or :8123 inside a generated starter container) and is reached ONLY by the
# Next.js frontend on :3000 during development — there is no production
# deployment surface where a wide-open CORS policy would matter.
#
# If this file is copied into a real deployment, replace `["*"]` with a
# CORS_ORIGIN env-driven allowlist. A `CORS_ORIGIN` env var is NOT wired here
# today (see .env.example); adding it is a future-work item tracked outside
# this PR.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

add_crewai_crew_fastapi_endpoint(app, LatestAiDevelopment(), "/")


# NOTE: intentionally NO `if __name__ == "__main__": main()` block.
# Every execution path for this module — the package `pnpm dev` script, the
# generated starter `pnpm dev` script, the Docker entrypoint, and the CI
# workflow — invokes `python -m uvicorn agent_server:app ...` directly from
# the command line (with `--host`, `--port`, and optional `--reload` passed
# as flags). A module-level `main()` wrapper reading PORT / RELOAD from env
# was dead code that CI never exercised AND whose defaults (PORT=8000) drifted
# out of sync with the starter's actual binding (8123). Remove it rather than
# maintain an orphan knob.
