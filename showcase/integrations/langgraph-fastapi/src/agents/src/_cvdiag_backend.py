"""_cvdiag_backend.py — schema-v1 backend CVDIAG emitter for langgraph-fastapi.

This is the langgraph-fastapi realization of the §3 backend layer: it wires
the 11 backend boundaries through the shared ``_shared.cvdiag_bootstrap.emit_cvdiag``
single-source emitter. It is the middleware-style sibling of the langgraph-python
(LGP) emitter (same ``AgentMiddleware`` wrap path, different ``slug``). It runs
ALONGSIDE the legacy free-form ``_cvdiag()`` log lines in
``_header_forwarding_middleware.py`` (dual-emit during the transition):

  - legacy ``_cvdiag()`` keeps writing the human-grep ``CVDIAG component=...`` line,
  - this module writes the structured schema-v1 ``CVDIAG {json}`` envelope.

Guard: every emit here is gated on ``CVDIAG_BACKEND_EMITTER=1`` (default OFF). With
the guard off this module is a pure no-op — it never validates, never writes, never
throws into the observed boundary.

The 11 backend boundaries (spec §3 / §5):
  backend.request.ingress, backend.agent.enter, backend.llm.call.start,
  backend.llm.call.heartbeat (VERBOSE tier — periodic ~10s asyncio task),
  backend.llm.call.response, backend.sse.first_byte, backend.sse.event (DEBUG tier),
  backend.sse.aborted, backend.agent.exit, backend.response.complete,
  backend.error.caught.

Pure instrumentation: like the shared emitter, nothing here raises into the caller;
the one place we ``await`` (the heartbeat task) is cancelled cleanly in a finally.

Plan unit: L1-D3 (mirrors L1-I).
"""

from __future__ import annotations

import asyncio
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from _shared.cvdiag_bootstrap import _resolve_tier, current_tier, emit_cvdiag

# ── Tier gating ───────────────────────────────────────────────────────────────
# The shared bootstrap already resolved the tier (default | verbose | debug) and
# applied the §6 fail-closed DEBUG guard. We mirror the §6 tier matrix locally so
# VERBOSE-only (heartbeat) and DEBUG-only (sse.event) boundaries are suppressed at
# the wrong tier rather than relying on the consumer to filter.
_VERBOSE_TIERS = frozenset({"verbose", "debug"})
_DEBUG_TIERS = frozenset({"debug"})

_SLUG = "langgraph-fastapi"
_HEARTBEAT_INTERVAL_S = 10.0


def emitter_enabled() -> bool:
    """True when the schema-v1 backend emitter is armed (``CVDIAG_BACKEND_EMITTER=1``).

    Default OFF: a missing/any-other value disables every emit in this module.
    """
    return os.environ.get("CVDIAG_BACKEND_EMITTER") == "1"


def _active_tier() -> str:
    """Resolve the verbosity tier from a LIVE env read.

    ``emitter_enabled()`` reads ``CVDIAG_BACKEND_EMITTER`` live, so the tier MUST
    be read from the same live source — otherwise flipping ``CVDIAG_VERBOSE`` /
    ``CVDIAG_DEBUG`` AFTER import arms the emitter but the tier stays frozen at
    the import-time ``setup()`` value, silently no-op'ing every verbose/debug-
    gated boundary (heartbeat, sse.event). We reuse the bootstrap's
    ``_resolve_tier`` so the §6 fail-closed DEBUG guard still applies (a
    production / unresolved DEBUG request raises → degrade to the frozen tier).
    """
    try:
        return _resolve_tier(dict(os.environ))
    except RuntimeError:
        # Fail-closed DEBUG refusal: fall back to the import-time resolved tier
        # (never silently escalate to debug in production).
        return current_tier()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _mono_ns() -> int:
    return time.monotonic_ns()


def _span_id() -> str:
    """16 hex chars (8 random bytes) — matches SPAN_ID_PATTERN."""
    return uuid.uuid4().hex[:16]


def _coerce_test_id(raw: Optional[str]) -> str:
    """Return a schema-valid UUIDv7 ``test_id``.

    When the inbound header carries a valid UUIDv7 we keep it (this is the
    propagation we are measuring). When it is absent/malformed we synthesize a
    deterministic-shape UUIDv7 so the envelope still validates — but the
    propagation gate measures the *inbound* presence, not this fallback.
    """
    from _shared.cvdiag_schema import (
        TEST_ID_PATTERN,
    )  # local import: cheap, avoids cycle
    import re

    if isinstance(raw, str) and re.match(TEST_ID_PATTERN, raw):
        return raw
    # Synthesize a UUIDv7-shaped value (version nibble 7, variant 8..b).
    hexs = uuid.uuid4().hex
    return f"{hexs[0:8]}-{hexs[8:12]}-7{hexs[13:16]}-8{hexs[17:20]}-{hexs[20:32]}"


def extract_test_id(headers: Dict[str, str]) -> Optional[str]:
    """Return the inbound ``x-test-id`` header value, or ``None`` when absent.

    This is the raw inbound value used by the propagation-reliability gate — it
    is NOT coerced/synthesized here so the gate can measure true propagation.
    """
    raw = headers.get("x-test-id")
    return raw if isinstance(raw, str) and raw else None


