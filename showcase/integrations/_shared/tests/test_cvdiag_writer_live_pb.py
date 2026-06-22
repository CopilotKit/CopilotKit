"""test_cvdiag_writer_live_pb.py — live-PocketBase auth proof for the Python
CVDIAG PB writer.

Boots an ACTUAL PocketBase 0.22 server using the EXACT production migrations
(showcase/pocketbase/pb_migrations), which create ``cvdiag_events`` + the
``cvdiag_api_keys`` auth collection + the seeded role-keyed records (writer /
purge / migration). It then drives the real ``CvdiagPbWriter`` against that
server and asserts the CREATE-only ACL is satisfied **as the writer role**.

WHY WRITER-ROLE (not superuser): the PB superuser bypasses ALL collection
rules, so a writer that never authenticates would still "succeed" if probed as
a superuser — that is exactly how the original defect (the inert
``X-Cvdiag-Writer-Key`` header) escaped review. The createRule

    @request.auth.collectionName = "cvdiag_api_keys" && @request.auth.role = "writer"

is only satisfiable by authenticating as the seeded writer record and sending
``Authorization: Bearer <token>``. We therefore drive the writer with the
writer record's PASSWORD as ``CVDIAG_WRITER_KEY`` and verify the row lands by
querying ``cvdiag_events`` AS THE SUPERUSER (read-only, rule-bypassing) — the
write path under test is never superuser.

Requires a ``pocketbase`` binary: set ``POCKETBASE_BIN`` to its path, put it on
PATH, or drop it at ``/tmp/pb022/pocketbase``. The suite SKIPS (does not fail)
when no binary is available so CI without the binary stays green.
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Optional

import pytest

from _shared.cvdiag_pb_writer import CvdiagPbWriter

# These mirror the seed records created by the cvdiag_api_keys migration
# (showcase/pocketbase/pb_migrations/1779990200_create_cvdiag_events.js).
WRITER_EMAIL = "cvdiag-writer@keys.local"
WRITER_PASS = "cvdiagwriterpass123"

# A superuser used ONLY to read rows back (rule-bypassing read); never the
# write path under test.
ADMIN_EMAIL = "cvdiag-py-acl@test.local"
ADMIN_PASS = "cvdiagpyaclpass123"

# showcase/integrations/_shared/tests/ → repo root → showcase/pocketbase
_REPO_ROOT = Path(__file__).resolve().parents[4]
_MIGRATIONS_DIR = _REPO_ROOT / "showcase" / "pocketbase" / "pb_migrations"


def _resolve_pb_binary() -> Optional[str]:
    explicit = os.environ.get("POCKETBASE_BIN")
    if explicit and Path(explicit).is_file():
        return explicit
    on_path = shutil.which("pocketbase")
    if on_path:
        return on_path
    if Path("/tmp/pb022/pocketbase").is_file():
        return "/tmp/pb022/pocketbase"
    return None


_PB_BIN = _resolve_pb_binary()

pytestmark = pytest.mark.skipif(
    _PB_BIN is None,
    reason="no pocketbase binary (set POCKETBASE_BIN, PATH, or /tmp/pb022/pocketbase)",
)


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_for_health(base: str, timeout_s: float = 15.0) -> None:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"{base}/api/health", timeout=1.0) as r:
                if r.status == 200:
                    return
        except (urllib.error.URLError, OSError):
            pass
        time.sleep(0.2)
    raise RuntimeError("PocketBase did not become healthy in time")


def _admin_token(base: str) -> str:
    body = json.dumps({"identity": ADMIN_EMAIL, "password": ADMIN_PASS}).encode()
    req = urllib.request.Request(
        f"{base}/api/admins/auth-with-password",
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=5.0) as r:
        return json.loads(r.read())["token"]


def _count_events(base: str, test_id: str) -> int:
    """Count cvdiag_events rows for one test_id, reading AS SUPERUSER."""
    tok = _admin_token(base)
    flt = urllib.parse.quote(f'test_id="{test_id}"')
    req = urllib.request.Request(
        f"{base}/api/collections/cvdiag_events/records?filter={flt}",
        headers={"Authorization": tok},
    )
    with urllib.request.urlopen(req, timeout=5.0) as r:
        return json.loads(r.read())["totalItems"]


@pytest.fixture(scope="module")
def live_pb():
    """Boot a real PB with the production migrations; yield its base URL."""
    # skipif(_PB_BIN is None) guarantees a binary at runtime; narrow to a
    # concrete str so subprocess calls don't take a `str | None` arg.
    pb_bin = _PB_BIN
    assert pb_bin is not None
    data_dir = tempfile.mkdtemp(prefix="pb-cvdiag-py-")
    try:
        mig = subprocess.run(
            [
                pb_bin,
                "migrate",
                "up",
                f"--dir={data_dir}",
                f"--migrationsDir={_MIGRATIONS_DIR}",
            ],
            capture_output=True,
            text=True,
        )
        if mig.returncode != 0:
            raise RuntimeError(f"pb migrate up failed: {mig.stderr or mig.stdout}")
        admin = subprocess.run(
            [pb_bin, "admin", "create", ADMIN_EMAIL, ADMIN_PASS, f"--dir={data_dir}"],
            capture_output=True,
            text=True,
        )
        if admin.returncode != 0:
            raise RuntimeError(
                f"pb admin create failed: {admin.stderr or admin.stdout}"
            )
        port = _free_port()
        base = f"http://127.0.0.1:{port}"
        proc = subprocess.Popen(
            [
                pb_bin,
                "serve",
                f"--http=127.0.0.1:{port}",
                f"--dir={data_dir}",
                f"--migrationsDir={_MIGRATIONS_DIR}",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        try:
            _wait_for_health(base)
            yield base
        finally:
            proc.kill()
            proc.wait(timeout=5)
    finally:
        shutil.rmtree(data_dir, ignore_errors=True)


def _flush_one(writer: CvdiagPbWriter, envelope: dict) -> None:
    """Enqueue one envelope and let the daemon drain it (flush window 0.05s)."""
    writer.enqueue(envelope)
    # Give the worker a few flush windows to drain + POST + (re-)auth.
    time.sleep(1.0)


def _event(test_id: str) -> dict:
    return {
        "schema_version": 1,
        "test_id": test_id,
        "trace_id": test_id,
        "span_id": "0000000000000001",
        "parent_span_id": None,
        "layer": "backend",
        "boundary": "backend.handle",
        "slug": "langgraph-python",
        "demo": "chat",
        "ts": "2026-06-18T00:00:00.000Z",
        "mono_ns": 1,
        "duration_ms": None,
        "outcome": "ok",
        "edge_headers": {},
        "metadata": {"src": "live-pb-test"},
    }


def test_writer_authenticates_as_writer_role_and_persists(live_pb):
    """GREEN: the writer auth-with-passwords as the writer role → CREATE 201 →
    the row is present in cvdiag_events (read back as superuser).

    This is the fix for the inert ``X-Cvdiag-Writer-Key`` header: without
    auth-with-password → Bearer the CREATE 403s under the writer createRule.
    """
    test_id = "0190a0c0-0000-7000-8000-00000000a001"
    # Pre-condition: no row yet.
    assert _count_events(live_pb, test_id) == 0

    writer = CvdiagPbWriter(
        pb_url=live_pb,
        writer_key=WRITER_PASS,  # CVDIAG_WRITER_KEY == the writer record password
        flush_window_s=0.05,
    )
    _flush_one(writer, _event(test_id))

    # The CREATE went through the CREATE-only writer rule → row present.
    assert _count_events(live_pb, test_id) == 1


def test_writer_with_wrong_password_degrades_to_noop(live_pb):
    """A WRONG password must degrade to a no-op (auth fails, CREATE 401/403)
    WITHOUT crashing the daemon — never-throw preserved.
    """
    test_id = "0190a0c0-0000-7000-8000-00000000a002"
    assert _count_events(live_pb, test_id) == 0

    writer = CvdiagPbWriter(
        pb_url=live_pb,
        writer_key="totally-wrong-password",
        flush_window_s=0.05,
    )
    _flush_one(writer, _event(test_id))

    # No row landed (auth failed) AND the daemon survived (no crash).
    assert _count_events(live_pb, test_id) == 0
    worker = writer._worker
    assert worker is not None and worker.is_alive(), (
        "daemon must survive an auth failure (never-throw)"
    )
