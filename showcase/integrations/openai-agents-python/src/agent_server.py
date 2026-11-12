"""Agent server for the OpenAI Agents SDK (Python).

FastAPI app with one AG-UI endpoint per demo at POST /<name>, served by the
``ag_ui_openai_agents`` adapter. The Next.js runtime maps each agent name to
its path (src/app/api/copilotkit*/route.ts).
"""

import os
from contextlib import asynccontextmanager

# CVDIAG bootstrap — first non-stdlib import (configures logging + PB writer).
import _shared.cvdiag_bootstrap  # noqa: F401,E402  # isort: skip

from dotenv import load_dotenv  # noqa: E402

# Before any demo_agents import: _common reads OPENAI_MODEL & co. at import.
load_dotenv()

import uvicorn  # noqa: E402
from ag_ui_openai_agents import add_openai_agents_fastapi_endpoint  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

from demo_agents._common import close_client, configure_sdk  # noqa: E402
from demo_agents._cvdiag_backend import CvdiagBackendMiddleware  # noqa: E402
from demo_agents._header_forwarding import HeaderForwardingHTTPMiddleware  # noqa: E402
from demo_agents.registry import AGENTS  # noqa: E402

configure_sdk()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    await close_client()


# @region[agent-server]
app = FastAPI(title="OpenAI Agents SDK Agent Server", lifespan=lifespan)
for name, agent in AGENTS.items():
    add_openai_agents_fastapi_endpoint(app, agent, f"/{name}", include_health=False)
# @endregion[agent-server]


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "agents": sorted(AGENTS)}


# Records inbound x-* headers per request on a ContextVar; the OpenAI client's
# request hook (demo_agents._common) copies the mock/diagnostic ones onto
# every model call made for that request.
app.add_middleware(HeaderForwardingHTTPMiddleware)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)
app.add_middleware(CvdiagBackendMiddleware)


def main():
    port = int(os.getenv("PORT", "8000"))
    # Pass the app object, not "agent_server:app": the import-string form
    # imports this module a second time and builds every agent twice.
    uvicorn.run(app, host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
