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
import importlib
import json
import logging
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from agents import _header_forwarding as hf  # noqa: E402


@pytest.fixture(autouse=True)
def restore_client_constructors(monkeypatch):
    """Keep global constructor patches local to each test."""
    for name in ("httpx", "httpx2"):
        try:
            module = importlib.import_module(name)
        except ImportError:
            continue
        for client in (module.Client, module.AsyncClient):
            monkeypatch.setattr(client, "__init__", client.__init__)
    monkeypatch.setattr(hf, "_GLOBAL_HTTPX_PATCHED", False)
    token = hf._forwarded_headers.set({})
    try:
        yield
    finally:
        hf._forwarded_headers.reset(token)


@pytest.fixture
def echo_server():
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            payload = json.dumps(dict(self.headers)).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


@pytest.mark.parametrize("module_name", ["httpx", "httpx2"])
def test_installed_sync_transport_forwards_only_request_headers(
    module_name, echo_server
):
    transport = pytest.importorskip(module_name)
    hf.install_global_httpx_hook()
    hf.install_global_httpx_hook()
    hf.set_forwarded_headers(
        {"x-test-id": "sync-run", "authorization": "not-forwarded"}
    )
    with transport.Client() as client:
        assert len(client.event_hooks["request"]) == 1
        headers = client.get(echo_server).json()
    assert headers["x-test-id"] == "sync-run"
    assert "authorization" not in {name.lower() for name in headers}


@pytest.mark.parametrize("module_name", ["httpx", "httpx2"])
def test_installed_async_transport_keeps_concurrent_contexts_isolated(
    module_name, echo_server
):
    transport = pytest.importorskip(module_name)
    hf.install_global_httpx_hook()
    hf.install_global_httpx_hook()

    async def run_requests():
        async with transport.AsyncClient() as client:
            assert len(client.event_hooks["request"]) == 1

            async def send(test_id):
                hf.set_forwarded_headers({"x-test-id": test_id})
                await asyncio.sleep(0)
                return (await client.get(echo_server)).json()["x-test-id"]

            return await asyncio.gather(send("request-a"), send("request-b"))

    assert asyncio.run(run_requests()) == ["request-a", "request-b"]


def test_missing_optional_transport_keeps_httpx_supported(monkeypatch, echo_server):
    original_import = importlib.import_module

    def without_httpx2(name):
        if name == "httpx2":
            raise ModuleNotFoundError("httpx2 is not installed", name=name)
        return original_import(name)

    monkeypatch.setattr(importlib, "import_module", without_httpx2)
    hf.install_global_httpx_hook()
    hf.set_forwarded_headers({"x-test-id": "older-provider"})
    with httpx.Client() as client:
        assert client.get(echo_server).json()["x-test-id"] == "older-provider"


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
    async def check():
        async with httpx.AsyncClient() as client:
            assert hf._is_async_httpx_target(client) is True

    asyncio.run(check())


def test_is_async_detects_sync_client():
    with httpx.Client() as client:
        assert hf._is_async_httpx_target(client) is False


def test_async_detection_emits_breadcrumb(caplog):
    """A CVDIAG breadcrumb tagged with the chosen confidence must be emitted
    so a misdetection is greppable."""
    with caplog.at_level(logging.INFO, logger=hf.logger.name):

        async def check():
            async with httpx.AsyncClient() as client:
                hf._is_async_httpx_target(client)

        asyncio.run(check())
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
