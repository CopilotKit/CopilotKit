"""PR-C forwarding-shim hardening proofs.

Covers the hardening added in the floor-backlog PR-C pass:

* Item 1 — a failed ``install_httpx_hook`` during global-hook construction
  must be surfaced at WARNING/ERROR (not buried at INFO), because a failed
  hook means ``x-aimock-context`` silently never forwards. Construction must
  still NOT break.
* Item 3 — ``_is_async_httpx_target`` must classify a real
  ``httpx.AsyncClient`` as async and a real ``httpx.Client`` as sync (the
  high-confidence isinstance path), and must emit a greppable CVDIAG
  breadcrumb recording which detection path was taken.
"""

import asyncio
import logging
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from agents import _header_forwarding as hf  # noqa: E402


# ---------------------------------------------------------------------------
# Item 1: failed hook install during global patching must FAIL LOUD.
# ---------------------------------------------------------------------------
def test_global_hook_install_failure_logged_at_error_not_info(caplog, monkeypatch):
    """A raising install_httpx_hook must be logged at >= WARNING, not INFO,
    and must NOT propagate out of client construction."""

    def _boom(_client):
        raise RuntimeError("simulated hook install failure")

    monkeypatch.setattr(hf, "install_httpx_hook", _boom)
    # Reset the module sentinel so the patch actually installs in this test.
    monkeypatch.setattr(hf, "_GLOBAL_HTTPX_PATCHED", False)

    hf.install_global_httpx_hook()

    with caplog.at_level(logging.INFO, logger=hf.logger.name):
        # Constructing a client triggers the patched __init__ → _boom().
        # This must NOT raise.
        client = httpx.Client()
        client.close()

    # The failure surfaces at ERROR (fail-loud), carrying full detail.
    error_records = [r for r in caplog.records if r.levelno >= logging.WARNING]
    assert error_records, (
        "expected a WARNING/ERROR log for the failed hook install; got none. "
        f"all levels seen: {[r.levelname for r in caplog.records]}"
    )
    joined = " ".join(r.getMessage() for r in error_records)
    assert "simulated hook install failure" in joined, (
        f"expected full exception detail in the loud log, got: {joined!r}"
    )

    # The bug being fixed is that the failure was visible ONLY at INFO. A
    # co-existing INFO CVDIAG breadcrumb is fine; what matters is that the
    # failure ALSO surfaces at >= WARNING. (The loud record carrying the
    # detail is asserted above.) Guard against regressing to INFO-only.
    loud_with_detail = [
        r for r in error_records if "simulated hook install failure" in r.getMessage()
    ]
    assert loud_with_detail, (
        "hook-install failure detail appeared only below WARNING — that is "
        "the silent forwarding-loss bug PR-C fixes"
    )


def test_global_hook_install_failure_does_not_break_construction(monkeypatch):
    """The swallow-but-log contract: construction completes despite a raising
    hook install."""

    def _boom(_client):
        raise RuntimeError("boom")

    monkeypatch.setattr(hf, "install_httpx_hook", _boom)
    monkeypatch.setattr(hf, "_GLOBAL_HTTPX_PATCHED", False)
    hf.install_global_httpx_hook()

    # Should not raise.
    client = httpx.Client()
    client.close()

    async def _make_async():
        c = httpx.AsyncClient()
        await c.aclose()

    asyncio.run(_make_async())


# ---------------------------------------------------------------------------
# Item 3: sync-vs-async detection + greppable breadcrumb.
# ---------------------------------------------------------------------------
def test_is_async_detects_async_client():
    assert hf._is_async_httpx_target(httpx.AsyncClient()) is True


def test_is_async_detects_sync_client():
    assert hf._is_async_httpx_target(httpx.Client()) is False


def test_async_detection_emits_breadcrumb(caplog):
    """A CVDIAG breadcrumb tagged with the chosen confidence must be emitted
    so a misdetection is greppable."""
    with caplog.at_level(logging.INFO, logger=hf.logger.name):
        hf._is_async_httpx_target(httpx.AsyncClient())
    joined = " ".join(r.getMessage() for r in caplog.records)
    assert "async-detect" in joined, (
        f"expected an async-detect CVDIAG breadcrumb, got: {joined!r}"
    )
    assert "confidence=high" in joined, (
        f"isinstance path should report high confidence, got: {joined!r}"
    )


def test_async_detection_namematch_fallback_low_confidence(caplog):
    """A duck-typed object whose class is literally named ``AsyncClient`` hits
    the low-confidence MRO name-match fallback, which must be greppable."""

    class AsyncClient:  # noqa: D401 - intentionally mimics the httpx name
        """Not a real httpx client; only the class name matches."""

    with caplog.at_level(logging.INFO, logger=hf.logger.name):
        result = hf._is_async_httpx_target(AsyncClient())

    # Happy-path behavior unchanged: name-match still returns True.
    assert result is True
    joined = " ".join(r.getMessage() for r in caplog.records)
    assert "mro-name-match" in joined and "confidence=low" in joined, (
        f"expected a low-confidence mro-name-match breadcrumb, got: {joined!r}"
    )
