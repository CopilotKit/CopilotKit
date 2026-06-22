"""cvdiag_bootstrap.py — single-source CVDIAG runtime bootstrap for every Python
integration backend.

Importing this module (``import _shared.cvdiag_bootstrap``) at the top of an
integration entrypoint does three things, once, at import time:

  1. **Captures the ``agents.*`` loggers** by attaching a SCOPED stream handler
     to the ``agents`` logger so the ``agents._header_forwarding`` (and sibling
     ``agents.*``) loggers actually EMIT. This fixes the silent-drop bug: those
     loggers call ``logger.info(...)`` but, with no handler attached anywhere up
     the hierarchy, the records were being discarded. We attach a dedicated
     handler to the ``agents`` logger (NOT ``basicConfig(force=True)`` on root)
     so the CVDIAG lines reach stdout where the harness greps for them WITHOUT
     tearing down the HOST application's own root-logger configuration — the
     module is fully inert (no global logging mutation) when cvdiag is disabled,
     matching the canary-safe contract the TS emitter upholds.

  2. **Resolves the verbosity tier** (default | verbose | debug) and applies the
     §6 fail-closed guard: ``CVDIAG_DEBUG`` is REFUSED (raises at import time)
     when the deployment environment resolves to ``production`` or cannot be
     resolved at all (unknown env is treated as production).

  3. **Exposes ``emit_cvdiag(envelope)``** — validates the envelope against the
     generated Pydantic model, writes a single ``CVDIAG`` JSON line to stdout,
     and best-effort hands the row to the threaded PocketBase writer.

Pure instrumentation: ``emit_cvdiag`` never throws into the caller. The ONE
permitted raise is the fail-closed DEBUG guard during ``setup()`` (a startup
assertion, mirroring the TS emitter's constructor guard).

Plan unit: L0-C.
"""

from __future__ import annotations

import logging
import os
import sys
from typing import Any, Optional, Union

from _shared.cvdiag_pb_writer import CvdiagPbWriter
from _shared.cvdiag_schema import CvdiagEnvelope

logger = logging.getLogger("agents._cvdiag_bootstrap")

# ── Tier resolution ──────────────────────────────────────────────────────────

# Production-detection env precedence (spec §6):
#   SHOWCASE_ENV → RAILWAY_ENVIRONMENT_NAME → PYTHON_ENV.
_ENV_PRECEDENCE = ("SHOWCASE_ENV", "RAILWAY_ENVIRONMENT_NAME", "PYTHON_ENV")

# Module-level singletons, populated by setup().
_TIER: str = "default"
_PB_WRITER: Optional[CvdiagPbWriter] = None
# Idempotency guard: a successful (or degraded) setup() flips this so any
# repeated invocation is a no-op — repeated calls must NOT orphan a second
# flush daemon / PB writer queue.
_SETUP_DONE = False
# True iff cvdiag instrumentation is active. Flipped OFF (fail-closed) when a
# misconfiguration is detected so the backend keeps running with instrumentation
# disabled rather than crashing at import.
_ENABLED = False
_LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s %(message)s"
# The scoped handler we attach to the ``agents`` logger when ENABLED. Tracked so
# the capture install is idempotent and ``reset_for_test`` can detach it,
# leaving no residual host-logging mutation between tests.
_AGENTS_LOG_NAME = "agents"
_CAPTURE_HANDLER: Optional[logging.Handler] = None


def _install_agents_log_capture() -> None:
    """Attach a scoped stream handler to the ``agents`` logger (idempotent).

    This is the silent-drop fix WITHOUT the global blast radius of
    ``basicConfig(force=True)``: we never touch the root logger's handlers, so
    the host application's own logging configuration is preserved. The handler
    is attached only when cvdiag is ENABLED; a disabled / degraded backend
    leaves host logging byte-for-byte untouched.
    """
    global _CAPTURE_HANDLER
    if _CAPTURE_HANDLER is not None:
        return
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter(_LOG_FORMAT))
    agents_logger = logging.getLogger(_AGENTS_LOG_NAME)
    agents_logger.addHandler(handler)
    # Ensure ``agents.*`` records at INFO survive the level filter even if the
    # host left the (effective) level above INFO; scoped to the agents subtree.
    if agents_logger.level == logging.NOTSET or agents_logger.level > logging.INFO:
        agents_logger.setLevel(logging.INFO)
    _CAPTURE_HANDLER = handler


