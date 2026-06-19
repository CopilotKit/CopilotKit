"""test_cvdiag_schema_v1.py — L1-I suite for langgraph-python schema-v1 CVDIAG.

Covers:
  1. All 11 backend boundaries emit a valid schema-v1 envelope (stdout capture)
     for a synthetic request with ``CVDIAG_BACKEND_EMITTER=1``.
  2. firsttoken↔first_byte correlation sanity (ingress→first-byte delta ≥ 0).
  3. The Phase-4 PROPAGATION RELIABILITY abandonment gate: 100 synthetic
     requests carrying ``x-test-id`` must propagate that id to the backend emit
     at ≥90% (else BLOCKER).
  4. Guard discipline: with ``CVDIAG_BACKEND_EMITTER`` unset, nothing is emitted.

The 11 backend boundaries are exercised through ``CvdiagBackendRun`` — the exact
emitter the LGP middleware drives in ``(a)wrap_model_call`` — so this exercises
the real failure surface, not a mock.

Run from the repo root::

    python3 -m pytest showcase/integrations/langgraph-python/tests/test_cvdiag_schema_v1.py
"""

from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any, Dict, List

import pytest

from _shared.cvdiag_schema import CvdiagEnvelope
from src.agents import _cvdiag_backend as cvb

# The 11 backend boundaries this integration owns (spec §3 / §5).
_BACKEND_BOUNDARIES = {
    "backend.request.ingress",
    "backend.agent.enter",
    "backend.llm.call.start",
    "backend.llm.call.heartbeat",
    "backend.llm.call.response",
    "backend.sse.first_byte",
    "backend.sse.event",
    "backend.sse.aborted",
    "backend.agent.exit",
    "backend.response.complete",
    "backend.error.caught",
}


def _new_test_id() -> str:
    """A valid UUIDv7-shaped test_id (version nibble 7, variant 8..b)."""
    h = uuid.uuid4().hex
    return f"{h[0:8]}-{h[8:12]}-7{h[13:16]}-8{h[17:20]}-{h[20:32]}"


def _headers(test_id: str) -> Dict[str, str]:
    return {
        "x-aimock-context": "langgraph-python",
        "x-test-id": test_id,
        "x-diag-run-id": "run-" + test_id[:8],
        "cf-ray": "abc123-EWR",
    }


def _parse_cvdiag_lines(captured: str) -> List[Dict[str, Any]]:
    """Extract + JSON-parse every structured ``CVDIAG {json}`` line from stdout.

    The legacy free-form ``CVDIAG component=...`` log line is NOT JSON and is
    skipped; only the schema-v1 ``CVDIAG {...}`` envelopes are returned.
    """
    rows: List[Dict[str, Any]] = []
    for line in captured.splitlines():
        if not line.startswith("CVDIAG "):
            continue
        payload = line[len("CVDIAG ") :].strip()
        if not payload.startswith("{"):
            continue
        rows.append(json.loads(payload))
    return rows


def _emit_all_eleven(headers: Dict[str, str]) -> None:
    """Drive the emitter through all 11 boundaries (debug tier so sse.event +
    heartbeat fire) — mirrors the middleware wrap path plus the error path."""
    run = cvb.CvdiagBackendRun(headers)
    run.request_ingress()
    run.agent_enter(agent_name="HeaderForwardingMiddleware", model_id="gpt-5.4")
    run.llm_call_start(provider="langchain", model="gpt-5.4")
    run.emit_heartbeat_once()  # backend.llm.call.heartbeat
    run.llm_call_response(provider="langchain", model="gpt-5.4", latency_ms=42)
    run.sse_first_byte()
    run.sse_event(event_type="response", payload_size_bytes=128)
    run.sse_aborted(termination_kind="client", bytes_before_abort=0)
    run.agent_exit(terminal_outcome="ok")
    run.response_complete(http_status=200, sse_event_count=1)
    run.error_caught(RuntimeError("synthetic"))


