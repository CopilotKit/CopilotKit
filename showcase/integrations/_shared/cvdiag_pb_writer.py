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

Plan unit: L0-C.
"""

from __future__ import annotations

import json
import logging
import os
import queue
import threading
import urllib.request
from typing import Any, Optional

logger = logging.getLogger("agents._cvdiag_pb_writer")

# Flush window: drain at least this often (spec §7 R5-F12: ≤1s window).
FLUSH_WINDOW_S = 1.0
# Bounded queue — drop-oldest on overflow so a stuck flush can't grow unbounded.
QUEUE_CAP = 5000
# Per-flush HTTP timeout so a hung PB never wedges the worker thread.
HTTP_TIMEOUT_S = 5.0


class CvdiagPbWriter:
    """Threaded, best-effort PocketBase writer. Construct once at import time.

    The worker thread is a daemon so it never keeps the process alive on exit.
    """

    def __init__(
        self,
        pb_url: Optional[str] = None,
        writer_key: Optional[str] = None,
        *,
        flush_window_s: float = FLUSH_WINDOW_S,
    ) -> None:
        self._pb_url = pb_url if pb_url is not None else os.environ.get("CVDIAG_PB_URL")
        self._writer_key = (
            writer_key
            if writer_key is not None
            else os.environ.get("CVDIAG_WRITER_KEY")
        )
        self._flush_window_s = flush_window_s
        self._queue: "queue.Queue[dict[str, Any]]" = queue.Queue(maxsize=QUEUE_CAP)
        self._logged_failure = False
        self._started = False
        self._lock = threading.Lock()
        self._worker: Optional[threading.Thread] = None

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

    def _post(self, envelope: dict[str, Any]) -> None:
        url = self._pb_url
        if not url:
            return
        endpoint = url.rstrip("/") + "/api/collections/cvdiag_events/records"
        # Never-propagate: a single bad record (e.g. a non-JSON-serializable
        # envelope that makes ``json.dumps`` raise ``TypeError``) must be
        # logged/dropped, NOT allowed to escape and kill the drain daemon.
        # This mirrors the TS pb-writer ``writeBatch`` contract — one bad row
        # degrades to a warn; the batch (and the worker) survives.
        try:
            body = json.dumps(envelope).encode("utf-8")
            req = urllib.request.Request(
                endpoint,
                data=body,
                method="POST",
                headers={"Content-Type": "application/json"},
            )
            if self._writer_key:
                req.add_header("X-Cvdiag-Writer-Key", self._writer_key)
            urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S).close()
        except Exception as err:  # noqa: BLE001 - instrumentation must never throw
            self._log_failure(err)

    def _log_failure(self, err: Exception) -> None:
        # Log the first failure at WARNING; subsequent ones at DEBUG to avoid
        # spamming the log on a sustained PB outage.
        if not self._logged_failure:
            self._logged_failure = True
            logger.warning("CVDIAG pb-write-failed error=%s", err)
        else:
            logger.debug("CVDIAG pb-write-failed error=%s", err)
