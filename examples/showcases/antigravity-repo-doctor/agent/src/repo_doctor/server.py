"""FastAPI server: one AG-UI endpoint at POST / plus a health check."""

from __future__ import annotations

import logging

import uvicorn
from ag_ui_antigravity import create_antigravity_app
from fastapi import FastAPI

from .agent import create_agent
from .config import get_settings
from .safety import harden_process_environment

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


def create_app() -> FastAPI:
    settings = get_settings()
    # Settings are read first: the hardening removes the API keys from the
    # environment the harness and every tool inherit.
    harden_process_environment(settings.push_root.parent / "gh-config")
    agent = create_agent(settings)
    app: FastAPI = create_antigravity_app(agent, path="/")
    app.title = "Repo doctor agent"

    @app.delete("/threads/{thread_id}/workspace")
    async def delete_workspace(thread_id: str) -> dict[str, bool]:
        """Called by the web app when a conversation is deleted. The agent
        listens on 127.0.0.1 only, so only the web server can reach this."""
        await agent.delete_thread(thread_id)
        return {"ok": True}

    @app.get("/health")
    async def health() -> dict[str, str]:
        """Liveness plus the model in use. Does not call the model."""
        return {"status": "ok", "model": settings.gemini_model}

    return app


def main() -> None:
    settings = get_settings()
    logging.getLogger(__name__).info(
        "model=%s endpoint=%s workspaces=%s",
        settings.gemini_model,
        settings.google_gemini_base_url or "Google",
        settings.workspace_root,
    )
    # The app object, not an import string: an import string makes uvicorn
    # import this module a second time and build the agent twice.
    uvicorn.run(create_app(), host=settings.agent_host, port=settings.agent_port)


if __name__ == "__main__":
    main()