def test_all_eleven_boundaries_emit_valid_envelopes(monkeypatch, capsys):
    """All 11 schema-v1 boundaries present + each validates against the model."""
    monkeypatch.setenv("CVDIAG_BACKEND_EMITTER", "1")
    monkeypatch.setenv("CVDIAG_DEBUG", "1")
    monkeypatch.setenv("SHOWCASE_ENV", "test")  # non-prod so DEBUG is allowed
    # Re-run bootstrap so the debug tier takes effect for this test's env.
    import _shared.cvdiag_bootstrap as boot

    boot.setup()

    test_id = _new_test_id()
    _emit_all_eleven(_headers(test_id))

    rows = _parse_cvdiag_lines(capsys.readouterr().out)
    seen = {row["boundary"] for row in rows}
    missing = _BACKEND_BOUNDARIES - seen
    assert not missing, f"missing backend boundaries: {sorted(missing)}"

    # Every emitted envelope must validate against the generated model.
    for row in rows:
        CvdiagEnvelope.model_validate(row)
        assert row["layer"] == "backend"
        assert row["slug"] == "langgraph-python"
        assert row["test_id"] == test_id


def test_firsttoken_first_byte_correlation_non_negative(monkeypatch, capsys):
    """The ingress→first_byte delta is present and non-negative (end-to-end).

    ``backend.sse.first_byte`` is a VERBOSE-only boundary (§6 tier matrix), so
    drive at VERBOSE tier — at DEFAULT tier it is correctly suppressed.
    """
    monkeypatch.setenv("CVDIAG_BACKEND_EMITTER", "1")
    monkeypatch.setenv("CVDIAG_VERBOSE", "1")
    monkeypatch.setenv("SHOWCASE_ENV", "test")
    import _shared.cvdiag_bootstrap as boot

    boot.setup({"SHOWCASE_ENV": "test", "CVDIAG_VERBOSE": "1"})

    run = cvb.CvdiagBackendRun(_headers(_new_test_id()))
    run.request_ingress()
    run.sse_first_byte()

    rows = _parse_cvdiag_lines(capsys.readouterr().out)
    fb = [r for r in rows if r["boundary"] == "backend.sse.first_byte"]
    assert len(fb) == 1
    delta = fb[0]["metadata"]["delta_ms_from_ingress"]
    assert isinstance(delta, int) and delta >= 0


def test_disabled_emitter_is_noop(monkeypatch, capsys):
    """With CVDIAG_BACKEND_EMITTER unset, no schema-v1 envelope is written."""
    monkeypatch.delenv("CVDIAG_BACKEND_EMITTER", raising=False)
    import _shared.cvdiag_bootstrap as boot

    boot.setup()

    _emit_all_eleven(_headers(_new_test_id()))
    rows = _parse_cvdiag_lines(capsys.readouterr().out)
    assert rows == []


def test_propagation_reliability_gate(monkeypatch, capsys):
    """PHASE-4 ABANDONMENT GATE: ≥90% of 100 requests propagate their test_id.

    Each synthetic request carries a distinct ``x-test-id``; we assert the
    backend emit carries that SAME id through to the envelope. <90% is a BLOCKER.
    """
    monkeypatch.setenv("CVDIAG_BACKEND_EMITTER", "1")
    import _shared.cvdiag_bootstrap as boot

    boot.setup()

    total = 100
    propagated = 0
    for _ in range(total):
        test_id = _new_test_id()
        run = cvb.CvdiagBackendRun(_headers(test_id))
        # The agent.enter boundary is representative of the backend emit path.
        run.agent_enter(agent_name="m", model_id="gpt-5.4")

        rows = _parse_cvdiag_lines(capsys.readouterr().out)
        enter = [r for r in rows if r["boundary"] == "backend.agent.enter"]
        if enter and enter[0]["test_id"] == test_id:
            propagated += 1

    pct = 100.0 * propagated / total
    print(f"\nPROPAGATION_RELIABILITY: {propagated}/{total} = {pct:.1f}%")
    assert pct >= 90.0, (
        f"BLOCKER: test_id propagation {pct:.1f}% < 90% "
        f"({propagated}/{total}) — Phase-4 abandonment gate failed"
    )


