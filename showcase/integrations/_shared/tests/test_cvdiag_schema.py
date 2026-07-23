"""test_cvdiag_schema.py — L0-C unit suite for the Python ``_shared`` CVDIAG
bootstrap module (6 tests, spec §5/§6).

Run from the repo root::

    python3 -m pytest showcase/integrations/_shared/tests/

These tests import the package as ``_shared.*`` to mirror the runtime layout
(``/app`` on PYTHONPATH, ``/app/_shared`` the package). ``conftest.py`` puts
``showcase/integrations`` on ``sys.path`` so ``import _shared`` resolves.
"""

from __future__ import annotations

import importlib
import logging

import pytest

from _shared import cvdiag_schema as schema

# A valid UUIDv7 test_id (version nibble 7, variant 8/9/a/b).
_VALID_TEST_ID = "018f8b2a-7c3e-7a1b-9f4d-0123456789ab"
_VALID_SPAN_ID = "0123456789abcdef"


def _base_envelope(**overrides):
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


def test_valid_envelope_round_trips():
    """A well-formed envelope validates and round-trips by alias."""
    model = schema.CvdiagEnvelope.model_validate(_base_envelope())
    assert model.boundary is schema.CvdiagBoundary.BACKEND_AGENT_ENTER
    assert model.layer is schema.CvdiagLayer.BACKEND
    assert model.outcome is schema.CvdiagOutcome.OK
    assert model.metadata_dropped is False
    dumped = model.model_dump(by_alias=True)
    # The edge-header alias keys survive the round-trip.
    assert dumped["edge_headers"]["cf-ray"] is None
    assert dumped["_metadata_dropped"] is False


def test_unknown_metadata_key_stamps_metadata_dropped():
    """An unknown metadata key sets ``_metadata_dropped`` on the envelope."""
    env = _base_envelope(
        metadata={"agent_name": "weather", "bogus_key": "x"},
    )
    model = schema.CvdiagEnvelope.model_validate(env)
    assert model.metadata_dropped is True
    # Also true for an unknown TOP-LEVEL key.
    env2 = _base_envelope()
    env2["totally_unknown"] = "y"
    model2 = schema.CvdiagEnvelope.model_validate(env2)
    assert model2.metadata_dropped is True


def test_forbidden_edge_header_dropped():
    """A deny-list edge header (cf-connecting-ip) is rejected by EdgeHeaders.

    ``EdgeHeaders`` forbids extra keys, so a forbidden header can never round
    -trip through the closed model.
    """
    bad = {
        "cf-ray": "abc",
        "cf-mitigated": None,
        "cf-cache-status": None,
        "x-railway-edge": None,
        "x-railway-request-id": None,
        "x-hikari-trace": None,
        "retry-after": None,
        "via": None,
        "server": None,
        "cf-connecting-ip": "1.2.3.4",  # forbidden PII header
    }
    with pytest.raises(Exception):
        schema.EdgeHeaders.model_validate(bad)


def test_uuidv7_test_id_validation():
    """UUIDv7 test_id passes; a UUIDv4 / malformed test_id is rejected."""
    # Pass.
    schema.CvdiagEnvelope.model_validate(_base_envelope(test_id=_VALID_TEST_ID))
    # UUIDv4 (version nibble 4) → reject.
    uuid_v4 = "018f8b2a-7c3e-4a1b-9f4d-0123456789ab"
    with pytest.raises(Exception):
        schema.CvdiagEnvelope.model_validate(_base_envelope(test_id=uuid_v4))
    # Malformed → reject.
    with pytest.raises(Exception):
        schema.CvdiagEnvelope.model_validate(_base_envelope(test_id="not-a-uuid"))


def test_debug_in_production_degrades_at_setup():
    """``CVDIAG_DEBUG=1`` + ``SHOWCASE_ENV=production`` fails closed at setup.

    Fail-closed intent: instrumentation is DISABLED (tier stays ``default``,
    ``is_enabled()`` False). Degrade-not-crash: ``setup()`` must NOT raise —
    a misconfig may not abort the backend's module import.
    """
    from _shared import cvdiag_bootstrap

    cvdiag_bootstrap.reset_for_test()
    cvdiag_bootstrap.setup({"CVDIAG_DEBUG": "1", "SHOWCASE_ENV": "production"})
    assert cvdiag_bootstrap.current_tier() == "default"
    assert cvdiag_bootstrap.is_enabled() is False

    # Unresolved env is ALSO treated as production (fail-closed → degraded).
    cvdiag_bootstrap.reset_for_test()
    cvdiag_bootstrap.setup({"CVDIAG_DEBUG": "1"})
    assert cvdiag_bootstrap.current_tier() == "default"
    assert cvdiag_bootstrap.is_enabled() is False

    # A non-production env with DEBUG is allowed (instrumentation enabled).
    cvdiag_bootstrap.reset_for_test()
    cvdiag_bootstrap.setup({"CVDIAG_DEBUG": "1", "SHOWCASE_ENV": "staging"})
    assert cvdiag_bootstrap.current_tier() == "debug"
    assert cvdiag_bootstrap.is_enabled() is True


def test_basicconfig_captures_agents_logger_output(capsys):
    """``setup()`` installs a handler so ``agents.*`` loggers actually emit.

    This is the silent-drop regression guard: before bootstrap configures the
    root logger, an ``agents._header_forwarding`` ``logger.info`` is dropped;
    after ``setup()`` it reaches the stream.
    """
    from _shared import cvdiag_bootstrap

    cvdiag_bootstrap.reset_for_test()
    cvdiag_bootstrap.setup({"SHOWCASE_ENV": "staging"})
    fwd_logger = logging.getLogger("agents._header_forwarding")
    fwd_logger.info("CVDIAG component=test boundary=probe.start status=ok")
    captured = capsys.readouterr()
    combined = captured.out + captured.err
    assert "CVDIAG component=test boundary=probe.start" in combined
