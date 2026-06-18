"""cvdiag_bootstrap.py — single-source CVDIAG runtime bootstrap for every Python
integration backend.

Importing this module (``import _shared.cvdiag_bootstrap``) at the top of an
integration entrypoint does three things, once, at import time:

  1. **Configures the root logger** via ``logging.basicConfig(level=INFO, …)``
     so the ``agents._header_forwarding`` (and sibling ``agents.*``) loggers
     actually EMIT. This fixes the silent-drop bug: those loggers call
     ``logger.info(...)`` but, with no handler attached to the root logger, the
     records were being discarded. ``basicConfig`` installs a stream handler so
     the CVDIAG lines reach stdout where the harness greps for them.

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
_SETUP_DONE = False
_LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s %(message)s"


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
    """Idempotent bootstrap: configure logging, resolve tier, build the PB writer.

    Runs once at import time. Raises (fail-closed) only on a forbidden DEBUG
    request (spec §6); all other paths are non-throwing.
    """
    global _TIER, _PB_WRITER, _SETUP_DONE
    src = env if env is not None else dict(os.environ)

    # (1) Make the agents.* loggers actually emit. ``force=True`` ensures we
    # install a handler even if some earlier import attached a no-op config;
    # the silent-drop bug is precisely "records produced, no handler".
    logging.basicConfig(level=logging.INFO, format=_LOG_FORMAT, force=True)

    # (2) Resolve tier (may raise — fail-closed DEBUG guard).
    _TIER = _resolve_tier(src)

    # (3) Build the threaded PB writer (no-op when CVDIAG_PB_URL unset).
    _PB_WRITER = CvdiagPbWriter(
        pb_url=src.get("CVDIAG_PB_URL"),
        writer_key=src.get("CVDIAG_WRITER_KEY"),
    )

    _SETUP_DONE = True
    logger.info(
        "CVDIAG bootstrap component=_shared tier=%s pb_enabled=%s",
        _TIER,
        str(_PB_WRITER.enabled).lower(),
    )


def current_tier() -> str:
    """Return the resolved tier (``default`` | ``verbose`` | ``debug``)."""
    return _TIER


def emit_cvdiag(envelope: Union[CvdiagEnvelope, dict[str, Any]]) -> None:
    """Emit one CVDIAG envelope: validate → JSON line to stdout → best-effort PB.

    Pure instrumentation — catches every error and degrades to a single
    ``CVDIAG emit-failed`` log line; never raises into the caller.
    """
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