# ── FIX-2: live tier (env flip after import must arm tier-gated paths) ───────


def test_tier_read_live_after_import(monkeypatch, capsys):
    """RED: setting ``CVDIAG_VERBOSE`` AFTER bootstrap ``setup()`` must let a
    VERBOSE-tier boundary fire. The tier was frozen at import, so a post-setup
    env flip armed the emitter (read live) but tier-gated heartbeat/llm paths
    kept no-op'ing."""
    import _shared.cvdiag_bootstrap as boot

    # Resolve tier at DEFAULT (no verbose/debug) — the frozen-tier trap.
    monkeypatch.setenv("SHOWCASE_ENV", "test")
    boot.setup({"SHOWCASE_ENV": "test"})
    # NOW flip verbose on, post-setup.
    monkeypatch.setenv("CVDIAG_BACKEND_EMITTER", "1")
    monkeypatch.setenv("CVDIAG_VERBOSE", "1")

    run = cvb.CvdiagBackendRun(_headers(_new_test_id()))
    run.emit_heartbeat_once()  # VERBOSE-tier boundary

    rows = _parse_cvdiag_lines(capsys.readouterr().out)
    hb = [r for r in rows if r["boundary"] == "backend.llm.call.heartbeat"]
    assert hb, "verbose boundary suppressed: tier was frozen at import"


# ── C5: VERBOSE-only backend boundaries must be tier-gated ──────────────────

# The four boundaries the §6 tier matrix marks VERBOSE-only (emit.ts ~58-63 and
# the middleware-canonical agno ``_BOUNDARY_TIER``): at DEFAULT tier they MUST
# be suppressed; at VERBOSE tier they emit. LGP previously called ``_emit`` with
# NO ``tier_gate`` for these, so they over-emitted at default tier — 4 extra
# events/request vs the middleware family, breaking the §7 budget + parity.
_VERBOSE_ONLY_BOUNDARIES = {
    "backend.request.ingress",
    "backend.llm.call.start",
    "backend.llm.call.response",
    "backend.sse.first_byte",
}


def _drive_verbose_only(headers: Dict[str, str]) -> None:
    """Drive exactly the four VERBOSE-only lifecycle boundaries (no debug paths)."""
    run = cvb.CvdiagBackendRun(headers)
    run.request_ingress()
    run.llm_call_start(provider="langchain", model="gpt-5.4")
    run.llm_call_response(provider="langchain", model="gpt-5.4", latency_ms=42)
    run.sse_first_byte()


def test_verbose_only_boundaries_suppressed_at_default_tier(monkeypatch, capsys):
    """RED: at DEFAULT tier the four VERBOSE-only boundaries must NOT emit.

    Pre-fix they fired ungated, over-emitting at default tier (breaking the §7
    tier budget + cross-backend parity); post-fix they are suppressed.
    """
    import _shared.cvdiag_bootstrap as boot

    monkeypatch.setenv("SHOWCASE_ENV", "test")
    monkeypatch.setenv("CVDIAG_BACKEND_EMITTER", "1")
    monkeypatch.delenv("CVDIAG_VERBOSE", raising=False)
    monkeypatch.delenv("CVDIAG_DEBUG", raising=False)
    boot.setup({"SHOWCASE_ENV": "test", "CVDIAG_BACKEND_EMITTER": "1"})

    _drive_verbose_only(_headers(_new_test_id()))

    rows = _parse_cvdiag_lines(capsys.readouterr().out)
    leaked = {r["boundary"] for r in rows} & _VERBOSE_ONLY_BOUNDARIES
    assert not leaked, (
        f"VERBOSE-only boundaries over-emitted at DEFAULT tier: {sorted(leaked)}"
    )


