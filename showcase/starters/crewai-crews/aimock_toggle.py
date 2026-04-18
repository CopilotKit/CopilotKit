"""
aimock toggle for the CrewAI (Crews) Python agent.

When `AIMOCK_URL` is set, this module redirects litellm / OpenAI SDK traffic
to the aimock endpoint by populating `OPENAI_BASE_URL` and providing a dummy
`OPENAI_API_KEY` if none is set.

Semantics (exact):
- `AIMOCK_URL` unset (or empty / whitespace-only): no-op. Production path.
- `AIMOCK_URL` set + `USE_AIMOCK` unset (or empty): enabled.
- `AIMOCK_URL` set + `USE_AIMOCK` truthy ("1", "true", "yes", "on"): enabled.
- `AIMOCK_URL` set + `USE_AIMOCK` explicitly falsy ("0", "false", "no", "off"):
  disabled. Lets ops turn aimock off without unsetting the URL.
- `AIMOCK_URL` set + `USE_AIMOCK` non-standard value: disabled (WARNING logged).
- `USE_AIMOCK=1` alone (no `AIMOCK_URL`): no-op with a WARNING.

Note: `USE_AIMOCK` is NOT an independent opt-in. Setting `USE_AIMOCK=1` without
`AIMOCK_URL` does not enable the toggle (there is nothing to redirect to).

Design intent:
- Production default UNCHANGED: when `AIMOCK_URL` is unset, behave exactly as
  today (real OpenAI, real `OPENAI_API_KEY` required from env).
- Dev / CI / smoke paths opt in by exporting `AIMOCK_URL` (e.g. to a locally
  running `npx aimock` server or a CI service).
- Operates purely via standard env vars that litellm + OpenAI SDK already
  respect. No runtime dependency on aimock itself; aimock is reached over HTTP.

Usage:
    from aimock_toggle import configure_aimock
    configure_aimock()  # call once at process startup, after load_dotenv()
"""

from __future__ import annotations

import logging
import os
from typing import Literal, MutableMapping, Optional, TypedDict

# NotRequired landed in `typing` in Python 3.11. Local dev on macOS ships
# Python 3.9, so we try stdlib first and fall back to typing_extensions
# (listed in requirements.txt) for 3.10 and below. Both are structurally
# identical and emit the same TypedDict runtime metadata.
try:
    from typing import NotRequired  # type: ignore[attr-defined]
except ImportError:  # pragma: no cover - exercised only on Python < 3.11
    from typing_extensions import NotRequired

logger = logging.getLogger(__name__)

# Env var names — public interface, do not rename without a migration note.
_AIMOCK_URL = "AIMOCK_URL"
_USE_AIMOCK = "USE_AIMOCK"
_OPENAI_BASE_URL = "OPENAI_BASE_URL"
_OPENAI_API_KEY = "OPENAI_API_KEY"
# litellm also reads this alias; set both for belt-and-suspenders.
_LITELLM_API_BASE = "LITELLM_API_BASE"

# Placeholder key used when pointing at aimock with no real key set. litellm /
# openai SDK reject empty / missing keys even when the upstream server does not
# require auth. Self-documenting `sk-` prefix so the value is recognizable if
# it leaks into logs (and satisfies any SDK versions that validate prefix).
#
# The "REPLACE-IN-PROD" suffix used to live here but was misleading: this value
# is ONLY injected when AIMOCK_URL is set, and the prod-guard below refuses to
# apply the toggle when NODE_ENV=production / ENV=production — so the key
# cannot reach real OpenAI. Use a name that describes the actual semantics
# (dev / CI only, never production). The `sk-` prefix still satisfies any SDK
# versions that validate key prefix shape.
_AIMOCK_DUMMY_KEY = "sk-aimock-dev-ci-only"

# Production guard: environments considered "production" for the purposes of
# refusing to apply the aimock toggle. A deploy that accidentally exports
# AIMOCK_URL=... while NODE_ENV=production (or ENV=production) should NOT be
# silently redirected through aimock — fail safe by logging + skipping.
_PROD_ENV_VALUES = {"production", "prod"}
_PROD_ENV_VARS = ("NODE_ENV", "ENV")

