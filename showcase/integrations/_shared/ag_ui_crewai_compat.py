"""Narrow compatibility fixes for the pinned CrewAI and AG-UI bridge."""

from __future__ import annotations

from functools import wraps
from importlib import import_module
from importlib.metadata import version as package_version
import os
from typing import Any

import ag_ui_crewai._hitl as bridge_hitl
import ag_ui_crewai.endpoint as bridge_endpoint
from crewai.events.listeners.tracing.first_time_trace_handler import FirstTimeTraceHandler
from crewai.events.listeners.tracing.trace_listener import TraceCollectionListener
from crewai.events.listeners.tracing.utils import (
    has_user_declined_tracing,
    is_tracing_enabled_in_context,
)
from fastapi import FastAPI
from starlette.types import ASGIApp, Receive, Scope, Send


_SUPPORTED_VERSION = "0.3.0"
_SUPPORTED_CREWAI_VERSION = "1.15.11"
_original_feedback_from_resume = bridge_hitl.feedback_from_resume
_original_trace_completion = FirstTimeTraceHandler.handle_execution_completion


def _finish_first_trace(self: FirstTimeTraceHandler) -> None:
    _original_trace_completion(self)
    if self.is_first_time and has_user_declined_tracing():
        self.is_first_time = False
        self.collected_events = False
        self._reset_batch_state()


def _collect_requested_traces(method: Any) -> Any:
    @wraps(method)
    def collect(self: TraceCollectionListener, *args: Any, **kwargs: Any) -> Any:
        # Listeners registered for first-use collection remain registered
        # after consent is declined. They must stop retaining disabled runs.
        if self.first_time_handler.is_first_time or is_tracing_enabled_in_context():
            return method(self, *args, **kwargs)
        return None

    return collect


_trace_methods = {
    name: _collect_requested_traces(getattr(TraceCollectionListener, name))
    for name in ("_initialize_batch", "_handle_trace_event", "_handle_action_event")
}


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
    """Bound runtime and declined-trace ownership for CrewAI 1.15.11 (PNI-649)."""
    installed_version = package_version("crewai")
    if installed_version != _SUPPORTED_CREWAI_VERSION:
        raise RuntimeError(
            "The memory compatibility shim supports crewai "
            f"{_SUPPORTED_CREWAI_VERSION}, but {installed_version} is installed. "
            "Revalidate upstream runtime and trace ownership before updating the pin."
        )

    FirstTimeTraceHandler.handle_execution_completion = _finish_first_trace
    for name, method in _trace_methods.items():
        setattr(TraceCollectionListener, name, method)

    listener = TraceCollectionListener()
    if (
        os.getenv("CREWAI_TRACING_ENABLED", "").lower() in ("false", "0")
        and listener.first_time_handler.is_first_time
        and not is_tracing_enabled_in_context()
    ):
        listener.first_time_handler.is_first_time = False
        listener.first_time_handler.collected_events = False
        listener.first_time_handler._reset_batch_state()

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
