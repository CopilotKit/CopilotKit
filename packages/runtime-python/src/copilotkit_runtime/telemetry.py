"""Host-owned OpenTelemetry tracing and a sanitized optional event sink."""

import inspect
import logging
import os
import time
from collections.abc import Awaitable, Callable
from typing import Any

from opentelemetry import metrics, trace

EventSink = Callable[[dict[str, Any]], Awaitable[None] | None]
_SAFE = {"operation", "status", "duration_ms", "attempt", "event_count", "queue_depth", "outcome"}


class Telemetry:
    """Emit bounded operational metadata; payloads, IDs and keys are excluded."""

    def __init__(self, enabled: bool = True, sink: EventSink | None = None) -> None:
        self.enabled = enabled and not any(
            os.getenv(key, "").lower() in ("true", "1")
            for key in ("DO_NOT_TRACK", "COPILOTKIT_TELEMETRY_DISABLED")
        )
        self.sink = sink
        self.tracer = trace.get_tracer("copilotkit.runtime.python", "0.1.0")
        meter = metrics.get_meter("copilotkit.runtime.python", "0.1.0")
        self.count = meter.create_counter("copilotkit.runtime.operations")
        self.duration = meter.create_histogram("copilotkit.runtime.duration", unit="ms")

    async def emit(self, name: str, **attributes: Any) -> None:
        """Export only allowlisted attributes; exporter failures do not stop runs."""
        if not self.enabled:
            return
        safe = {key: value for key, value in attributes.items() if key in _SAFE}
        self.count.add(1, {"event": name})
        if "duration_ms" in safe:
            self.duration.record(safe["duration_ms"], {"event": name})
        if self.sink:
            try:
                result = self.sink(
                    {
                        "event": name,
                        "properties": safe,
                        "ts": int(time.time() * 1000),
                        "package": {"name": "copilotkit-intelligence-runtime", "version": "0.1.0"},
                        "global_properties": {"runtime_language": "python"},
                    }
                )
                if inspect.isawaitable(result):
                    await result
            except Exception:
                logging.getLogger(__name__).warning("Runtime telemetry sink failed")