def resolve_env_label(env: Optional[dict[str, str]] = None) -> Optional[str]:
    """Resolve the deployment-environment label (lowercased) or ``None``.

    Precedence: ``SHOWCASE_ENV`` → ``RAILWAY_ENVIRONMENT_NAME`` → ``PYTHON_ENV``.
    """
    src = env if env is not None else os.environ
    for key in _ENV_PRECEDENCE:
        raw = src.get(key)
        if raw is not None and raw != "":
            return str(raw).lower()
    return None


def _resolve_tier(env: dict[str, str]) -> str:
    """Resolve the verbosity tier, applying the §6 fail-closed DEBUG guard.

    Raises ``RuntimeError`` (fail-closed) when DEBUG is requested but the
    deployment environment is ``production`` or unresolved.
    """
    wants_debug = env.get("CVDIAG_DEBUG") == "1"
    wants_verbose = env.get("CVDIAG_VERBOSE") == "1"
    if wants_debug:
        label = resolve_env_label(env)
        if label is None:
            raise RuntimeError(
                "CVDIAG_DEBUG refused: deployment environment is unresolved "
                "(SHOWCASE_ENV → RAILWAY_ENVIRONMENT_NAME → PYTHON_ENV all "
                "unset); fail-closed treats unknown env as production."
            )
        if label == "production":
            raise RuntimeError(
                "CVDIAG_DEBUG refused: deployment environment is production."
            )
        return "debug"
    if wants_verbose:
        return "verbose"
    return "default"


def setup(env: Optional[dict[str, str]] = None) -> None:
    """Idempotent bootstrap: resolve tier, build the PB writer, capture agents logs.

    Runs once at import time. Three safety contracts:

      * **Idempotent** — a second invocation after a completed setup() is a
        no-op (the ``_SETUP_DONE`` guard); repeated calls must never orphan a
        second flush daemon / PB writer queue.
      * **Inert when disabled** — a disabled / degraded setup() performs NO
        logging mutation: the scoped ``agents`` capture handler is installed
        only on the ENABLED path, and the root logger is never touched. Merely
        importing this module when cvdiag is off leaves the host application's
        logging configuration byte-for-byte intact (canary-safe).
      * **Degrade-not-crash** — a misconfiguration (e.g. the §6 fail-closed
        DEBUG guard) DISABLES cvdiag instrumentation and logs a warning; it
        must NEVER propagate and abort the host backend's module import. The
        fail-closed *intent* is preserved (instrumentation stays OFF on a
        forbidden DEBUG request) but the backend keeps running. This mirrors
        the TS emitter: it throws at construction, but the wrapper catches it
        so the host app survives.
    """
    global _TIER, _PB_WRITER, _SETUP_DONE, _ENABLED

    # (0) Idempotency guard — repeated setup() is a no-op (FIX-3).
    if _SETUP_DONE:
        return

    src = env if env is not None else dict(os.environ)

    # (1) Resolve tier. ``_resolve_tier`` raises (fail-closed) on a forbidden
    # DEBUG request — catch it here so a misconfig DEGRADES (instrumentation
    # OFF) rather than crashing the backend import (FIX-2).
    try:
        _TIER = _resolve_tier(src)
    except RuntimeError as err:
        _TIER = "default"
        _ENABLED = False
        _PB_WRITER = None
        _SETUP_DONE = True
        logger.warning(
            "CVDIAG bootstrap degraded component=_shared reason=%s "
            "(instrumentation disabled; backend continues)",
            err,
        )
        return

    # (2) Build the threaded PB writer (no-op when CVDIAG_PB_URL unset).
    _PB_WRITER = CvdiagPbWriter(
        pb_url=src.get("CVDIAG_PB_URL"),
        writer_key=src.get("CVDIAG_WRITER_KEY"),
    )

    _ENABLED = True
    _SETUP_DONE = True

    # (3) Only NOW — once instrumentation is confirmed ENABLED — install the
    # scoped ``agents`` logger capture. A disabled / degraded setup (the early
    # returns above) reaches neither this nor any other logging mutation, so
    # importing the bootstrap is fully inert when cvdiag is disabled — it never
    # touches the host application's root-logger handlers.
    _install_agents_log_capture()
    logger.info(
        "CVDIAG bootstrap component=_shared tier=%s pb_enabled=%s",
        _TIER,
        str(_PB_WRITER.enabled).lower(),
    )


