"""CLI entry point for the Hermes AG-UI adapter (HTTP/SSE server).

Usage::

    python -m agui_adapter          # or: hermes-agui
    PORT=8000 hermes-agui

Environment:
    PORT / HERMES_AGUI_PORT   listen port (default 8000)
    HERMES_AGUI_HOST          listen host (default 127.0.0.1)
    OPENAI_BASE_URL           LLM endpoint (aimock in tests)
    HERMES_AGUI_MODEL/PROVIDER/API_KEY/TOOLSETS   see session.AgentConfig
"""

from __future__ import annotations

import logging
import os
import sys


def _setup_logging() -> None:
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(
        logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s", datefmt="%H:%M:%S")
    )
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(logging.INFO)
    for noisy in ("httpx", "httpcore", "openai"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def main(argv: list[str] | None = None) -> None:
    _setup_logging()
    import uvicorn

    from agui_adapter.server import create_app

    host = os.environ.get("HERMES_AGUI_HOST", "127.0.0.1")
    port = int(os.environ.get("PORT") or os.environ.get("HERMES_AGUI_PORT") or "8000")
    logging.getLogger(__name__).info("Starting Hermes AG-UI adapter on %s:%d", host, port)
    uvicorn.run(create_app(), host=host, port=port, log_level="warning")


if __name__ == "__main__":
    main()