_TRUTHY = {"1", "true", "yes", "on"}
_FALSY = {"0", "false", "no", "off"}


class AimockReport(TypedDict):
    """Return shape from ``configure_aimock``.

    ``enabled`` is always present; other fields are populated based on the
    outcome (see ``configure_aimock`` docstring).
    """

    enabled: bool
    reason: NotRequired[str]
    base_url: NotRequired[str]
    key_source: NotRequired[Literal["existing", "dummy"]]


_EnvClassification = Literal[
    "missing", "empty", "whitespace", "truthy", "falsy", "unknown"
]


def _classify(value: Optional[str]) -> _EnvClassification:
    """Classify an env var value into one of six states.

    Callers get the full distinction (``missing`` vs ``empty`` vs
    ``whitespace``) so they don't have to re-derive it by re-reading the raw
    value. Behaviorally, all three are treated as "no value" by the toggle —
    the richer classification is there for diagnostics text only.
    """
    if value is None:
        return "missing"
    if value == "":
        return "empty"
    stripped = value.strip().lower()
    if stripped == "":
        return "whitespace"
    if stripped in _TRUTHY:
        return "truthy"
    if stripped in _FALSY:
        return "falsy"
    return "unknown"


def configure_aimock(
    env: Optional[MutableMapping[str, str]] = None,
) -> AimockReport:
    """Mutate ``env`` (defaults to ``os.environ``) to redirect OpenAI / litellm
    traffic at aimock when ``AIMOCK_URL`` is set, else leave it untouched.

    The env mapping is mutated in place; returning an ``AimockReport`` lets
    callers log or assert on the applied config without re-reading
    ``os.environ``. The report always has ``enabled``; other fields (``reason``,
    ``base_url``, ``key_source``) appear based on the outcome.

    Call once at process startup, AFTER ``load_dotenv()`` but BEFORE any import
    that may construct an OpenAI / litellm client — those libraries latch onto
    ``OPENAI_BASE_URL`` / ``OPENAI_API_KEY`` at import time, and later mutation
    will be invisible to them.
    """
    target: MutableMapping[str, str] = os.environ if env is None else env

    aimock_url_raw = target.get(_AIMOCK_URL)
    aimock_url_class = _classify(aimock_url_raw)
    aimock_url = (aimock_url_raw or "").strip()
    use_aimock_class = _classify(target.get(_USE_AIMOCK))

    # Production guard: if any of the recognized prod env vars is set to a
    # prod-ish value AND AIMOCK_URL is actually set, refuse to apply the
    # toggle — even if AIMOCK_URL is set. Rationale: AIMOCK_URL leaking into
    # a prod deploy config should never silently redirect real traffic through
    # a mock server. Log a loud WARNING so operators see the misconfiguration.
    #
    # Guarded on `aimock_url` being non-empty: if NODE_ENV=production but
    # AIMOCK_URL is unset, there's nothing to refuse — the toggle is already
    # going to no-op down the normal `if not aimock_url` path below. Returning
    # a "refused" reason there would be misleading ("refused" implies the
    # operator actively tried to enable something; unset + prod is just the
    # default prod path).
    if aimock_url:
        for var in _PROD_ENV_VARS:
            raw = target.get(var)
            if raw is not None and raw.strip().lower() in _PROD_ENV_VALUES:
                logger.warning(
                    "%s=%r indicates production; refusing to apply aimock "
                    "toggle even though AIMOCK_URL=%r is set. Unset "
                    "AIMOCK_URL in prod or set USE_AIMOCK=0.",
                    var,
                    raw,
                    aimock_url_raw,
                )
                return {
                    "enabled": False,
                    "reason": f"{var}={raw!r} indicates production — aimock toggle refused",
                }

    if not aimock_url:
        # Map the six-way classification onto a human-readable diagnostic.
        # "missing" → never set; "empty" → set to ""; "whitespace" → set to
        # whitespace-only. We lump "empty" and "whitespace" under one label
        # because they're indistinguishable in most shell / .env contexts.
        url_state = (
            "unset"
            if aimock_url_class == "missing"
            else "empty or whitespace-only"
        )
        if use_aimock_class == "truthy":
            logger.warning(
                "USE_AIMOCK is set but AIMOCK_URL is %s — "
                "falling back to real OpenAI. Export AIMOCK_URL to enable.",
                url_state,
            )
            return {
                "enabled": False,
                "reason": f"USE_AIMOCK set but AIMOCK_URL is {url_state}",
            }
        return {
            "enabled": False,
            "reason": f"AIMOCK_URL {url_state}",
        }

    # AIMOCK_URL is set. Honor USE_AIMOCK override rules:
    # - missing / empty / whitespace (no explicit value) → enable (default)
    # - "truthy" → enable
    # - "falsy" → disable (explicit opt-out)
    # - "unknown" → disable + WARNING (non-standard value, fail safe)
    if use_aimock_class == "falsy":
        logger.info(
            "AIMOCK_URL is set but USE_AIMOCK=%s is falsy — skipping aimock redirect.",
            target.get(_USE_AIMOCK),
        )
        return {"enabled": False, "reason": "USE_AIMOCK explicitly disabled"}
    if use_aimock_class == "unknown":
        logger.warning(
            "USE_AIMOCK=%r is not a recognized truthy/falsy value "
            "(expected one of %s or %s) — treating as disabled. "
            "Set USE_AIMOCK=1 or unset it to enable.",
            target.get(_USE_AIMOCK),
            sorted(_TRUTHY),
            sorted(_FALSY),
        )
        return {"enabled": False, "reason": "USE_AIMOCK unrecognized value"}

    # If operator pre-set OPENAI_BASE_URL / LITELLM_API_BASE (Azure gateway,
    # corporate proxy, etc.) and the pre-set value differs from AIMOCK_URL,
    # log at WARNING so the override is obvious in deployment logs. INFO-level
    # would have been easy to miss when chasing down "why is my gateway not
    # being hit". Both vars get the warning for symmetry — they are overwritten
    # together, so they must also report overrides together.
    for var in (_OPENAI_BASE_URL, _LITELLM_API_BASE):
        existing_raw = target.get(var)
        existing_stripped = (existing_raw or "").strip()
        # Compare RAW values (not the stripped ones) for the warning predicate —
        # otherwise var="  http://x  " vs AIMOCK_URL="http://x" would be
        # considered equal and the override would be silent. The operator
        # provided that whitespace deliberately or by accident — either way
        # they need to see that their value is being replaced.
        if existing_stripped != "" and existing_raw != aimock_url_raw:
            # Log the RAW pre-set value (not the stripped one) so any whitespace
            # drift in the operator-provided env is visible in the warning.
            logger.warning(
                "%s=%r was pre-set and will be overwritten by "
                "AIMOCK_URL=%r. Unset AIMOCK_URL (or set USE_AIMOCK=0) to keep "
                "the existing base URL.",
                var,
                existing_raw,
                aimock_url_raw,
            )

    target[_OPENAI_BASE_URL] = aimock_url
    target[_LITELLM_API_BASE] = aimock_url

    # Treat None, "" AND whitespace-only OPENAI_API_KEY as missing — litellm /
    # openai SDK reject whitespace keys as surely as empty ones, and the old
    # `not target.get(...)` check returned False for "   " (truthy string).
    key_source: Literal["existing", "dummy"] = "existing"
    existing_key = (target.get(_OPENAI_API_KEY) or "").strip()
    if not existing_key:
        target[_OPENAI_API_KEY] = _AIMOCK_DUMMY_KEY
        key_source = "dummy"

    logger.info(
        "aimock toggle: enabled (base_url=%s, key_source=%s)",
        aimock_url,
        key_source,
    )
    return {"enabled": True, "base_url": aimock_url, "key_source": key_source}
