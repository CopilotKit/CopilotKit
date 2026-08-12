"""test_cvdiag_inert_when_disabled.py — M5 CR R4 functional regression for N3:
importing the cvdiag bootstrap must be FULLY INERT when cvdiag is disabled.

Background (N3): ``cvdiag_bootstrap.setup()`` ran
``logging.basicConfig(level=…, format=…, force=True)`` unconditionally at import
time (the module calls ``setup()`` at the bottom). ``force=True`` REMOVES and
CLOSES every pre-existing root-logger handler, so merely importing the module —
which every Python integration backend does whenever it imports
``_cvdiag_backend`` — ripped out the HOST application's logging configuration,
even with the backend emitter OFF (``CVDIAG_BACKEND_EMITTER`` unset, the
canary-safe default). That violates the "byte-for-byte inert when disabled /
canary-safe" contract the backend emitters advertise; the canonical TypeScript
emitter performs NO equivalent global mutation.

RED (pre-fix): a pre-configured host root-logger handler is TORN DOWN by the
import-time ``basicConfig(force=True)``.
GREEN (post-fix): importing the bootstrap with cvdiag disabled is fully inert —
the host root handler survives, nothing is written to stdout, and no rogue
non-daemon threads are spawned.

This locks the CLASS of "fully inert when disabled" so future CR rounds stop
re-discovering individual instances of host-state mutation at import.

The assertions run in a FRESH SUBPROCESS so the import-time side effects of
``cvdiag_bootstrap`` are actually observable (a same-process import is cached and
``basicConfig`` is a no-op the second time).
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

# showcase/integrations/_shared/tests/ → showcase/integrations
_INTEGRATIONS_DIR = Path(__file__).resolve().parents[2]

# Child program: pre-configure a host root handler, import the bootstrap with
# cvdiag DISABLED, then assert the import was fully inert. Printed sentinels are
# parsed by the parent so a failure produces a readable diff.
_CHILD = r"""
import logging
import sys
import threading

# (host) Pre-configure the application's own root-logger handler BEFORE importing
# cvdiag — this is the state a real host app has when the backend boots.
_host_handler = logging.StreamHandler(sys.stderr)
_host_handler.set_name("HOST_ROOT_HANDLER")
_root = logging.getLogger()
_root.addHandler(_host_handler)
_root.setLevel(logging.INFO)

_threads_before = {t.ident for t in threading.enumerate()}

import io
_cap = io.StringIO()
_real_stdout = sys.stdout
sys.stdout = _cap
try:
    # cvdiag DISABLED: backend emitter OFF (canary-safe default), no debug.
    import _shared.cvdiag_bootstrap  # noqa: F401  (import-time setup() runs here)
finally:
    sys.stdout = _real_stdout

_stdout_text = _cap.getvalue()

# (1) The host's pre-existing root handler MUST survive the import. This is the
#     RED trigger on the force=True code (basicConfig(force=True) removed it).
_host_present = any(
    getattr(h, "get_name", lambda: None)() == "HOST_ROOT_HANDLER"
    for h in logging.getLogger().handlers
)

# (2) Zero CVDIAG lines written to stdout at import (disabled → nothing emitted).
_no_cvdiag = "CVDIAG " not in _stdout_text

# (3) No rogue non-daemon threads spawned by the import.
_new_threads = [
    t for t in threading.enumerate()
    if t.ident not in _threads_before and not t.daemon
]
_no_nondaemon_threads = len(_new_threads) == 0

print("HOST_PRESENT=" + ("1" if _host_present else "0"))
print("NO_CVDIAG=" + ("1" if _no_cvdiag else "0"))
print("NO_NONDAEMON_THREADS=" + ("1" if _no_nondaemon_threads else "0"))
print("NEW_NONDAEMON_THREADS=" + ",".join(t.name for t in _new_threads))
"""


def _run_child() -> dict[str, str]:
    env_clean = {
        # Inherit a minimal env but ensure cvdiag is fully disabled.
        "PATH": "/usr/bin:/bin",
        "PYTHONPATH": str(_INTEGRATIONS_DIR),
        # Explicitly NOT setting CVDIAG_BACKEND_EMITTER / CVDIAG_DEBUG /
        # CVDIAG_VERBOSE — disabled, canary-safe default.
    }
    proc = subprocess.run(
        [sys.executable, "-c", _CHILD],
        capture_output=True,
        text=True,
        env=env_clean,
        cwd=str(_INTEGRATIONS_DIR),
        timeout=60,
    )
    assert proc.returncode == 0, (
        "child process failed:\nSTDOUT:\n" + proc.stdout + "\nSTDERR:\n" + proc.stderr
    )
    result: dict[str, str] = {}
    for line in proc.stdout.splitlines():
        if "=" in line:
            key, _, val = line.partition("=")
            result[key] = val
    return result


def test_import_is_fully_inert():
    """Importing cvdiag_bootstrap (disabled) must not mutate host logging state."""
    r = _run_child()

    assert r.get("HOST_PRESENT") == "1", (
        "host root-logger handler was torn down by the import-time "
        "basicConfig(force=True); the disabled cvdiag bootstrap must be inert"
    )
    assert r.get("NO_CVDIAG") == "1", (
        "a disabled cvdiag import wrote a CVDIAG line to stdout"
    )
    assert r.get("NO_NONDAEMON_THREADS") == "1", (
        "a disabled cvdiag import spawned non-daemon thread(s): "
        + r.get("NEW_NONDAEMON_THREADS", "")
    )
