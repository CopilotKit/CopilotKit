"""Request-scoped format for deterministic templates; inference stays in ADK.

Never silently run Direct JSON for an Express request.
"""

from contextvars import ContextVar

from ag_ui_adk.a2ui_tool import validate_inference_format as validate_format
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from starlette.types import ASGIApp

inference_format: ContextVar[str] = ContextVar(
    "a2ui_inference_format", default="express"
)


class A2UIFormatMiddleware(BaseHTTPMiddleware):
    """Keep fixed-template selection local to each request, including overlaps."""

    def __init__(self, app: ASGIApp, *, routes: set[str]):
        super().__init__(app)
        self._routes = frozenset(routes)

    async def dispatch(self, request, call_next):
        if request.method != "POST" or request.url.path not in self._routes:
            return await call_next(request)
        try:
            body = await request.json()
            if not isinstance(body, dict):
                raise ValueError("AG-UI input must be an object")
            props = body.get("forwardedProps")
            if props is None:
                props = {}
            if not isinstance(props, dict):
                raise ValueError("forwardedProps must be an object")
            config = props.get("a2ui", {})
            if not isinstance(config, dict):
                raise ValueError("forwardedProps.a2ui must be an object")
            selected = validate_format(config.get("inferenceFormat", "express"))
        except ValueError as error:
            return JSONResponse({"error": str(error)}, status_code=400)
        token = inference_format.set(selected)
        try:
            return await call_next(request)
        finally:
            inference_format.reset(token)
