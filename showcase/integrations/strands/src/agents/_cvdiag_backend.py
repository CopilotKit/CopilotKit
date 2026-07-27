"""_cvdiag_backend.py — backend-layer CVDIAG boundary instrumentation.

This module wires the spec §3 / §5 **11 backend boundaries** into a Python
showcase integration, emitting schema-v1 CVDIAG envelopes through the shared
``_shared.cvdiag_bootstrap.emit_cvdiag`` sink. It is the per-integration
companion to the header-forwarding shim (``_header_forwarding.py``): that file
forwards correlation headers onto outbound LLM calls and logs lightweight
``CVDIAG component=backend-<fw> boundary=...`` breadcrumbs; THIS file emits the
full structured ``CVDIAG {<json>}`` envelopes the harness/classifier consume.

The 11 backend boundaries (spec §5 / §6 tier matrix):

  1. ``backend.request.ingress``    — HTTP request received (default)
  2. ``backend.agent.enter``        — agent loop entered (default)
  3. ``backend.llm.call.start``     — outbound LLM call dispatched (verbose)
  4. ``backend.llm.call.heartbeat`` — fires ~10s while an LLM call is
                                       outstanding (verbose)
  5. ``backend.llm.call.response``  — LLM response received (verbose)
  6. ``backend.sse.first_byte``     — first SSE byte written (verbose)
  7. ``backend.sse.event``          — every SSE event written (debug)
  8. ``backend.sse.aborted``        — stream terminated abnormally (default)
  9. ``backend.agent.exit``         — agent loop exited (default)
 10. ``backend.response.complete``  — HTTP response stream closed (default)
 11. ``backend.error.caught``       — exception caught in the agent loop
                                       (default)

Guarding
--------
ALL emission is gated behind the ``CVDIAG_BACKEND_EMITTER`` env flag, default
OFF. With the flag off this module is byte-for-byte inert — no envelope is
built, no stdout line is written, the middleware passes the request straight
through. This is the canary-safe default: the flag is flipped ON only after a
deploy is confirmed healthy.

Tier gating
-----------
Each boundary carries a tier per the §6 matrix. ``_shared.cvdiag_bootstrap``
resolves the active tier (default | verbose | debug) once at import; this
module suppresses a boundary whose tier exceeds the active tier so the
default-tier production emit stays within the §7 event-count budget.

Pure instrumentation
--------------------
Nothing here may throw into the request path. ``emit_cvdiag`` already swallows
its own errors; the helpers below additionally guard envelope construction so a
malformed metadata bag degrades to a dropped emit, never a 500.

Plan unit: L1-C.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import secrets
import time
import uuid
from typing import Any, Dict, Optional

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from _shared.cvdiag_bootstrap import _resolve_tier, current_tier, emit_cvdiag

logger = logging.getLogger(__name__)

# Framework tag — mirrors ``_header_forwarding._CVDIAG_FRAMEWORK`` so the
# structured envelopes and the breadcrumb log lines agree on the integration
# identity. (L1-D: change this single constant when copying to a sibling.)
_CVDIAG_FRAMEWORK = "strands"

# ── Env gate ─────────────────────────────────────────────────────────────────

_BACKEND_EMITTER_ENV = "CVDIAG_BACKEND_EMITTER"


def cvdiag_backend_enabled() -> bool:
    """True iff the backend emitter is explicitly enabled (default OFF).

    Read live (not cached) so a test can toggle the env var per-case via
    ``monkeypatch.setenv``; the cost is one ``os.environ`` lookup per emit,
    which is negligible against the JSON serialization that follows.
    """
    return os.environ.get(_BACKEND_EMITTER_ENV) == "1"


# ── Tier ordering (spec §6) ────────────────────────────────────────────────

_TIER_RANK = {"default": 0, "verbose": 1, "debug": 2}

# Per-boundary minimum tier required to emit (spec §6 matrix, backend rows).
_BOUNDARY_TIER: Dict[str, str] = {
    "backend.request.ingress": "verbose",
    "backend.agent.enter": "default",
    "backend.llm.call.start": "verbose",
    "backend.llm.call.heartbeat": "verbose",
    "backend.llm.call.response": "verbose",
    "backend.sse.first_byte": "verbose",
    "backend.sse.event": "debug",
    "backend.sse.aborted": "default",
    "backend.agent.exit": "default",
    "backend.response.complete": "default",
    "backend.error.caught": "default",
}


def _active_tier() -> str:
    """Resolve the verbosity tier from a LIVE env read.

    ``cvdiag_backend_enabled()`` reads ``CVDIAG_BACKEND_EMITTER`` live, so the
    tier MUST be read from the same live source — otherwise flipping
    ``CVDIAG_VERBOSE`` / ``CVDIAG_DEBUG`` AFTER import arms the emitter but the
    tier stays frozen at the import-time ``setup()`` value, silently no-op'ing
    every verbose/debug-gated boundary. We reuse the bootstrap's
    ``_resolve_tier`` so the §6 fail-closed DEBUG guard still applies (a
    production / unresolved DEBUG request raises → degrade to the frozen tier).
    """
    try:
        return _resolve_tier(dict(os.environ))
    except RuntimeError:
        # Fail-closed DEBUG refusal: fall back to the import-time resolved tier
        # (never silently escalate to debug in production).
        return current_tier()


def _tier_permits(boundary: str) -> bool:
    """True iff the active tier is at-or-above the boundary's minimum tier."""
    need = _TIER_RANK.get(_BOUNDARY_TIER.get(boundary, "default"), 0)
    have = _TIER_RANK.get(_active_tier(), 0)
    return have >= need


