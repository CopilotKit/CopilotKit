"""Request-scoped format for deterministic templates; inference stays in ADK.

The pinned published adapter is a compatibility baseline. Express remains
release-blocked until the adapter/toolkit (AG-UI PRs #3275/#3274) and renderer fixes
are published. Never silently run Direct JSON for an Express request.
"""

from contextvars import ContextVar

import ag_ui_adk
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

inference_format: ContextVar[str] = ContextVar(
    "a2ui_inference_format", default="express"
)
_A2UI_ROUTES = {"/declarative_gen_ui", "/a2ui_recovery", "/a2ui_fixed_schema"}


def validate_format(value: object) -> str:
    if value not in ("express", "direct_json"):
        raise ValueError("A2UI format must be express or direct_json")
    if value == "express" and not callable(
        getattr(ag_ui_adk, "compile_a2ui_express", None)
    ):
        raise RuntimeError(
            "A2UI Express is release-blocked: install the published adapter/toolkit "
            "releases containing AG-UI PRs #3275/#3274 and renderer PR #8120."
        )
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
        except RuntimeError as error:
            return JSONResponse({"error": str(error)}, status_code=503)
        token = inference_format.set(selected)
        try:
            return await call_next(request)
        finally:
            inference_format.reset(token)
