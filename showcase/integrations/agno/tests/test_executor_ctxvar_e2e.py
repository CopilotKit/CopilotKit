"""End-to-end red-green proof through the REAL httpx event hook + a
strict-mode mock server, mirroring the secondary gen-ui LLM call path.

This goes beyond the unit test by exercising the actual outbound request
path agno's `generate_a2ui` tool takes:

1. ``HeaderForwardingHTTPMiddleware`` records ``x-aimock-context`` on the
   request-scope ContextVar.
2. A SYNC callable (the tool) is dispatched via ``loop.run_in_executor``.
3. Inside the executor, an httpx client whose request hook was installed
   by ``install_httpx_hook`` makes an outbound call.
4. A strict-mode server returns 503 when ``x-aimock-context`` is absent
   (the bug) and 200 when present (the fix) — exactly aimock strict mode.

Without ``install_executor_contextvar_propagation()`` the ContextVar is
empty in the executor thread → hook forwards nothing → 503.
With it → hook forwards ``x-aimock-context`` → 200.
"""

import asyncio
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from agents import _header_forwarding as hf  # noqa: E402

AIMOCK_HEADER = "x-aimock-context"


class _StrictHandler(BaseHTTPRequestHandler):
    """Mimic aimock strict mode: 503 unless x-aimock-context present."""

    def do_POST(self):  # noqa: N802
        # Drain the request body so the client sees a clean response
        # instead of a connection reset.
        length = int(self.headers.get("content-length", 0) or 0)
        if length:
            self.rfile.read(length)
        ctx = self.headers.get(AIMOCK_HEADER)
        if ctx:
            body = b'{"ok":true}'
            self.send_response(200)
        else:
            body = b'{"error":"ctx empty"}'
            self.send_response(503)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):  # silence
        pass


def _start_server():
    srv = HTTPServer(("127.0.0.1", 0), _StrictHandler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    return srv


async def _drive(url: str) -> int:
    """Set ctx ContextVar, then make the outbound call from inside an
    executor thread using a hooked httpx client (the gen-ui tool path)."""
    hf.set_forwarded_headers({AIMOCK_HEADER: "dashboard-red-fixture"})

    def _sync_outbound_call():
        # Mirrors the secondary openai.OpenAI() client whose httpx client
        # carries the install_httpx_hook request hook.
        client = httpx.Client()
        hf.install_httpx_hook(client)
        resp = client.post(url, json={"model": "gpt-4.1"})
        client.close()
        return resp.status_code

    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _sync_outbound_call)


def test_e2e_503_without_fix():
    """RED: ctx dropped in executor → outbound call hits strict server with
    no x-aimock-context → 503."""
    hf._EXECUTOR_CTXVAR_PATCHED = False
    srv = _start_server()
    try:
        url = f"http://127.0.0.1:{srv.server_address[1]}/v1/chat/completions"
        status = asyncio.run(_drive(url))
        assert status == 503, f"expected 503 without fix, got {status}"
    finally:
        srv.shutdown()


def test_e2e_200_with_fix():
    """GREEN: with executor ctxvar propagation, the hook forwards
    x-aimock-context → strict server returns 200."""
    hf.install_executor_contextvar_propagation()
    srv = _start_server()
    try:
        url = f"http://127.0.0.1:{srv.server_address[1]}/v1/chat/completions"
        status = asyncio.run(_drive(url))
        assert status == 200, f"expected 200 with fix, got {status}"
    finally:
        srv.shutdown()
