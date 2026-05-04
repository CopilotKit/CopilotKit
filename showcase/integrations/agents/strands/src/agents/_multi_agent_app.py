"""Multi-agent FastAPI factory for Strands showcase."""

from typing import Callable, Mapping

from fastapi import FastAPI
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse


class _HealthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.url.path == "/health" and request.method == "GET":
            return JSONResponse({"status": "ok"})
        return await call_next(request)


def create_multi_agent_strands_app(
    factories: Mapping[str, Callable[[], object]],
    *,
    create_strands_app: Callable[[object, str], FastAPI] | None = None,
) -> FastAPI:
    """Build a FastAPI app with one Strands sub-app mounted per demo id.

    Args:
        factories: dict from canonical kebab demo id to a zero-arg callable
            returning a configured StrandsAgent.
        create_strands_app: Override for ag_ui_strands.create_strands_app.
            Default imports the real function lazily (so tests can stub).

    Returns:
        FastAPI app that:
          - serves GET /health -> {"status": "ok"}
          - mounts each factory's sub-app at /<demo-id>/
    """
    if create_strands_app is None:
        from ag_ui_strands import create_strands_app as _real
        create_strands_app = _real

    app = FastAPI()
    app.add_middleware(_HealthMiddleware)

    for demo_id, factory in factories.items():
        agent = factory()
        sub_app = create_strands_app(agent, "/")
        app.mount(f"/{demo_id}", sub_app)

    return app