def test_verbose_only_boundaries_emit_at_verbose_tier(monkeypatch, capsys):
    """GREEN companion: at VERBOSE tier all four boundaries DO emit."""
    import _shared.cvdiag_bootstrap as boot

    monkeypatch.setenv("SHOWCASE_ENV", "test")
    monkeypatch.setenv("CVDIAG_BACKEND_EMITTER", "1")
    monkeypatch.setenv("CVDIAG_VERBOSE", "1")
    boot.setup({"SHOWCASE_ENV": "test", "CVDIAG_VERBOSE": "1"})

    _drive_verbose_only(_headers(_new_test_id()))

    rows = _parse_cvdiag_lines(capsys.readouterr().out)
    seen = {r["boundary"] for r in rows} & _VERBOSE_ONLY_BOUNDARIES
    missing = _VERBOSE_ONLY_BOUNDARIES - seen
    assert not missing, (
        f"VERBOSE-only boundaries suppressed at VERBOSE tier: {sorted(missing)}"
    )


# ── FIX-3: stop_heartbeat cooperative cancellation ──────────────────────────


@pytest.mark.skipif(
    not hasattr(asyncio.Task, "cancelling"),
    reason="cooperative-cancel detection uses Task.cancelling() (Python 3.11+); "
    "production runs 3.12",
)
def test_stop_heartbeat_propagates_caller_cancellation(monkeypatch):
    """RED: ``stop_heartbeat``'s ``except (CancelledError, Exception)`` swallows
    the CALLER's CancelledError, breaking cooperative cancellation.

    Deterministic repro (no scheduling race): a heartbeat whose cancellation is
    SLOW (shielded cleanup) keeps ``await task`` suspended; the surrounding task
    is cancelled a SECOND time while suspended exactly there, so the caller's
    CancelledError lands inside ``stop_heartbeat``. With the swallow it runs to
    completion (``AFTER_STOP`` reached); with cooperative cancellation the
    CancelledError propagates and ``AFTER_STOP`` is NEVER reached.
    """
    monkeypatch.setenv("SHOWCASE_ENV", "test")
    monkeypatch.setenv("CVDIAG_BACKEND_EMITTER", "1")
    monkeypatch.setenv("CVDIAG_VERBOSE", "1")
    import _shared.cvdiag_bootstrap as boot

    boot.setup({"SHOWCASE_ENV": "test", "CVDIAG_VERBOSE": "1"})
    reached: List = []

    async def run_test():
        run = cvb.CvdiagBackendRun(_headers(_new_test_id()))
        run.start_heartbeat()
        assert run._heartbeat_task is not None, "heartbeat task did not arm"
        # Swap in a heartbeat that is SLOW to cancel so ``await task`` suspends.
        run._heartbeat_task.cancel()

        async def slow_hb():
            try:
                await asyncio.sleep(3600)
            except asyncio.CancelledError:
                await asyncio.shield(asyncio.sleep(0.2))
                return

        run._heartbeat_task = asyncio.ensure_future(slow_hb())
        await asyncio.sleep(0.02)

        at_await = asyncio.Event()

        async def body():
            try:
                await asyncio.sleep(3600)
            finally:
                at_await.set()
                await run.stop_heartbeat()
                reached.append("AFTER_STOP")

        task = asyncio.ensure_future(body())
        await asyncio.sleep(0.02)
        task.cancel()  # enter finally → reach the stop_heartbeat await
        await at_await.wait()
        await asyncio.sleep(0)  # yield so we're inside ``await task``
        task.cancel()  # caller cancel lands inside stop_heartbeat's await
        try:
            await task
        except asyncio.CancelledError:
            pass

    asyncio.run(run_test())
    assert not reached, (
        "caller CancelledError was swallowed by stop_heartbeat: it ran to "
        "completion instead of propagating cooperative cancellation"
    )