def current_tier() -> str:
    """Return the resolved tier (``default`` | ``verbose`` | ``debug``)."""
    return _TIER


def is_enabled() -> bool:
    """True iff cvdiag instrumentation is active (False after a degraded setup)."""
    return _ENABLED


def reset_for_test() -> None:
    """Reset module state so a test can re-run ``setup()`` from scratch.

    Test-only helper: clears the idempotency guard and singletons. The flush
    daemon is a short-lived best-effort daemon thread, so we simply drop the
    reference (the thread exits with the process); we do not join it.

    Also detaches the scoped ``agents`` capture handler so each test starts from
    an unmutated logging tree (otherwise an enabled setup() would leave a
    handler attached across tests).
    """
    global _TIER, _PB_WRITER, _SETUP_DONE, _ENABLED, _CAPTURE_HANDLER
    _TIER = "default"
    _PB_WRITER = None
    _SETUP_DONE = False
    _ENABLED = False
    if _CAPTURE_HANDLER is not None:
        logging.getLogger(_AGENTS_LOG_NAME).removeHandler(_CAPTURE_HANDLER)
        _CAPTURE_HANDLER = None


def emit_cvdiag(envelope: Union[CvdiagEnvelope, dict[str, Any]]) -> None:
    """Emit one CVDIAG envelope: validate → JSON line to stdout → best-effort PB.

    Pure instrumentation — catches every error and degrades to a single
    ``CVDIAG emit-failed`` log line; never raises into the caller.

    The shared emit gate is the single chokepoint every integration's backend
    emitter routes through. It honors the ``_ENABLED`` flag (``is_enabled()``)
    so a DEGRADED setup() (the §6 fail-closed DEBUG misconfig) actually
    SUPPRESSES emission — the degrade must win over a live
    ``CVDIAG_BACKEND_EMITTER=1`` toggle, otherwise the fail-closed intent is
    silently defeated and a degraded backend keeps writing envelopes.
    """
    # Degrade gate: a disabled (degraded) backend emits nothing, regardless of
    # the per-integration CVDIAG_BACKEND_EMITTER toggle.
    if not is_enabled():
        return
    try:
        model = (
            envelope
            if isinstance(envelope, CvdiagEnvelope)
            else CvdiagEnvelope.model_validate(envelope)
        )
        payload = model.model_dump(by_alias=True, exclude_none=False)
        # One JSON line to stdout, ``CVDIAG`` tagged so the harness greps it.
        sys.stdout.write("CVDIAG " + _dump_json(payload) + "\n")
        sys.stdout.flush()
        if _PB_WRITER is not None:
            _PB_WRITER.enqueue(payload)
    except Exception as err:  # noqa: BLE001 - instrumentation must not throw
        logger.warning("CVDIAG emit-failed error=%s", err)


def _dump_json(payload: dict[str, Any]) -> str:
    import json

    return json.dumps(payload, separators=(",", ":"), default=str)


# Run the bootstrap at import time (the whole point — importing this module
# wires logging + tier + PB writer for the integration entrypoint).
setup()