# ── Edge headers (spec §5 — 9-key allow-list + 12-name deny-list) ───────────

# The closed 9-key edge-header allow-list. Always-present in the envelope;
# absent header → ``None``.
_EDGE_ALLOW = (
    "cf-ray",
    "cf-mitigated",
    "cf-cache-status",
    "x-railway-edge",
    "x-railway-request-id",
    "x-hikari-trace",
    "retry-after",
    "via",
    "server",
)

# Exact-match deny-list (spec §5). REJECTED even if accidentally present in the
# allow-list — these carry client IP / geo PII and must never round-trip.
_EDGE_DENY = frozenset(
    {
        "cf-ipcountry",
        "cf-connecting-ip",
        "cf-ipcity",
        "cf-iplatitude",
        "cf-iplongitude",
        "cf-iptimezone",
        "cf-visitor",
        "cf-worker",
        "true-client-ip",
        "x-forwarded-for",
        "x-real-ip",
        "forwarded",
    }
)


def extract_edge_headers(headers: Any) -> Dict[str, Optional[str]]:
    """Build the closed 9-key ``edge_headers`` bag from a headers mapping.

    All nine keys are ALWAYS present; an absent (or deny-listed) header maps to
    ``None``. ``headers`` is any case-insensitive mapping exposing ``.get`` /
    iteration of ``(name, value)`` pairs (Starlette ``Headers``, httpx, dict).
    """
    bag: Dict[str, Optional[str]] = {k: None for k in _EDGE_ALLOW}
    if headers is None:
        return bag
    try:
        getter = headers.get
    except AttributeError:
        return bag
    for key in _EDGE_ALLOW:
        if key in _EDGE_DENY:  # belt-and-braces: never emit a deny-listed key
            continue
        val = getter(key)
        if val is not None:
            bag[key] = str(val)
    return bag


# ── PII scrub (spec §6) ──────────────────────────────────────────────────────

# Bearer tokens, OpenAI/Stripe-style secret keys, publishable keys, and URL
# userinfo. Applied to any captured free-text metadata value
# (``message_scrubbed``, stack frames) before it is emitted. The ``sk-``/``pk-``
# key bodies allow hyphens/underscores so test-style keys such as the spec
# regression fixture ``sk-test-12345`` are redacted alongside real production
# keys (``sk-<48+ base62>``).
#
# Parity with the canonical TS scrubber (``harness/src/cvdiag/scrub.ts``):
#   * Bearer — grabs the WHOLE token (``\S+``) to match TS ``Bearer\s+\S+``;
#     the legacy ``[A-Za-z0-9._\-]+`` stopped at ``/``/``+``/``=`` and left an
#     un-redacted JWT tail (e.g. ``Bearer a.b.c/sig+more=`` → ``…/sig+more=``).
#   * URL userinfo — redacts BOTH ``scheme://user:pw@host`` AND colon-less
#     ``scheme://token@host`` (TS ``([scheme]://)[^/\s?#]*@``); the legacy
#     ``[^/\s:@]+:[^/\s@]+@`` required a mandatory ``:`` so a bare-token
#     authority such as ``https://ghp_xxx@host`` LEAKED. The userinfo class
#     excludes ``?``/``#`` so the match never crosses into the query/fragment.
_SCRUB_PATTERNS = (
    re.compile(r"Bearer\s+\S+", re.IGNORECASE),
    re.compile(r"\bsk-[A-Za-z0-9][A-Za-z0-9_-]{3,}"),
    re.compile(r"\bpk-[A-Za-z0-9][A-Za-z0-9_-]{3,}"),
    re.compile(r"(?P<scheme>[a-z][a-z0-9+.\-]*://)[^/\s?#]*@", re.IGNORECASE),
)

