"""test_cvdiag_log_stdout_gate.py — MUST-1 functional regression: CVDIAG stdout
emission is a ROUTING gate, not a data-loss gate.

Background (stdout-backpressure wedge): every CVDIAG surface writes to the shared
Railway log stream (500 logs/sec cap). Under a D6 burst the per-LLM-call
breadcrumb + envelope volume crosses the cap, backpressure fills the awk pipe,
and Next.js's blocking ``write(2)`` on fd 1 wedges the event loop (public 502,
CPU→0). The fix routes CVDIAG's stdout copy behind ``CVDIAG_LOG_STDOUT`` (default
ON so behavior is unchanged for every integration) so the breadcrumb volume can
be taken off stdout WITHOUT losing any data — the non-blocking PocketBase sink
still receives every envelope at full fidelity.

RED (pre-fix): ``emit_cvdiag`` writes the ``CVDIAG `` line to stdout
unconditionally, so ``CVDIAG_LOG_STDOUT=0`` cannot take the breadcrumb volume off
the shared log stream.
GREEN (post-fix): with ``CVDIAG_LOG_STDOUT=0`` the ``CVDIAG `` line is suppressed
from stdout, the ``agents`` capture handler is NOT attached, yet the PB writer's
``enqueue`` is still called exactly once with the payload; the default (unset /
"1") preserves current behavior (the line IS written).

Imports the package as ``_shared.*`` to mirror the runtime layout; conftest.py
puts ``showcase/integrations`` on sys.path.
"""

from __future__ import annotations

import logging

from _shared import cvdiag_bootstrap

# A valid UUIDv7 test_id (version nibble 7, variant 8/9/a/b).
_VALID_TEST_ID = "018f8b2a-7c3e-7a1b-9f4d-0123456789ab"
_VALID_SPAN_ID = "0123456789abcdef"


def _base_envelope(**overrides):
    """A schema-valid default-tier boundary envelope (backend.agent.enter)."""
    env = {
        "schema_version": 1,
        "test_id": _VALID_TEST_ID,
        "trace_id": _VALID_TEST_ID,
        "span_id": _VALID_SPAN_ID,
        "parent_span_id": None,
        "layer": "backend",
        "boundary": "backend.agent.enter",
        "slug": "claude-sdk-python",
        "demo": "chat",
        "ts": "2026-06-18T12:00:00Z",
        "mono_ns": 123456789,
        "duration_ms": None,
        "outcome": "ok",
        "edge_headers": {
            "cf-ray": None,
            "cf-mitigated": None,
            "cf-cache-status": None,
            "x-railway-edge": None,
            "x-railway-request-id": None,
            "x-hikari-trace": None,
            "retry-after": None,
            "via": None,
            "server": None,
        },
        "metadata": {"agent_name": "weather", "model_id": "claude"},
    }
    env.update(overrides)
    return env


class _RecordingWriter:
    """Stand-in for the threaded PB writer: records ``enqueue`` payloads."""

    def __init__(self):
        self.enqueued: list[dict] = []

    @property
    def enabled(self) -> bool:
        return True

    def enqueue(self, envelope: dict) -> None:
        self.enqueued.append(envelope)


def test_stdout_off_suppresses_stdout_but_still_enqueues_pb(capsys):
    """CVDIAG_LOG_STDOUT=0: nothing to stdout, but PB enqueue runs exactly once.

    This is the routing invariant: turning the stdout copy off must NOT drop any
    CVDIAG data — the PB sink still receives the full payload.

    RED (pre-fix): ``emit_cvdiag`` writes the ``CVDIAG `` line unconditionally.
    """
    cvdiag_bootstrap.reset_for_test()
    cvdiag_bootstrap.setup(
        {
            "CVDIAG_BACKEND_EMITTER": "1",
            "SHOWCASE_ENV": "staging",
            "CVDIAG_LOG_STDOUT": "0",
        }
    )
    assert cvdiag_bootstrap.is_enabled() is True, "precondition: setup enabled"

    # Swap in a recording PB writer so we can assert enqueue fidelity.
    writer = _RecordingWriter()
    cvdiag_bootstrap._PB_WRITER = writer

    cvdiag_bootstrap.emit_cvdiag(_base_envelope())

    out = capsys.readouterr().out
    assert "CVDIAG " not in out, (
        "CVDIAG_LOG_STDOUT=0 must suppress the stdout line; got:\n" + out
    )
    assert len(writer.enqueued) == 1, (
        "PB writer must still receive exactly one enqueue (no data loss); got "
        f"{len(writer.enqueued)}"
    )
    payload = writer.enqueued[0]
    assert payload["test_id"] == _VALID_TEST_ID, "enqueued payload must be the envelope"


