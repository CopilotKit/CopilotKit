"""cvdiag_pb_writer.py — best-effort, background (threaded) PocketBase flush for
CVDIAG envelopes emitted from the Python integration backends.

Contract (spec §7 — pure instrumentation, never blocks the observed boundary):
  - ``enqueue(envelope)`` returns immediately; it only appends to an in-memory
    queue. A single daemon worker thread drains the queue on a ≤1s window and
    POSTs to the PocketBase ``cvdiag_events`` collection (CREATE-only).
  - A PB write failure is swallowed and logged once as
    ``CVDIAG pb-write-failed`` — it must NEVER propagate into the caller.
  - When ``CVDIAG_PB_URL`` is unset the writer is a no-op sink (enqueue still
    returns immediately; nothing is flushed). This keeps local/unit runs free
    of network side effects.

Authentication (see the 1779990200_create_cvdiag_events.js migration):
  The ``cvdiag_events`` createRule requires the caller to authenticate as a
  ``cvdiag_api_keys`` auth record whose ``role`` is ``"writer"`` —

    @request.auth.collectionName = "cvdiag_api_keys" && @request.auth.role = "writer"

  PocketBase has NO notion of a bespoke header, so a header-only request is
  UNAUTHENTICATED and the CREATE 4xxs (the createRule evaluates false). The
  writer therefore POSTs ``/api/collections/cvdiag_api_keys/auth-with-password``
  with the fixed writer identity (``cvdiag-writer@keys.local`` — overridable via
  ``CVDIAG_WRITER_IDENTITY``) and ``CVDIAG_WRITER_KEY`` as the PASSWORD, caches
  the returned token, and sends ``Authorization: Bearer <token>`` on the CREATE.
  A 401 (token expiry / bad creds) clears the cached token and triggers a single
  re-auth + retry. Auth failure stays best-effort: it degrades to a no-op + the
  one-shot ``CVDIAG pb-write-failed`` warn — it NEVER crashes the daemon.

Plan unit: L0-C.
"""

from __future__ import annotations

import json
import logging
import os
import queue
import threading
import urllib.error
import urllib.request
from typing import Any, Optional

logger = logging.getLogger("agents._cvdiag_pb_writer")

# Flush window: drain at least this often (spec §7 R5-F12: ≤1s window).
FLUSH_WINDOW_S = 1.0
# Bounded queue — drop-oldest on overflow so a stuck flush can't grow unbounded.
QUEUE_CAP = 5000
# Per-flush HTTP timeout so a hung PB never wedges the worker thread.
HTTP_TIMEOUT_S = 5.0
# Auth collection + fixed default identity of the seeded writer record. The
# migration seeds email ``cvdiag-writer@keys.local`` with role ``writer``;
# CVDIAG_WRITER_KEY is that record's PASSWORD. The identity is overridable for
# environments that rotate the writer email, but defaults to the seeded value.
WRITER_AUTH_COLLECTION = "cvdiag_api_keys"
DEFAULT_WRITER_IDENTITY = "cvdiag-writer@keys.local"