# Per-event field byte caps (spec §5). message_scrubbed ≤512B.
_MESSAGE_CAP = 512

# Hard input-size guard (mirrors TS ``SCRUB_MAX_SCAN_LEN``): no regex ever runs
# on a string longer than this. A longer value has only its bounded prefix
# scanned and a self-describing ``…[unscanned:<N>]`` marker records the dropped
# tail length, so an adversarial multi-KB string can never make the regex
# engine scan unbounded input. 2 KB covers any legitimate metadata value with
# headroom. Set below the byte cap so the marker survives the §5 byte clamp.
_SCRUB_MAX_SCAN_LEN = 400


def _run_scrub_regexes(s: str) -> str:
    """Apply the secret regexes in sequence (TS ``runScrubRegexes`` parity)."""
    for pat in _SCRUB_PATTERNS:
        if pat.groupindex.get("scheme"):
            s = pat.sub(r"\g<scheme>[REDACTED]@", s)
        else:
            s = pat.sub("[REDACTED]", s)
    return s


def scrub(text: Any) -> str:
    """Redact secrets from a free-text value and cap it at 512 bytes.

    Returns ``"[REDACTED]"`` substitutions for any matched secret pattern so a
    synthetic ``sk-test-12345`` in an exception message can never reach the
    emitted envelope. A value longer than ``_SCRUB_MAX_SCAN_LEN`` has only its
    bounded prefix scanned, with an ``…[unscanned:<N>]`` marker (TS parity).
    """
    if text is None:
        return ""
    s = str(text)
    if len(s) > _SCRUB_MAX_SCAN_LEN:
        dropped_tail = len(s) - _SCRUB_MAX_SCAN_LEN
        s = f"{_run_scrub_regexes(s[:_SCRUB_MAX_SCAN_LEN])}…[unscanned:{dropped_tail}]"
    else:
        s = _run_scrub_regexes(s)
    encoded = s.encode("utf-8")
    if len(encoded) > _MESSAGE_CAP:
        s = encoded[:_MESSAGE_CAP].decode("utf-8", errors="ignore")
    return s


# ── Envelope construction ──────────────────────────────────────────────────

_TEST_ID_HEADER = "x-test-id"
_AIMOCK_CONTEXT_HEADER = "x-aimock-context"
# UUIDv7 variant/version nibbles (RFC 9562) the schema regex requires.
_SLUG_FALLBACK = "unknown"
_DEMO_FALLBACK = "default"


def _uuid7() -> str:
    """Generate a lowercase-hyphenated UUIDv7 (RFC 9562) string.

    48-bit Unix-ms timestamp, version nibble 7, variant 10 — matches the
    schema ``TEST_ID_PATTERN``. Used as the fallback ``test_id`` when no
    inbound ``x-test-id`` correlation header is present.
    """
    unix_ms = int(time.time() * 1000) & ((1 << 48) - 1)
    rand_a = secrets.randbits(12)
    rand_b = secrets.randbits(62)
    msb = (unix_ms << 16) | (0x7 << 12) | rand_a
    lsb = (0b10 << 62) | rand_b
    return str(uuid.UUID(int=(msb << 64) | lsb))


_UUID7_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)


def normalize_test_id(raw: Optional[str]) -> str:
    """Return a schema-valid lowercased UUIDv7, minting one if ``raw`` is
    absent or not a well-formed UUIDv7."""
    if raw:
        candidate = raw.strip().lower()
        if _UUID7_RE.match(candidate):
            return candidate
    return _uuid7()


def _span_id() -> str:
    """16-hex span id, unique per emit (schema ``SPAN_ID_PATTERN``)."""
    return secrets.token_hex(8)


