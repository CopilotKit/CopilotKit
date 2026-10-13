"""Narrow compatibility fixes for the pinned AG-UI CrewAI bridge."""

from __future__ import annotations

from importlib import import_module
from importlib.metadata import version as package_version
from typing import Any

import ag_ui_crewai._hitl as bridge_hitl
import ag_ui_crewai.endpoint as bridge_endpoint
from fastapi import FastAPI
from starlette.types import ASGIApp, Receive, Scope, Send


_SUPPORTED_VERSION = "0.3.0"
_SUPPORTED_CREWAI_VERSION = "1.15.11"
_original_feedback_from_resume = bridge_hitl.feedback_from_resume


class _CrewAIRuntimeMiddleware:
    """Keep import-time runtime owners out of HTTP request contexts."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        bus = import_module("crewai.events.event_bus")
        self.variables = (
            (bus._runtime_state_var, None),
            (bus._registered_entity_ids_var, None),
            (bus._runtime_scope_depth, 0),
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # CrewAI clears its kickoff task's binding, but that does not detach
        # the mutable RuntimeState inherited from server/template startup.
        # Pure ASGI middleware keeps this boundary around the entire SSE body.
        tokens = [(variable, variable.set(value)) for variable, value in self.variables]
        try:
            await self.app(scope, receive, send)
        finally:
            for variable, token in reversed(tokens):
                variable.reset(token)


def install_memory_compat(app: FastAPI) -> None:
    """Isolate request ownership for the pinned CrewAI runtime (PNI-649)."""
    installed_version = package_version("crewai")
    if installed_version != _SUPPORTED_CREWAI_VERSION:
        raise RuntimeError(
            "The memory compatibility shim supports crewai "
            f"{_SUPPORTED_CREWAI_VERSION}, but {installed_version} is installed. "
            "Revalidate upstream runtime ownership before updating the pin."
        )

    if not any(
        middleware.cls is _CrewAIRuntimeMiddleware for middleware in app.user_middleware
    ):
        app.add_middleware(_CrewAIRuntimeMiddleware)


def _feedback_from_resume(input_data: Any) -> tuple[str, str | None]:
    feedback, interrupt_id = _original_feedback_from_resume(input_data)
    entries = list(getattr(input_data, "resume", None) or [])
    if entries:
        entry = entries[0]
        if (
            getattr(entry, "status", None) == "resolved"
            and getattr(entry, "payload", None) is None
        ):
            # ag-ui-crewai 0.3.0 otherwise maps this and cancellation to "".
            # JSON null keeps CrewAI's string feedback API unambiguous.
            feedback = "null"
    return feedback, interrupt_id


def install_resume_status_compat() -> None:
    """Preserve resolved-null status until the bridge exposes it natively."""

    installed_version = package_version("ag-ui-crewai")
    if installed_version != _SUPPORTED_VERSION:
        raise RuntimeError(
            "The resume-status compatibility shim supports ag-ui-crewai "
            f"{_SUPPORTED_VERSION}, but {installed_version} is installed. "
            "Revalidate the upstream resume mapping before updating the pin."
        )

    # The endpoint module captured the private helper at import time, so both
    # bindings must point at the same version-scoped wrapper.
    bridge_hitl.feedback_from_resume = _feedback_from_resume
    bridge_endpoint.feedback_from_resume = _feedback_from_resume