class CvdiagPbWriter:
    """Threaded, best-effort PocketBase writer. Construct once at import time.

    The worker thread is a daemon so it never keeps the process alive on exit.
    """

    def __init__(
        self,
        pb_url: Optional[str] = None,
        writer_key: Optional[str] = None,
        *,
        writer_identity: Optional[str] = None,
        flush_window_s: float = FLUSH_WINDOW_S,
    ) -> None:
        self._pb_url = pb_url if pb_url is not None else os.environ.get("CVDIAG_PB_URL")
        self._writer_key = (
            writer_key
            if writer_key is not None
            else os.environ.get("CVDIAG_WRITER_KEY")
        )
        self._writer_identity = (
            writer_identity
            if writer_identity is not None
            else os.environ.get("CVDIAG_WRITER_IDENTITY", DEFAULT_WRITER_IDENTITY)
        )
        self._flush_window_s = flush_window_s
        self._queue: "queue.Queue[dict[str, Any]]" = queue.Queue(maxsize=QUEUE_CAP)
        self._logged_failure = False
        self._started = False
        self._lock = threading.Lock()
        self._worker: Optional[threading.Thread] = None
        # Cached auth-with-password token. Only the single daemon worker thread
        # touches this (auth + CREATE both run inside ``_run``), so no lock is
        # needed. ``None`` means "not authenticated yet / cleared after a 401".
        self._auth_token: Optional[str] = None

    @property
    def enabled(self) -> bool:
        """True iff a PB target URL is configured (otherwise this is a no-op)."""
        return bool(self._pb_url)

    def _ensure_worker(self) -> None:
        if self._started:
            return
        with self._lock:
            if self._started:
                return
            self._worker = threading.Thread(
                target=self._run,
                name="cvdiag-pb-writer",
                daemon=True,
            )
            self._worker.start()
            self._started = True

    def enqueue(self, envelope: dict[str, Any]) -> None:
        """Queue one envelope for background flush. Never blocks; never raises.

        On a full queue we drop the OLDEST entry (instrumentation must shed
        load rather than block the boundary it observes).
        """
        if not self.enabled:
            return
        try:
            self._ensure_worker()
            try:
                self._queue.put_nowait(envelope)
            except queue.Full:
                # Drop-oldest, then retry once. Best-effort; never block.
                try:
                    self._queue.get_nowait()
                except queue.Empty:
                    pass
                try:
                    self._queue.put_nowait(envelope)
                except queue.Full:
                    pass
        except Exception as err:  # pragma: no cover - defensive belt
            self._log_failure(err)

    def _run(self) -> None:
        while True:
            try:
                envelope = self._queue.get(timeout=self._flush_window_s)
            except queue.Empty:
                continue
            batch = [envelope]
            # Coalesce anything else already queued into this flush.
            while True:
                try:
                    batch.append(self._queue.get_nowait())
                except queue.Empty:
                    break
            for env in batch:
                # Never-propagate: isolate each record so no single envelope
                # can unwind ``_run`` and PERMANENTLY kill the flush daemon.
                try:
                    self._post(env)
                except Exception as err:  # noqa: BLE001 - daemon must survive
                    self._log_failure(err)

    def _authenticate(self) -> Optional[str]:
        """Auth-with-password as the writer role; return + cache the token.

        Returns the cached token if present, else POSTs the writer identity +
        ``CVDIAG_WRITER_KEY`` (the writer record PASSWORD) to the
        ``cvdiag_api_keys`` auth-with-password endpoint and caches the token.
        Returns ``None`` on any failure (bad creds, unreachable PB, malformed
        response) — the caller degrades to a no-op. NEVER raises.
        """
        if self._auth_token:
            return self._auth_token
        url = self._pb_url
        if not url or not self._writer_key:
            return None
        endpoint = (
            url.rstrip("/")
            + f"/api/collections/{WRITER_AUTH_COLLECTION}/auth-with-password"
        )
        body = json.dumps(
            {"identity": self._writer_identity, "password": self._writer_key}
        ).encode("utf-8")
        req = urllib.request.Request(
            endpoint,
            data=body,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        token = payload.get("token")
        if not token:
            return None
        self._auth_token = token
        return token

    def _post(self, envelope: dict[str, Any]) -> None:
        url = self._pb_url
        if not url:
            return
        endpoint = url.rstrip("/") + "/api/collections/cvdiag_events/records"
        # Never-propagate: a single bad record (e.g. a non-JSON-serializable
        # envelope that makes ``json.dumps`` raise ``TypeError``) or an auth
        # failure must be logged/dropped, NOT allowed to escape and kill the
        # drain daemon. This mirrors the TS pb-writer ``writeBatch`` contract —
        # one bad row / a failed auth degrades to a warn; the worker survives.
        try:
            body = json.dumps(envelope).encode("utf-8")
            # Authenticate as the writer-role record (createRule requires it).
            # On a 401 (token expiry / stale token) clear the cache and re-auth
            # once before giving up — but never loop.
            self._create_with_auth(endpoint, body, allow_reauth=True)
        except Exception as err:  # noqa: BLE001 - instrumentation must never throw
            self._log_failure(err)

    def _create_with_auth(
        self, endpoint: str, body: bytes, *, allow_reauth: bool
    ) -> None:
        """POST the CREATE with a Bearer token; re-auth once on a 401."""
        token = self._authenticate()
        if not token:
            # Auth failed (bad/missing writer key, unreachable PB). Degrade to a
            # no-op + the one-shot warn — never crash the daemon.
            self._log_failure(RuntimeError("CVDIAG writer auth failed"))
            return
        req = urllib.request.Request(
            endpoint,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}",
            },
        )
        try:
            urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S).close()
        except urllib.error.HTTPError as err:
            # 401 → token expired / revoked. Clear the cache and re-auth ONCE.
            if err.code == 401 and allow_reauth:
                self._auth_token = None
                self._create_with_auth(endpoint, body, allow_reauth=False)
                return
            raise

    def _log_failure(self, err: Exception) -> None:
        # Log the first failure at WARNING; subsequent ones at DEBUG to avoid
        # spamming the log on a sustained PB outage.
        if not self._logged_failure:
            self._logged_failure = True
            logger.warning("CVDIAG pb-write-failed error=%s", err)
        else:
            logger.debug("CVDIAG pb-write-failed error=%s", err)
