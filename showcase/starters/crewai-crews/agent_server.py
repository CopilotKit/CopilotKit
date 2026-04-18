"""
Agent Server for CrewAI (Crews)

FastAPI server that hosts the CrewAI crew backend.
The Next.js CopilotKit runtime proxies requests here via AG-UI protocol.
"""

import logging

# ORDER-CRITICAL: load .env and apply aimock redirection FIRST — before any
# crewai / litellm / openai module is imported. Those modules can construct
# clients at import time that latch onto OPENAI_BASE_URL / OPENAI_API_KEY as
# they were at import, making later mutations invisible. Keep these two lines
# at the very top of imports (after stdlib), above the crewai import below.
from dotenv import load_dotenv
from aimock_toggle import configure_aimock

load_dotenv()
configure_aimock()

# HARDENING: CrewAI's ChatWithCrewFlow.__init__ (in ag_ui_crewai.crews) makes
# blocking synchronous LLM calls via generate_crew_chat_inputs, which in turn
# calls generate_input_description_with_ai and generate_crew_description_with_ai
# from crewai.cli.crew_chat. In ag-ui-crewai <= 0.1.5 this happens at module
# import time inside add_crewai_crew_fastapi_endpoint, BEFORE uvicorn binds its
# port. Any LLM hiccup (aimock regression, OpenAI outage, network blip) will
# crash the Python process before the HTTP server is listening, which causes
# Railway/Kubernetes/ECS health checks to fail and deploys to roll back.
#
# Patch both functions to return static strings. The AI-generated descriptions
# are only cosmetic for the CrewAI chat UI (which the CopilotKit runtime does
# not use), so static defaults are functionally equivalent for our showcase.
#
# Upstream issue: https://github.com/crewAIInc/crewAI/issues/5510
# Upstream fix: ag-ui-crewai repo (deferred ChatWithCrewFlow construction
# to first-request) — landed on main but not yet released as of 0.1.5.
# Remove this shim once ag-ui-crewai > 0.1.5 ships and the requirements.txt
# ceiling is lifted.
from crewai.cli import crew_chat as _crewai_crew_chat

# Fail loudly if upstream renames/removes these symbols. setattr() on a module
# always succeeds regardless of prior attribute existence, so without this
# guard an upstream rename would silently no-op the patch and reintroduce the
# pre-bind LLM crash bug with a green PR.
_REQUIRED_ATTRS = (
    "generate_input_description_with_ai",
    "generate_crew_description_with_ai",
)
for _attr in _REQUIRED_ATTRS:
    if not hasattr(_crewai_crew_chat, _attr):
        raise RuntimeError(
            f"crewai upstream drift: crewai.cli.crew_chat.{_attr} no longer exists. "
            f"The import-time hardening shim in agent_server.py would silently no-op, "
            f"reintroducing the pre-bind LLM crash bug. Either update the shim to the "
            f"new function name, or remove it if ag-ui-crewai > 0.1.5 (with deferred "
            f"construction fix) has been adopted. See: "
            f"https://github.com/crewAIInc/crewAI/issues/5510"
        )


def _static_input_description(input_name, *_args, **_kwargs):
    return f"Input value for '{input_name}'."


def _static_crew_description(*_args, **_kwargs):
    return "A CrewAI crew."


_crewai_crew_chat.generate_input_description_with_ai = _static_input_description
_crewai_crew_chat.generate_crew_description_with_ai = _static_crew_description

# Verify the patch took effect (defense-in-depth against import-order weirdness
# or re-imports that could shadow our module reference).
if _crewai_crew_chat.generate_input_description_with_ai is not _static_input_description:
    raise RuntimeError(
        "crewai hardening shim: patch verification failed — "
        "generate_input_description_with_ai was shadowed or re-imported after patching. "
        "This would reintroduce the pre-bind LLM crash bug."
    )
if _crewai_crew_chat.generate_crew_description_with_ai is not _static_crew_description:
    raise RuntimeError(
        "crewai hardening shim: patch verification failed — "
        "generate_crew_description_with_ai was shadowed or re-imported after patching. "
        "This would reintroduce the pre-bind LLM crash bug."
    )

logging.getLogger(__name__).info(
    "Applied crewai.cli.crew_chat hardening shim (upstream issue #5510). "
    "Remove this shim after ag-ui-crewai > 0.1.5 is adopted."
)

from ag_ui_crewai.endpoint import add_crewai_crew_fastapi_endpoint
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from agent.crew import LatestAiDevelopment

app = FastAPI(title="CrewAI (Crews) Agent Server")

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


@app.get("/health")
async def health():
    return {"status": "ok"}


# NOTE: intentionally NO `if __name__ == "__main__": main()` block.
# Every execution path for this module — the package `pnpm dev` script, the
# generated starter `pnpm dev` script, the Docker entrypoint, and the CI
# workflow — invokes `python -m uvicorn agent_server:app ...` directly from
# the command line (with `--host`, `--port`, and optional `--reload` passed
# as flags). A module-level `main()` wrapper reading PORT / RELOAD from env
# was dead code that CI never exercised AND whose defaults (PORT=8000) drifted
# out of sync with the starter's actual binding (8123). Remove it rather than
# maintain an orphan knob.