def _empty_edge_headers() -> Dict[str, Any]:
    return {
        "cf-ray": None,
        "cf-mitigated": None,
        "cf-cache-status": None,
        "x-railway-edge": None,
        "x-railway-request-id": None,
        "x-hikari-trace": None,
        "retry-after": None,
        "via": None,
        "server": None,
    }


def _edge_headers_from(headers: Dict[str, str]) -> Dict[str, Any]:
    """Project the inbound header bag onto the closed 9-key edge-header shape.

    Only the 9 allow-listed keys are carried; everything else is dropped (the
    envelope's per-boundary model + EdgeHeaders ``extra=forbid`` enforce this).
    """
    allow = _empty_edge_headers()
    for key in list(allow.keys()):
        val = headers.get(key)
        if isinstance(val, str) and val:
            allow[key] = val
    return allow


def _emit(
    boundary: str,
    *,
    headers: Dict[str, str],
    trace_id: str,
    outcome: str = "ok",
    metadata: Optional[Dict[str, Any]] = None,
    duration_ms: Optional[int] = None,
    demo: str = "chat",
    tier_gate: Optional[frozenset] = None,
) -> None:
    """Build + emit one schema-v1 envelope, guarded + tier-filtered.

    No-op when the emitter is disabled OR the boundary's tier gate excludes the
    resolved tier. Never raises (delegates to the shared emitter's safety).
    """
    if not emitter_enabled():
        return
    if tier_gate is not None and _active_tier() not in tier_gate:
        return
    envelope = {
        "schema_version": 1,
        "test_id": _coerce_test_id(headers.get("x-test-id")),
        "trace_id": trace_id,
        "span_id": _span_id(),
        "parent_span_id": None,
        "layer": "backend",
        "boundary": boundary,
        "slug": _SLUG,
        "demo": demo,
        "ts": _now_iso(),
        "mono_ns": _mono_ns(),
        "duration_ms": duration_ms,
        "outcome": outcome,
        "edge_headers": _edge_headers_from(headers),
        "metadata": metadata or {},
    }
    emit_cvdiag(envelope)


