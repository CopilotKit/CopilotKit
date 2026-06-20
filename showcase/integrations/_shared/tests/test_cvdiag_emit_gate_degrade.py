"""test_cvdiag_emit_gate_degrade.py — M5 CR R3 functional regression for C1: the
fail-closed DEBUG degrade must actually SUPPRESS emission.

Background: a prior fix made ``cvdiag_bootstrap.setup()`` DEGRADE
(``_ENABLED=False``, instrumentation disabled) instead of crashing the backend on
a fail-closed DEBUG misconfig. But the emit path never consulted that flag —
``emit_cvdiag`` wrote the ``CVDIAG`` envelope to stdout regardless of
``is_enabled()``. A degraded backend therefore STILL emitted default-tier
boundaries whenever the per-integration gate (``CVDIAG_BACKEND_EMITTER=1``) was
on. ``is_enabled()`` was a dead flag.

RED (pre-fix): a degraded ``setup()`` (``_ENABLED=False``) followed by
``emit_cvdiag(...)`` still writes a ``CVDIAG `` line to stdout.
GREEN (post-fix): the degraded emit writes NOTHING; the normal (enabled) path
still emits, so the gate isn't over-tightened.

Imports the package as ``_shared.*`` to mirror the runtime layout; conftest.py
puts ``showcase/integrations`` on sys.path.
"""

from __future__ import annotations

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
        "slug": "langgraph-python",
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


def test_degraded_setup_suppresses_emission(capsys):
    """A degraded backend (``_ENABLED=False``) must emit NOTHING.

    Reproduces the prod-reachable path ``CVDIAG_BACKEND_EMITTER=1`` +
    ``CVDIAG_DEBUG=1`` (unresolved env → fail-closed degrade): the per-integration
    gate is armed, but the shared bootstrap degraded instrumentation OFF. The
    shared ``emit_cvdiag`` is the single chokepoint every integration routes
    through, so it must honor ``is_enabled()``.

    RED (pre-fix): ``emit_cvdiag`` ignores ``_ENABLED`` and still writes the
    ``CVDIAG `` line.
    """
    cvdiag_bootstrap.reset_for_test()
    # Degrade: fail-closed DEBUG with an unresolved env disables instrumentation.
    cvdiag_bootstrap.setup({"CVDIAG_BACKEND_EMITTER": "1", "CVDIAG_DEBUG": "1"})
    assert cvdiag_bootstrap.is_enabled() is False, "precondition: setup degraded"

    cvdiag_bootstrap.emit_cvdiag(_base_envelope())

    out = capsys.readouterr().out
    assert "CVDIAG " not in out, (
        "degraded backend must suppress emission; got stdout:\n" + out
    )


def test_enabled_setup_still_emits(capsys):
    """Sanity / over-tightening guard: the normal enabled path still emits.

    GREEN must not silence a healthy backend — a non-degraded ``setup()`` keeps
    ``emit_cvdiag`` writing the ``CVDIAG `` envelope line.
    """
    cvdiag_bootstrap.reset_for_test()
    cvdiag_bootstrap.setup({"CVDIAG_BACKEND_EMITTER": "1", "SHOWCASE_ENV": "staging"})
    assert cvdiag_bootstrap.is_enabled() is True, "precondition: setup enabled"

    cvdiag_bootstrap.emit_cvdiag(_base_envelope())

    out = capsys.readouterr().out
    assert "CVDIAG " in out, "enabled backend must still emit; got stdout:\n" + out