_SLUG_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")


def _normalize_slug(raw: Optional[str]) -> str:
    """Coerce the inbound ``x-aimock-context`` slug into the closed slug shape
    (``^[a-z][a-z0-9-]{0,63}$``), falling back to ``unknown`` when unusable."""
    if raw:
        candidate = raw.strip().lower()
        if _SLUG_RE.match(candidate):
            return candidate
    return _SLUG_FALLBACK


def build_envelope(
    *,
    boundary: str,
    outcome: str,
    test_id: str,
    slug: str,
    demo: str,
    metadata: Optional[Dict[str, Any]] = None,
    edge_headers: Optional[Dict[str, Optional[str]]] = None,
    duration_ms: Optional[int] = None,
    parent_span_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Assemble a schema-v1 backend envelope (``layer=backend``).

    All envelope-required fields are populated; ``edge_headers`` defaults to the
    closed 9-key all-null bag when not supplied. ``metadata`` is passed through
    verbatim — unknown keys are stamped ``_metadata_dropped`` by the schema
    validator inside ``emit_cvdiag``.
    """
    return {
        "schema_version": 1,
        "test_id": test_id,
        "trace_id": test_id,
        "span_id": _span_id(),
        "parent_span_id": parent_span_id,
        "layer": "backend",
        "boundary": boundary,
        "slug": slug,
        "demo": demo,
        "ts": _now_iso(),
        "mono_ns": time.monotonic_ns(),
        "duration_ms": duration_ms,
        "outcome": outcome,
        "edge_headers": edge_headers or {k: None for k in _EDGE_ALLOW},
        "metadata": metadata or {},
    }


def _now_iso() -> str:
    """ISO-8601 millisecond-precision timestamp with a ``Z`` suffix."""
    # ``time.gmtime`` + manual ms keeps this dependency-free and 3.9-safe.
    now = time.time()
    secs = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(now))
    ms = int((now - int(now)) * 1000)
    return f"{secs}.{ms:03d}Z"


def emit_backend_boundary(
    boundary: str,
    *,
    outcome: str = "info",
    test_id: str,
    slug: str,
    demo: str,
    metadata: Optional[Dict[str, Any]] = None,
    edge_headers: Optional[Dict[str, Optional[str]]] = None,
    duration_ms: Optional[int] = None,
    parent_span_id: Optional[str] = None,
) -> None:
    """Emit one backend boundary envelope, honoring the env gate + tier matrix.

    No-op when the emitter is disabled or the active tier does not permit this
    boundary. Never raises into the caller.
    """
    if not cvdiag_backend_enabled():
        return
    if not _tier_permits(boundary):
        return
    try:
        envelope = build_envelope(
            boundary=boundary,
            outcome=outcome,
            test_id=test_id,
            slug=slug,
            demo=demo,
            metadata=metadata,
            edge_headers=edge_headers,
            duration_ms=duration_ms,
            parent_span_id=parent_span_id,
        )
        emit_cvdiag(envelope)
    except Exception as err:  # noqa: BLE001 - instrumentation must not throw
        logger.warning("CVDIAG backend emit-failed boundary=%s error=%s", boundary, err)


# ── Per-request correlation context ─────────────────────────────────────────


class _RequestCtx:
    """Holds the per-request correlation identity + timing the boundaries share.

    Carried on ``request.state`` so the middleware, the LLM hook, and the agent
    hooks all stamp the same ``test_id`` / ``slug`` / ``demo`` onto their
    envelopes.
    """

    __slots__ = (
        "test_id",
        "slug",
        "demo",
        "ingress_mono_ns",
        "sse_seq",
        "first_byte_emitted",
        "bytes_streamed",
    )

    def __init__(self, *, test_id: str, slug: str, demo: str) -> None:
        self.test_id = test_id
        self.slug = slug
        self.demo = demo
        self.ingress_mono_ns = time.monotonic_ns()
        self.sse_seq = 0
        self.first_byte_emitted = False
        self.bytes_streamed = 0


def _demo_from_path(path: str) -> str:
    """Derive the ``demo`` label from the mounted sub-app path.

    Each demo is mounted at ``/<demo>`` (e.g. ``/voice``, ``/byoc-hashbrown``);
    the root agent serves the default demo. Strip the leading slash and any
    trailing AG-UI segment so ``/byoc-hashbrown/`` → ``byoc-hashbrown`` and
    ``/`` → ``default``.
    """
    trimmed = path.strip("/")
    if not trimmed:
        return _DEMO_FALLBACK
    return trimmed.split("/", 1)[0] or _DEMO_FALLBACK


# ── HTTP middleware: ingress / first_byte / sse.event / sse.aborted /
#    response.complete / error.caught ─────────────────────────────────────────


class CvdiagBackendMiddleware(BaseHTTPMiddleware):
    """Starlette middleware emitting the HTTP-observable backend boundaries.

    Wires six of the eleven boundaries around the request lifecycle:

      * ``backend.request.ingress``   on entry
      * ``backend.sse.first_byte``    on the first streamed chunk
      * ``backend.sse.event``         per streamed chunk (debug tier)
      * ``backend.sse.aborted``       on premature stream termination
      * ``backend.response.complete`` on clean stream close
      * ``backend.error.caught``      on any exception escaping the inner app

    The agent/LLM boundaries (``agent.enter``, ``llm.call.*``, ``agent.exit``)
    are emitted by the agent hooks / LLM httpx hook installed separately, all
    keyed on the same ``test_id`` this middleware stamps onto ``request.state``.

    Inert when ``CVDIAG_BACKEND_EMITTER`` is off: the dispatch fast-paths to a
    bare ``call_next`` with no envelope construction and no response wrapping.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        if not cvdiag_backend_enabled():
            return await call_next(request)

        headers = request.headers
        ctx = _RequestCtx(
            test_id=normalize_test_id(headers.get(_TEST_ID_HEADER)),
            slug=_normalize_slug(headers.get(_AIMOCK_CONTEXT_HEADER)),
            demo=_demo_from_path(request.url.path),
        )
        request.state.cvdiag = ctx

        emit_backend_boundary(
            "backend.request.ingress",
            outcome="info",
            test_id=ctx.test_id,
            slug=ctx.slug,
            demo=ctx.demo,
            edge_headers=extract_edge_headers(headers),
            metadata={
                "method": request.method,
                "path": request.url.path,
                "content_length": _int_or_none(headers.get("content-length")),
            },
        )

        try:
            response = await call_next(request)
        except Exception as exc:  # noqa: BLE001 - observe then re-raise
            emit_backend_boundary(
                "backend.error.caught",
                outcome="err",
                test_id=ctx.test_id,
                slug=ctx.slug,
                demo=ctx.demo,
                metadata={
                    "exception_type": type(exc).__name__,
                    "message_scrubbed": scrub(str(exc)),
                    "stack_brief": [],
                    "truncated": False,
                },
            )
            raise

        return self._wrap_response(request, response, ctx)

    def _wrap_response(
        self, request: Request, response: Response, ctx: "_RequestCtx"
    ) -> Response:
        """Wrap a streaming response so SSE boundaries fire as chunks flow.

        Non-streaming responses are returned unwrapped after emitting
        ``backend.response.complete`` directly.

        NOTE: ``BaseHTTPMiddleware`` re-wraps the inner ``StreamingResponse`` as
        a private ``_StreamingResponse`` before it reaches us, so an
        ``isinstance(response, StreamingResponse)`` check is always False here.
        Detect streaming by the presence of a ``body_iterator`` (which both the
        public and the private response carry) instead.
        """
        if not hasattr(response, "body_iterator"):
            emit_backend_boundary(
                "backend.response.complete",
                outcome="ok",
                test_id=ctx.test_id,
                slug=ctx.slug,
                demo=ctx.demo,
                duration_ms=_elapsed_ms(ctx.ingress_mono_ns),
                edge_headers=extract_edge_headers(response.headers),
                metadata={
                    "http_status": response.status_code,
                    "content_length": _int_or_none(
                        response.headers.get("content-length")
                    ),
                    "total_duration_ms": _elapsed_ms(ctx.ingress_mono_ns),
                    "sse_event_count": ctx.sse_seq,
                },
            )
            return response

        inner = response.body_iterator
        edge = extract_edge_headers(response.headers)
        status = response.status_code

        async def _instrumented():
            # ``completed`` distinguishes a clean stream exhaustion (→
            # response.complete) from an early termination (→ sse.aborted).
            #
            # IMPORTANT (Starlette ``BaseHTTPMiddleware`` quirk): when the INNER
            # endpoint generator raises mid-stream, Starlette swallows the error
            # internally and our ``async for`` simply ends — we never see an
            # exception there. The abort surface we CAN observe is the consumer
            # tearing the stream down early (client disconnect), which closes
            # this generator and raises ``GeneratorExit`` / ``CancelledError``
            # into it. We therefore catch ``BaseException`` (not just
            # ``Exception``) so a disconnect-driven abort is captured, and emit
            # ``backend.response.complete`` only on a clean exhaustion.
            completed = False
            terminated_kind = "rst"
            try:
                async for chunk in inner:
                    ctx.bytes_streamed += len(chunk) if chunk else 0
                    if not ctx.first_byte_emitted:
                        ctx.first_byte_emitted = True
                        emit_backend_boundary(
                            "backend.sse.first_byte",
                            outcome="info",
                            test_id=ctx.test_id,
                            slug=ctx.slug,
                            demo=ctx.demo,
                            edge_headers=edge,
                            metadata={
                                "delta_ms_from_ingress": _elapsed_ms(
                                    ctx.ingress_mono_ns
                                )
                            },
                        )
                    emit_backend_boundary(
                        "backend.sse.event",
                        outcome="info",
                        test_id=ctx.test_id,
                        slug=ctx.slug,
                        demo=ctx.demo,
                        metadata={
                            "event_type": "chunk",
                            "payload_size_bytes": len(chunk) if chunk else 0,
                            "sequence_num": ctx.sse_seq,
                        },
                    )
                    ctx.sse_seq += 1
                    yield chunk
                completed = True
            except BaseException as exc:  # noqa: BLE001 - observe abort then re-raise
                # GeneratorExit (disconnect) and CancelledError carry no
                # message; an in-iterator error would. Pick a termination_kind.
                terminated_kind = (
                    "rst"
                    if isinstance(exc, (GeneratorExit,))
                    else (
                        "timeout"
                        if isinstance(exc, asyncio.CancelledError)
                        else "chunk_error"
                    )
                )
                raise
            finally:
                if completed:
                    emit_backend_boundary(
                        "backend.response.complete",
                        outcome="ok",
                        test_id=ctx.test_id,
                        slug=ctx.slug,
                        demo=ctx.demo,
                        duration_ms=_elapsed_ms(ctx.ingress_mono_ns),
                        edge_headers=edge,
                        metadata={
                            "http_status": status,
                            "content_length": ctx.bytes_streamed,
                            "total_duration_ms": _elapsed_ms(ctx.ingress_mono_ns),
                            "sse_event_count": ctx.sse_seq,
                        },
                    )
                else:
                    emit_backend_boundary(
                        "backend.sse.aborted",
                        outcome="err",
                        test_id=ctx.test_id,
                        slug=ctx.slug,
                        demo=ctx.demo,
                        edge_headers=edge,
                        metadata={
                            "termination_kind": terminated_kind,
                            "bytes_before_abort": ctx.bytes_streamed,
                        },
                    )

        response.body_iterator = _instrumented()
        return response


def _int_or_none(raw: Any) -> Optional[int]:
    """Parse an int header value, returning ``None`` on absence / malformed."""
    if raw is None:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _elapsed_ms(start_mono_ns: int) -> int:
    """Whole milliseconds elapsed since a ``time.monotonic_ns`` start mark."""
    return max(0, (time.monotonic_ns() - start_mono_ns) // 1_000_000)


# ── Agent + LLM boundaries ──────────────────────────────────────────────────

# The LLM-call boundaries (start / heartbeat / response) and the agent
# enter/exit boundaries are emitted via the explicit helpers below. They are
# called from the agent factory's hook points (strands ``HookProvider``) and
# from the outbound httpx event hook, all keyed on the request ``ctx``.


def emit_agent_enter(ctx: "_RequestCtx", *, agent_name: str, model_id: str) -> None:
    """Emit ``backend.agent.enter`` (default tier)."""
    emit_backend_boundary(
        "backend.agent.enter",
        outcome="info",
        test_id=ctx.test_id,
        slug=ctx.slug,
        demo=ctx.demo,
        metadata={"agent_name": agent_name, "model_id": model_id},
    )


def emit_agent_exit(
    ctx: "_RequestCtx", *, terminal_outcome: str, total_duration_ms: int
) -> None:
    """Emit ``backend.agent.exit`` (default tier)."""
    emit_backend_boundary(
        "backend.agent.exit",
        outcome="ok" if terminal_outcome == "ok" else "err",
        test_id=ctx.test_id,
        slug=ctx.slug,
        demo=ctx.demo,
        duration_ms=total_duration_ms,
        metadata={
            "terminal_outcome": terminal_outcome,
            "total_duration_ms": total_duration_ms,
        },
    )


class LlmCallScope:
    """Async context manager spanning one outbound LLM call.

    On ``__aenter__`` emits ``backend.llm.call.start`` and launches a heartbeat
    task that emits ``backend.llm.call.heartbeat`` every ``interval_s`` (≈10s)
    while the call is outstanding (verbose tier). On ``__aexit__`` emits
    ``backend.llm.call.response`` with the measured latency.

    All emission is gated/tiered through ``emit_backend_boundary``, so with the
    emitter off or at default tier this scope is effectively free (the
    heartbeat task still ticks but every emit is suppressed; callers that want
    zero task overhead can skip the scope when ``cvdiag_backend_enabled()`` is
    false).
    """

    def __init__(
        self,
        ctx: "_RequestCtx",
        *,
        provider: str,
        model: str,
        prompt_token_count_estimate: int = 0,
        interval_s: float = 10.0,
    ) -> None:
        self._ctx = ctx
        self._provider = provider
        self._model = model
        self._prompt_tokens = prompt_token_count_estimate
        self._interval_s = interval_s
        self._start_mono_ns = 0
        self._hb_task: Optional[asyncio.Task] = None

    async def __aenter__(self) -> "LlmCallScope":
        self._start_mono_ns = time.monotonic_ns()
        emit_backend_boundary(
            "backend.llm.call.start",
            outcome="info",
            test_id=self._ctx.test_id,
            slug=self._ctx.slug,
            demo=self._ctx.demo,
            metadata={
                "provider": self._provider,
                "model": self._model,
                "prompt_token_count_estimate": self._prompt_tokens,
            },
        )
        self._hb_task = asyncio.ensure_future(self._heartbeat())
        return self

    async def _heartbeat(self) -> None:
        try:
            while True:
                await asyncio.sleep(self._interval_s)
                emit_backend_boundary(
                    "backend.llm.call.heartbeat",
                    outcome="info",
                    test_id=self._ctx.test_id,
                    slug=self._ctx.slug,
                    demo=self._ctx.demo,
                    metadata={
                        "elapsed_ms_since_start": _elapsed_ms(self._start_mono_ns)
                    },
                )
        except asyncio.CancelledError:  # normal shutdown on call completion
            return

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        if self._hb_task is not None:
            hb_task = self._hb_task
            self._hb_task = None
            hb_task.cancel()
            try:
                await hb_task
            except asyncio.CancelledError:
                # Cooperative cancellation (was ``except (CancelledError,
                # Exception)``, which swallowed the CALLER's cancel and broke
                # cooperative cancellation). Suppress ONLY the heartbeat task's
                # OWN cancellation — the one we just requested. If THIS task is
                # being cancelled by the caller (a pending cancellation request,
                # ``current_task().cancelling() > 0``), the CancelledError is the
                # caller's and MUST propagate. ``Task.cancelling()`` is 3.11+
                # (production runs 3.12); on older runtimes the attribute is
                # absent and we degrade to suppressing (the legacy behavior).
                current = asyncio.current_task()
                cancelling = getattr(current, "cancelling", None)
                if current is not None and cancelling is not None and cancelling() > 0:
                    raise
            except Exception:  # noqa: BLE001 - heartbeat body must never throw out
                pass
        emit_backend_boundary(
            "backend.llm.call.response",
            outcome="err" if exc_type is not None else "ok",
            test_id=self._ctx.test_id,
            slug=self._ctx.slug,
            demo=self._ctx.demo,
            duration_ms=_elapsed_ms(self._start_mono_ns),
            metadata={
                "provider": self._provider,
                "model": self._model,
                "response_token_count": None,
                "latency_ms": _elapsed_ms(self._start_mono_ns),
                "error_class": type(exc).__name__ if exc is not None else None,
            },
        )
        return False  # never suppress the underlying exception