class CvdiagBackendRun:
    """Per-model-call CVDIAG run context for the LGP middleware.

    Constructed inside ``awrap_model_call`` (and the sync ``wrap_model_call``);
    owns the trace correlation id, the ingress monotonic anchor, and the
    heartbeat asyncio task. All methods are no-ops when the emitter is disabled.
    """

    def __init__(self, headers: Dict[str, str]) -> None:
        self._headers = dict(headers)
        # Correlate every boundary in this run under one trace_id. Prefer the
        # inbound x-diag-run-id breadcrumb so probe/backend rows join; fall back
        # to a synthesized id.
        self._trace_id = (
            headers.get("x-diag-run-id") or headers.get("x-test-id") or uuid.uuid4().hex
        )
        self._ingress_mono = _mono_ns()
        self._first_byte_emitted = False
        self._sse_seq = 0
        self._heartbeat_task: Optional[asyncio.Task] = None

    # ── Lifecycle boundaries ──────────────────────────────────────────────
    def request_ingress(self) -> None:
        _emit(
            "backend.request.ingress",
            headers=self._headers,
            trace_id=self._trace_id,
            metadata={"method": "POST", "path": "/threads", "content_length": None},
            tier_gate=_VERBOSE_TIERS,
        )

    def agent_enter(
        self, agent_name: Optional[str] = None, model_id: Optional[str] = None
    ) -> None:
        _emit(
            "backend.agent.enter",
            headers=self._headers,
            trace_id=self._trace_id,
            metadata={"agent_name": agent_name, "model_id": model_id},
        )

    def llm_call_start(
        self, provider: Optional[str] = None, model: Optional[str] = None
    ) -> None:
        _emit(
            "backend.llm.call.start",
            headers=self._headers,
            trace_id=self._trace_id,
            metadata={
                "provider": provider,
                "model": model,
                "prompt_token_count_estimate": None,
            },
            tier_gate=_VERBOSE_TIERS,
        )

    def llm_call_response(
        self,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        latency_ms: Optional[int] = None,
        error_class: Optional[str] = None,
    ) -> None:
        _emit(
            "backend.llm.call.response",
            headers=self._headers,
            trace_id=self._trace_id,
            outcome="err" if error_class else "ok",
            metadata={
                "provider": provider,
                "model": model,
                "response_token_count": None,
                "latency_ms": latency_ms,
                "error_class": error_class,
            },
            tier_gate=_VERBOSE_TIERS,
        )

    def sse_first_byte(self) -> None:
        """Emit ``backend.sse.first_byte`` once, with the ingress→first-byte delta."""
        if self._first_byte_emitted:
            return
        self._first_byte_emitted = True
        delta_ms = int((_mono_ns() - self._ingress_mono) / 1_000_000)
        _emit(
            "backend.sse.first_byte",
            headers=self._headers,
            trace_id=self._trace_id,
            metadata={"delta_ms_from_ingress": delta_ms},
            tier_gate=_VERBOSE_TIERS,
        )

    def sse_event(
        self, event_type: Optional[str] = None, payload_size_bytes: Optional[int] = None
    ) -> None:
        """Emit ``backend.sse.event`` (DEBUG tier — suppressed below debug)."""
        self._sse_seq += 1
        _emit(
            "backend.sse.event",
            headers=self._headers,
            trace_id=self._trace_id,
            metadata={
                "event_type": event_type,
                "payload_size_bytes": payload_size_bytes,
                "sequence_num": self._sse_seq,
            },
            tier_gate=_DEBUG_TIERS,
        )

    def sse_aborted(
        self,
        termination_kind: Optional[str] = None,
        bytes_before_abort: Optional[int] = None,
    ) -> None:
        _emit(
            "backend.sse.aborted",
            headers=self._headers,
            trace_id=self._trace_id,
            outcome="err",
            metadata={
                "termination_kind": termination_kind,
                "bytes_before_abort": bytes_before_abort,
            },
        )

    def agent_exit(self, terminal_outcome: str = "ok") -> None:
        total_ms = int((_mono_ns() - self._ingress_mono) / 1_000_000)
        _emit(
            "backend.agent.exit",
            headers=self._headers,
            trace_id=self._trace_id,
            outcome="err" if terminal_outcome == "err" else "ok",
            metadata={
                "terminal_outcome": terminal_outcome,
                "total_duration_ms": total_ms,
            },
        )

    def response_complete(
        self,
        http_status: Optional[int] = 200,
        sse_event_count: Optional[int] = None,
    ) -> None:
        total_ms = int((_mono_ns() - self._ingress_mono) / 1_000_000)
        _emit(
            "backend.response.complete",
            headers=self._headers,
            trace_id=self._trace_id,
            metadata={
                "http_status": http_status,
                "content_length": None,
                "total_duration_ms": total_ms,
                "sse_event_count": sse_event_count
                if sse_event_count is not None
                else self._sse_seq,
            },
        )

    def error_caught(self, exc: BaseException) -> None:
        _emit(
            "backend.error.caught",
            headers=self._headers,
            trace_id=self._trace_id,
            outcome="err",
            metadata={
                "exception_type": type(exc).__name__,
                "message_scrubbed": "<scrubbed>",
                "stack_brief": None,
                "truncated": False,
            },
        )

    # ── Heartbeat (VERBOSE tier — periodic asyncio task) ──────────────────
    async def _heartbeat_loop(self) -> None:
        """Emit ``backend.llm.call.heartbeat`` every ~10s while the LLM call runs."""
        try:
            while True:
                await asyncio.sleep(_HEARTBEAT_INTERVAL_S)
                elapsed_ms = int((_mono_ns() - self._ingress_mono) / 1_000_000)
                _emit(
                    "backend.llm.call.heartbeat",
                    headers=self._headers,
                    trace_id=self._trace_id,
                    outcome="info",
                    metadata={"elapsed_ms_since_start": elapsed_ms},
                    tier_gate=_VERBOSE_TIERS,
                )
        except asyncio.CancelledError:
            # Clean cancellation when the LLM call finishes — swallow.
            return

    def start_heartbeat(self) -> None:
        """Arm the heartbeat task (no-op when disabled or below VERBOSE tier)."""
        if not emitter_enabled() or _active_tier() not in _VERBOSE_TIERS:
            return
        if self._heartbeat_task is not None:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        self._heartbeat_task = loop.create_task(self._heartbeat_loop())

    async def stop_heartbeat(self) -> None:
        """Cancel + await the heartbeat task. Safe to call when never started.

        Cooperative cancellation: the legacy ``except (CancelledError,
        Exception)`` swallowed the CALLER's CancelledError, breaking cooperative
        cancellation (a client-disconnect / request-cancel that arrives while we
        await the heartbeat task would be lost). We suppress ONLY the heartbeat
        task's OWN cancellation — the one we just requested — and re-raise when
        THIS task is being cancelled by the caller (a pending cancellation
        request, ``current_task().cancelling() > 0``). ``Task.cancelling()`` is
        3.11+ (production runs 3.12); on older runtimes the attribute is absent
        and we degrade to suppressing (the legacy behavior).
        """
        task = self._heartbeat_task
        if task is None:
            return
        self._heartbeat_task = None
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            current = asyncio.current_task()
            cancelling = getattr(current, "cancelling", None)
            if current is not None and cancelling is not None and cancelling() > 0:
                raise
        except Exception:  # noqa: BLE001 - heartbeat body must never throw out
            return

    def emit_heartbeat_once(self) -> None:
        """Synchronous single heartbeat emit (used by the sync wrap path + tests)."""
        elapsed_ms = int((_mono_ns() - self._ingress_mono) / 1_000_000)
        _emit(
            "backend.llm.call.heartbeat",
            headers=self._headers,
            trace_id=self._trace_id,
            outcome="info",
            metadata={"elapsed_ms_since_start": elapsed_ms},
            tier_gate=_VERBOSE_TIERS,
        )
