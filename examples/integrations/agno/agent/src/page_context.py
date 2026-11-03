"""Give the model what the page shares with ``useAgentContext``.

Agno 2.x's AG-UI interface (``agno.os.interfaces.agui``) does not read
``RunAgentInput.context`` and drops system messages, so without this the model
never sees the page's context. The AG-UI interface in Agno is the right owner
of this fix. Until Agno does it, ``capture_page_context`` reads the context from each ``/agui``
request and ``with_page_context`` appends it to the agent's instructions.
"""

import json
from contextvars import ContextVar

from fastapi import FastAPI, Request

_page_context: ContextVar[tuple] = ContextVar("page_context", default=())


def capture_page_context(app: FastAPI) -> None:
    """Store each ``/agui`` request's AG-UI ``context`` for the run it starts."""

    @app.middleware("http")
    async def _capture(request: Request, call_next):
        if request.method == "POST" and request.url.path.endswith("/agui"):
            try:
                context = json.loads(await request.body()).get("context") or []
            except (ValueError, AttributeError):
                context = []
            _page_context.set(tuple(context) if isinstance(context, list) else ())
        return await call_next(request)


def with_page_context(instructions: str) -> str:
    """Append the current run's page context to ``instructions``."""
    entries = [entry for entry in _page_context.get() if isinstance(entry, dict)]
    if not entries:
        return instructions
    shared = "\n\n".join(
        f"{entry.get('description', '')}:\n{entry.get('value', '')}"
        for entry in entries
    )
    return f"{instructions}\n\nContext provided by the application:\n\n{shared}"