def test_stdout_off_does_not_attach_agents_capture_handler():
    """CVDIAG_LOG_STDOUT=0: the ``agents`` breadcrumb capture handler is NOT
    attached, so per-LLM-call ``logger.info("CVDIAG …")`` breadcrumbs stop
    reaching stdout (Seam 1).
    """
    cvdiag_bootstrap.reset_for_test()
    agents_logger = logging.getLogger("agents")
    handlers_before = set(agents_logger.handlers)

    cvdiag_bootstrap.setup(
        {
            "CVDIAG_BACKEND_EMITTER": "1",
            "SHOWCASE_ENV": "staging",
            "CVDIAG_LOG_STDOUT": "0",
        }
    )

    new_handlers = set(agents_logger.handlers) - handlers_before
    assert not new_handlers, (
        "CVDIAG_LOG_STDOUT=0 must not attach the agents stdout capture handler; "
        f"attached: {new_handlers}"
    )
    cvdiag_bootstrap.reset_for_test()


def test_stdout_default_on_preserves_current_behavior(capsys):
    """Default (unset) keeps the ``CVDIAG `` stdout line — behavior preserved for
    every other integration.
    """
    cvdiag_bootstrap.reset_for_test()
    cvdiag_bootstrap.setup({"CVDIAG_BACKEND_EMITTER": "1", "SHOWCASE_ENV": "staging"})
    assert cvdiag_bootstrap.is_enabled() is True

    writer = _RecordingWriter()
    cvdiag_bootstrap._PB_WRITER = writer

    cvdiag_bootstrap.emit_cvdiag(_base_envelope())

    out = capsys.readouterr().out
    assert "CVDIAG " in out, (
        "default (stdout ON) must still write the CVDIAG line; got:\n" + out
    )
    assert len(writer.enqueued) == 1, "PB enqueue still runs on the default path"


def test_stdout_explicit_on_attaches_agents_capture_handler():
    """Explicit CVDIAG_LOG_STDOUT=1 (and unset) attaches the capture handler —
    the default breadcrumb-to-stdout path is intact.
    """
    cvdiag_bootstrap.reset_for_test()
    agents_logger = logging.getLogger("agents")
    handlers_before = set(agents_logger.handlers)

    cvdiag_bootstrap.setup(
        {
            "CVDIAG_BACKEND_EMITTER": "1",
            "SHOWCASE_ENV": "staging",
            "CVDIAG_LOG_STDOUT": "1",
        }
    )

    new_handlers = set(agents_logger.handlers) - handlers_before
    assert len(new_handlers) == 1, (
        "CVDIAG_LOG_STDOUT=1 must attach exactly one agents capture handler; "
        f"attached: {new_handlers}"
    )
    cvdiag_bootstrap.reset_for_test()


def test_hostile_stdout_does_not_starve_pb_enqueue(monkeypatch):
    """Durability invariant: a blocking/raising stdout must NOT cost us the
    durable PocketBase breadcrumb.

    On the default stdout-ON path the stdout write is exactly the surface this
    PR is hardening against (a wedged fd 1 under log-stream backpressure). The
    durable PB sink's ``enqueue`` is non-blocking (``put_nowait``), so it must
    receive the payload REGARDLESS of whether the stdout copy succeeds. If the
    stdout write runs first and blocks/raises, ordering it before the enqueue
    would silently drop the breadcrumb from the durable sink.

    RED (pre-reorder): the stdout write runs before the enqueue, so a raising
    ``sys.stdout.write`` short-circuits into the ``except`` handler and
    ``enqueue`` is never reached — ``writer.enqueued`` stays empty.
    GREEN (post-reorder): ``enqueue`` runs first and captures the payload even
    though the subsequent gated stdout write raises.
    """
    cvdiag_bootstrap.reset_for_test()
    cvdiag_bootstrap.setup({"CVDIAG_BACKEND_EMITTER": "1", "SHOWCASE_ENV": "staging"})
    assert cvdiag_bootstrap.is_enabled() is True, "precondition: setup enabled"
    # Default path: stdout routing is ON (this is the surface being hardened).
    assert cvdiag_bootstrap._LOG_STDOUT is True, "precondition: stdout ON (default)"

    writer = _RecordingWriter()
    cvdiag_bootstrap._PB_WRITER = writer

    def _hostile_write(*_):
        # Simulate a wedged fd 1: the write never completes normally.
        raise BlockingIOError("stdout wedged (write would block)")

    monkeypatch.setattr(cvdiag_bootstrap.sys.stdout, "write", _hostile_write)

    # Instrumentation must not throw even when stdout is hostile.
    cvdiag_bootstrap.emit_cvdiag(_base_envelope())

    assert len(writer.enqueued) == 1, (
        "durable PB sink must receive the payload even when the stdout write "
        f"blocks/raises (enqueue must run first); got {len(writer.enqueued)}"
    )
    assert writer.enqueued[0]["test_id"] == _VALID_TEST_ID, (
        "enqueued payload must be the full envelope"
    )
    cvdiag_bootstrap.reset_for_test()
