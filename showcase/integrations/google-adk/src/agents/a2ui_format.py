"""Request-scoped format for deterministic templates; inference stays in ADK.

Never silently run Direct JSON for an Express request.
"""

from contextvars import ContextVar

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

inference_format: ContextVar[str] = ContextVar(
    "a2ui_inference_format", default="express"
)
_A2UI_ROUTES = {"/declarative_gen_ui", "/a2ui_recovery", "/a2ui_fixed_schema"}


def validate_format(value: object) -> str:
    if value not in ("express", "direct_json"):
        raise ValueError("A2UI format must be express or direct_json")
    return str(value)


class A2UIFormatMiddleware(BaseHTTPMiddleware):
    """Keep fixed-template selection local to each request, including overlaps."""

    async def dispatch(self, request, call_next):
        if request.method != "POST" or request.url.path not in _A2UI_ROUTES:
            return await call_next(request)
        try:
            body = await request.json()
            if not isinstance(body, dict):
                raise ValueError("AG-UI input must be an object")
            props = body.get("forwardedProps", {})
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
