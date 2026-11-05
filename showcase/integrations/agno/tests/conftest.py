"""Shared test fixtures for the agno integration test suite.

The executor-ctxvar tests assert order-independent behavior, but
``install_executor_contextvar_propagation()`` PERMANENTLY monkeypatches
``asyncio.base_events.BaseEventLoop.run_in_executor`` and flips the
module-scope ``_EXECUTOR_CTXVAR_PATCHED`` sentinel. Once the GREEN test
installs the patch, the patched executor (and the True sentinel) leak into
any subsequent test — so the RED test, which only resets the sentinel to
False, still runs on the *patched* loop and sees the propagated context
(observed: ``test_e2e_503_without_fix`` returned 200 instead of 503 when it
ran after ``test_e2e_200_with_fix``).

This autouse fixture snapshots BOTH the original ``run_in_executor`` method
and the sentinel before every test and restores them afterward, guaranteeing
each test starts on the stock executor regardless of execution order.
"""

import asyncio.base_events as _base_events
import sys
from pathlib import Path

import pytest

_PKG_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_PKG_ROOT / "src"))
# The forwarding shim imports shared helpers through the integration's symlink.
sys.path.insert(0, str(_PKG_ROOT))

from _shared.httpx_transports import available_httpx_transports  # noqa: E402
from agents import _header_forwarding as hf  # noqa: E402


@pytest.fixture(autouse=True)
def _restore_executor_ctxvar_patch():
    """Snapshot/restore the executor patch + sentinel around every test.

    Also snapshots/restores the GLOBAL httpx patch that
    ``test_forwarding_hardening.py`` installs via
    ``install_global_httpx_hook()`` — it permanently rebinds
    ``Client.__init__`` / ``AsyncClient.__init__`` for both httpx transports
    (including OpenAI 3's optional ``httpx2``) and flips
    ``hf._GLOBAL_HTTPX_PATCHED``. Without restoring these, the global httpx
    rebinding leaks across tests and the patch can no longer reinstall in a
    later test, making the suite order-dependent.
    """
    orig_run_in_executor = _base_events.BaseEventLoop.run_in_executor
    orig_sentinel = hf._EXECUTOR_CTXVAR_PATCHED
    orig_client_inits = [
        (transport, transport.Client.__init__, transport.AsyncClient.__init__)
        for transport in available_httpx_transports()
    ]
    orig_global_patched = hf._GLOBAL_HTTPX_PATCHED
    try:
        yield
    finally:
        _base_events.BaseEventLoop.run_in_executor = orig_run_in_executor
        hf._EXECUTOR_CTXVAR_PATCHED = orig_sentinel
        for transport, sync_init, async_init in orig_client_inits:
            transport.Client.__init__ = sync_init
            transport.AsyncClient.__init__ = async_init
        hf._GLOBAL_HTTPX_PATCHED = orig_global_patched
