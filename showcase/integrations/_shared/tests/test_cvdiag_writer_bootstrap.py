"""test_cvdiag_writer_bootstrap.py — functional regression suite for the three
M5 CR R1 fixes in the Python ``_shared`` CVDIAG core:

  FIX-1  cvdiag_pb_writer drain loop never-propagate: a non-JSON-serializable
         envelope must NOT kill the flush daemon (mirrors TS pb-writer
         writeBatch — one bad row degrades, the batch/daemon survives).
  FIX-2  cvdiag_bootstrap.setup() degrade-not-crash: a fail-closed DEBUG
         misconfig must DISABLE instrumentation, not raise out of import.
  FIX-3  cvdiag_bootstrap.setup() idempotency: a repeated call is a no-op and
         never orphans a second daemon thread / PB writer.

Imports the package as ``_shared.*`` to mirror the runtime layout; conftest.py
puts ``showcase/integrations`` on sys.path.
"""

from __future__ import annotations

import threading
import time

from _shared import cvdiag_bootstrap
from _shared.cvdiag_pb_writer import CvdiagPbWriter


class _Unserializable:
    """An object json.dumps cannot encode (raises TypeError in _post)."""


def _drain_thread_alive(writer: CvdiagPbWriter) -> bool:
    worker = writer._worker
    return worker is not None and worker.is_alive()


# ── FIX-1: drain loop never-propagate ────────────────────────────────────────


def test_drain_survives_non_json_serializable_envelope(monkeypatch):
    """A non-JSON-serializable record must not kill the daemon; a later valid
    record still flushes.

    RED (pre-fix): ``_post`` lets ``TypeError`` from ``json.dumps`` escape the
    ``except (URLError, OSError, ValueError)`` clause; the exception unwinds
    ``_run`` and the daemon thread dies — the later valid envelope is never
    POSTed.
    """
    writer = CvdiagPbWriter(pb_url="http://pb.invalid", flush_window_s=0.05)

    posted: list[dict] = []

    # Stub the HTTP layer: record what reaches the wire after json.dumps.
    def _fake_post(envelope):
        # Re-run the real serialization seam so a bad envelope still throws
        # inside the drain loop, but a good one is "delivered" without network.
        import json as _json

        _json.dumps(envelope)  # raises TypeError on the bad envelope
        posted.append(envelope)

    monkeypatch.setattr(writer, "_post", _fake_post)

    # Bad record first — pre-fix this kills the drain thread.
    writer.enqueue({"bad": _Unserializable()})
    # Give the worker a couple of flush windows to process the bad record.
    time.sleep(0.2)

    # Then a perfectly valid record.
    writer.enqueue({"ok": True, "n": 1})
    time.sleep(0.2)

    assert _drain_thread_alive(writer), "drain daemon must survive a bad record"
    assert {"ok": True, "n": 1} in posted, "valid record must still flush"


def test_post_swallows_typeerror_on_unserializable(monkeypatch):
    """``_post`` itself must not raise on a non-serializable envelope.

    RED (pre-fix): the ``TypeError`` from ``json.dumps`` is uncaught and
    propagates out of ``_post`` (only URLError/OSError/ValueError are caught).
    """
    writer = CvdiagPbWriter(pb_url="http://pb.invalid")
    # Should NOT raise — _post is the never-throw persistence seam.
    writer._post({"bad": _Unserializable()})


# ── FIX-2: bootstrap degrade-not-crash ───────────────────────────────────────


def test_setup_degrades_on_failclosed_debug_misconfig():
    """A fail-closed DEBUG misconfig DISABLES instrumentation instead of raising.

    RED (pre-fix): ``setup({"CVDIAG_DEBUG": "1"})`` (unresolved env → treated as
    production) raises ``RuntimeError`` out of setup(), which at import time
    would abort the whole backend module import.
    """
    cvdiag_bootstrap.reset_for_test()
    # Must NOT raise.
    cvdiag_bootstrap.setup({"CVDIAG_DEBUG": "1"})
    # Fail-closed intent preserved: instrumentation is OFF (tier not debug).
    assert cvdiag_bootstrap.current_tier() == "default"
    assert cvdiag_bootstrap.is_enabled() is False

    # Explicit production env with DEBUG also degrades, never raises.
    cvdiag_bootstrap.reset_for_test()
    cvdiag_bootstrap.setup({"CVDIAG_DEBUG": "1", "SHOWCASE_ENV": "production"})
    assert cvdiag_bootstrap.current_tier() == "default"
    assert cvdiag_bootstrap.is_enabled() is False


def test_setup_allows_debug_in_nonproduction():
    """A non-production DEBUG request still enables debug tier (intent intact)."""
    cvdiag_bootstrap.reset_for_test()
    cvdiag_bootstrap.setup({"CVDIAG_DEBUG": "1", "SHOWCASE_ENV": "staging"})
    assert cvdiag_bootstrap.current_tier() == "debug"
    assert cvdiag_bootstrap.is_enabled() is True


# ── FIX-3: bootstrap idempotency ─────────────────────────────────────────────


def test_setup_is_idempotent_no_orphan_daemon():
    """A second setup() is a no-op: no second PB writer / daemon thread.

    RED (pre-fix): no ``_SETUP_DONE`` guard in setup(), so a second call rebuilds
    ``_PB_WRITER`` (orphaning the first writer's queue) and a subsequent enqueue
    spins a second ``cvdiag-pb-writer`` daemon thread.
    """
    cvdiag_bootstrap.reset_for_test()

    # Count daemon threads BEFORE this test so the assertion is robust to
    # daemons left alive by earlier tests in the suite (short-lived best-effort
    # daemons are not joined on reset).
    def _pb_daemon_count() -> int:
        return sum(1 for t in threading.enumerate() if t.name == "cvdiag-pb-writer")

    before = _pb_daemon_count()

    cvdiag_bootstrap.setup(
        {"SHOWCASE_ENV": "staging", "CVDIAG_PB_URL": "http://pb.invalid"}
    )
    first_writer = cvdiag_bootstrap._PB_WRITER
    assert first_writer is not None
    first_writer.enqueue({"n": 1})
    time.sleep(0.05)
    after_first = _pb_daemon_count()
    assert after_first == before + 1, (
        "first setup()+enqueue must spin exactly one daemon"
    )

    cvdiag_bootstrap.setup(
        {"SHOWCASE_ENV": "staging", "CVDIAG_PB_URL": "http://pb.invalid"}
    )
    second_writer = cvdiag_bootstrap._PB_WRITER

    assert second_writer is first_writer, (
        "second setup() must not rebuild the PB writer"
    )

    second_writer.enqueue({"n": 2})
    time.sleep(0.05)
    after_second = _pb_daemon_count()
    # The second setup()+enqueue must NOT spin an additional daemon.
    assert after_second == after_first, (
        f"second setup() orphaned a daemon: {before}->{after_first}->{after_second}"
    )
