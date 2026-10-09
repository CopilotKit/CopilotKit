"""Red-green proof for executor ContextVar propagation.

The gen-ui declarative pill registers a SYNC tool (`generate_a2ui`) on the
agno Agent. Agno dispatches sync tools onto the default thread-pool via
``loop.run_in_executor``. Stock ``run_in_executor`` does NOT copy the
caller's :pep:`567` context to the worker thread, so the
``_forwarded_headers`` ContextVar set by ``HeaderForwardingHTTPMiddleware``
on the inbound request task is EMPTY inside the executor. The secondary
OpenAI call's httpx hook then reads no headers → aimock strict-mode 503.

This test exercises that exact mechanism directly:

* WITHOUT ``install_executor_contextvar_propagation()`` the worker thread
  sees an empty header set (the bug).
* WITH it, the worker thread sees the forwarded ``x-aimock-context``
  header (the fix).
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from agents import _header_forwarding as hf  # noqa: E402


async def _run_sync_tool_in_executor():
    """Mimic agno: set the request-scope ContextVar, then dispatch a sync
    callable onto the default executor and report what it observed."""
    hf.set_forwarded_headers({"x-aimock-context": "dashboard-red-fixture"})

    def _sync_tool():
        # This is what the secondary openai.OpenAI() httpx hook reads.
        return hf.get_forwarded_headers()

    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _sync_tool)


def test_executor_drops_contextvar_without_fix():
    """RED: without the patch, the worker thread sees no forwarded headers."""
    # Ensure no patch is active for this test.
    hf._EXECUTOR_CTXVAR_PATCHED = False
    seen = asyncio.run(_run_sync_tool_in_executor())
    assert seen == {}, (
        f"expected empty headers in executor thread without fix, got {seen!r}"
    )


def test_executor_propagates_contextvar_with_fix():
    """GREEN: with the patch, the worker thread sees the forwarded header."""
    hf.install_executor_contextvar_propagation()
    seen = asyncio.run(_run_sync_tool_in_executor())
    assert seen.get("x-aimock-context") == "dashboard-red-fixture", (
        f"expected forwarded x-aimock-context in executor thread, got {seen!r}"
    )
