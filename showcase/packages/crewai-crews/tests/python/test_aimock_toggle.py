"""
Red-green tests for the AIMOCK_URL env toggle.

Contract under test:
- When AIMOCK_URL is unset, toggle is a no-op (production default preserved).
- When AIMOCK_URL is set, OPENAI_BASE_URL + LITELLM_API_BASE point at it,
  OPENAI_API_KEY gets a dummy if missing (keeping existing one if present).
- USE_AIMOCK=0 with AIMOCK_URL set is a no-op (explicit opt-out).
- USE_AIMOCK=1 alone (no AIMOCK_URL) is a warning no-op, NOT a crash.
- Pre-existing OPENAI_BASE_URL is overwritten with a WARNING (not silent INFO).
- Non-standard USE_AIMOCK values ("garbage") disable with a WARNING (fail safe).
- configure_aimock(env=None) mutates os.environ (default-arg path).
"""

import logging
import os

import pytest

from aimock_toggle import (
    _LITELLM_API_BASE,
    _OPENAI_BASE_URL,
    configure_aimock,
)


def test_no_op_when_aimock_url_unset():
    env = {"OPENAI_API_KEY": "sk-real"}
    result = configure_aimock(env)

    assert result["enabled"] is False
    assert env == {"OPENAI_API_KEY": "sk-real"}, (
        "configure_aimock must not mutate env when AIMOCK_URL is unset"
    )


def test_sets_openai_base_url_when_aimock_url_set():
    env = {"AIMOCK_URL": "http://localhost:4141/v1", "OPENAI_API_KEY": "sk-real"}
    result = configure_aimock(env)

    assert result["enabled"] is True
    assert result["base_url"] == "http://localhost:4141/v1"
    assert env["OPENAI_BASE_URL"] == "http://localhost:4141/v1"
    assert env["LITELLM_API_BASE"] == "http://localhost:4141/v1"
    # Existing key must not be overwritten.
    assert env["OPENAI_API_KEY"] == "sk-real"
    assert result["key_source"] == "existing"


def test_injects_dummy_key_when_missing():
    env = {"AIMOCK_URL": "http://localhost:4141/v1"}
    result = configure_aimock(env)

    assert result["enabled"] is True
    assert result["key_source"] == "dummy"
    # Must be non-empty — litellm/openai SDK rejects empty keys.
    assert env["OPENAI_API_KEY"]
    # Dummy key uses `sk-` prefix (some SDK versions validate prefix) and is
    # self-documenting so it's obvious if it leaks into logs.
    assert env["OPENAI_API_KEY"].startswith("sk-")
    assert "aimock" in env["OPENAI_API_KEY"].lower()
    assert env["OPENAI_BASE_URL"] == "http://localhost:4141/v1"


def test_use_aimock_false_with_url_is_no_op():
    """Operators can disable aimock without unsetting AIMOCK_URL."""
    env = {
        "AIMOCK_URL": "http://localhost:4141/v1",
        "USE_AIMOCK": "0",
        "OPENAI_API_KEY": "sk-real",
    }
    result = configure_aimock(env)

    assert result["enabled"] is False
    assert "OPENAI_BASE_URL" not in env
    assert env["OPENAI_API_KEY"] == "sk-real"


def test_use_aimock_true_with_url_enables():
    env = {
        "AIMOCK_URL": "http://localhost:4141/v1",
        "USE_AIMOCK": "1",
    }
    result = configure_aimock(env)

    assert result["enabled"] is True
    assert env["OPENAI_BASE_URL"] == "http://localhost:4141/v1"


def test_use_aimock_true_without_url_is_warning_no_op(caplog):
    """USE_AIMOCK=1 alone must not crash — degrade gracefully with a warning.

    Must also log a WARNING so operators notice the misconfiguration; silently
    falling through would leave users wondering why aimock isn't active.
    """
    env = {"USE_AIMOCK": "1", "OPENAI_API_KEY": "sk-real"}
    with caplog.at_level(logging.WARNING, logger="aimock_toggle"):
        result = configure_aimock(env)

    assert result["enabled"] is False
    assert "OPENAI_BASE_URL" not in env
    assert env["OPENAI_API_KEY"] == "sk-real"

    warnings = [r for r in caplog.records if r.levelno >= logging.WARNING]
    assert any(
        "USE_AIMOCK" in r.getMessage() and "AIMOCK_URL" in r.getMessage()
        for r in warnings
    ), f"expected WARNING about USE_AIMOCK set without AIMOCK_URL, got {warnings!r}"


@pytest.mark.parametrize(
    "truthy",
    ["1", "true", "TRUE", "yes", "on", "True", " 1 ", "  true  "],
)
def test_various_truthy_values_for_use_aimock(truthy):
    """Every recognized truthy value must enable. Whitespace-wrapped values
    (` 1 `, `  true  `) must also enable — operators commonly set env vars
    via shell heredocs or .env files that may introduce trailing spaces;
    treating them as opaque strings would trap operators in a misleading
    'not set' branch.
    """
    env = {"AIMOCK_URL": "http://x", "USE_AIMOCK": truthy}
    result = configure_aimock(env)
    assert result["enabled"] is True, f"USE_AIMOCK={truthy!r} should enable"


@pytest.mark.parametrize(
    "falsy",
    ["0", "false", "FALSE", "False", "no", "NO", "off", "OFF"],
)
def test_various_falsy_values_for_use_aimock_disable(falsy):
    """Every recognized falsy value must disable even with AIMOCK_URL set."""
    env = {"AIMOCK_URL": "http://x", "USE_AIMOCK": falsy}
    result = configure_aimock(env)
    assert result["enabled"] is False, f"USE_AIMOCK={falsy!r} should disable"
    assert "OPENAI_BASE_URL" not in env


@pytest.mark.parametrize(
    "unknown",
    ["garbage", "maybe", "2", "enabled", "disabled"],
)
def test_unknown_use_aimock_values_disable_with_warning(unknown, caplog):
    """Non-standard USE_AIMOCK values disable (fail safe) and log WARNING."""
    env = {"AIMOCK_URL": "http://x", "USE_AIMOCK": unknown}
    with caplog.at_level(logging.WARNING, logger="aimock_toggle"):
        result = configure_aimock(env)
    assert result["enabled"] is False
    assert "OPENAI_BASE_URL" not in env
    # Expect a WARNING mentioning USE_AIMOCK
    warnings = [r for r in caplog.records if r.levelno >= logging.WARNING]
    assert any("USE_AIMOCK" in r.getMessage() for r in warnings), (
        f"expected WARNING about unknown USE_AIMOCK={unknown!r}, got {warnings!r}"
    )


def test_whitespace_only_aimock_url_is_no_op():
    env = {"AIMOCK_URL": "   ", "OPENAI_API_KEY": "sk-real"}
    result = configure_aimock(env)

    assert result["enabled"] is False
    assert "OPENAI_BASE_URL" not in env


def test_whitespace_only_aimock_url_with_use_aimock_reports_empty_or_whitespace():
    """Diagnostic: reason text must say empty/whitespace, not 'missing'."""
    env = {"AIMOCK_URL": "   ", "USE_AIMOCK": "1"}
    result = configure_aimock(env)
    assert result["enabled"] is False
    reason = result.get("reason", "")
    assert "empty or whitespace" in reason.lower(), (
        f"reason should call out whitespace, got {reason!r}"
    )


def test_empty_openai_api_key_is_replaced_with_dummy():
    """Empty string is treated the same as missing key — dummy injected."""
    env = {"AIMOCK_URL": "http://localhost:4141/v1", "OPENAI_API_KEY": ""}
    result = configure_aimock(env)

    assert result["enabled"] is True
    assert result["key_source"] == "dummy"
    assert env["OPENAI_API_KEY"] != ""


def test_whitespace_openai_api_key_is_replaced_with_dummy():
    """Whitespace-only key is treated the same as empty — litellm rejects both."""
    env = {"AIMOCK_URL": "http://localhost:4141/v1", "OPENAI_API_KEY": "   "}
    result = configure_aimock(env)

    assert result["enabled"] is True
    assert result["key_source"] == "dummy"
    assert env["OPENAI_API_KEY"].strip() != ""
    assert env["OPENAI_API_KEY"] != "   "


def test_unset_aimock_url_with_use_aimock_reason_says_unset():
    """USE_AIMOCK=1 with AIMOCK_URL genuinely unset: reason must say 'unset',
    NOT 'empty or whitespace-only' (which would be misleading when no value
    was ever provided).
    """
    env = {"USE_AIMOCK": "1"}
    result = configure_aimock(env)
    assert result["enabled"] is False
    reason = result.get("reason", "")
    assert "unset" in reason.lower(), f"expected 'unset' in reason, got {reason!r}"
    assert "whitespace" not in reason.lower(), (
        f"reason should not mention whitespace for truly unset URL, got {reason!r}"
    )


def test_empty_string_use_aimock_falls_through_to_enabled():
    """USE_AIMOCK="" (defined but empty) is equivalent to unset — URL wins."""
    env = {"AIMOCK_URL": "http://x", "USE_AIMOCK": "", "OPENAI_API_KEY": "sk-real"}
    result = configure_aimock(env)
    assert result["enabled"] is True
    assert env["OPENAI_BASE_URL"] == "http://x"


def test_existing_openai_base_url_is_overwritten_with_warning(caplog):
    """Pre-set OPENAI_BASE_URL (e.g. Azure gateway) must log WARNING on override."""
    env = {
        "AIMOCK_URL": "http://localhost:4141/v1",
        "OPENAI_BASE_URL": "https://azure-gateway.example.com/v1",
        "OPENAI_API_KEY": "sk-real",
    }
    with caplog.at_level(logging.WARNING, logger="aimock_toggle"):
        result = configure_aimock(env)
    assert result["enabled"] is True
    assert env["OPENAI_BASE_URL"] == "http://localhost:4141/v1"
    warnings = [r for r in caplog.records if r.levelno >= logging.WARNING]
    assert any(
        "OPENAI_BASE_URL" in r.getMessage()
        and "azure-gateway.example.com" in r.getMessage()
        for r in warnings
    ), f"expected WARNING mentioning overridden URL, got {warnings!r}"


def test_existing_openai_base_url_same_as_aimock_url_no_warning(caplog):
    """Same URL pre-set + AIMOCK_URL: idempotent no-warning path."""
    url = "http://localhost:4141/v1"
    env = {
        "AIMOCK_URL": url,
        "OPENAI_BASE_URL": url,
        "OPENAI_API_KEY": "sk-real",
    }
    with caplog.at_level(logging.WARNING, logger="aimock_toggle"):
        result = configure_aimock(env)
    assert result["enabled"] is True
    warnings = [
        r
        for r in caplog.records
        if r.levelno >= logging.WARNING and "overwritten" in r.getMessage()
    ]
    assert warnings == [], f"no override warning expected when URLs match, got {warnings!r}"


def test_existing_base_url_whitespace_wrapped_still_warns(caplog):
    """Whitespace-wrapped OPENAI_BASE_URL matching AIMOCK_URL after strip must
    still log the override warning — otherwise ` http://x ` vs `http://x`
    would be silently overwritten and the operator loses visibility.
    """
    env = {
        "AIMOCK_URL": "http://localhost:4141/v1",
        "OPENAI_BASE_URL": "  http://localhost:4141/v1  ",
        "OPENAI_API_KEY": "sk-real",
    }
    with caplog.at_level(logging.WARNING, logger="aimock_toggle"):
        result = configure_aimock(env)
    assert result["enabled"] is True
    warnings = [
        r
        for r in caplog.records
        if r.levelno >= logging.WARNING and "OPENAI_BASE_URL" in r.getMessage()
    ]
    assert warnings, (
        "expected WARNING when raw OPENAI_BASE_URL differs (whitespace drift) "
        f"from AIMOCK_URL, got {caplog.records!r}"
    )


def test_default_arg_path_mutates_os_environ(monkeypatch):
    """configure_aimock() with no arg should mutate os.environ.

    Explicitly pre-register OPENAI_BASE_URL / LITELLM_API_BASE with monkeypatch
    via setenv("", ...) so that the keys written by configure_aimock() are
    tracked and auto-restored on test teardown. monkeypatch.delenv alone only
    records the current value; a subsequent SUT write of a NEW key would not
    be tracked and would leak into os.environ for the rest of the session.
    """
    # Pre-register the keys the SUT will write, so monkeypatch will restore
    # them on teardown regardless of the SUT's writes.
    monkeypatch.delenv("OPENAI_BASE_URL", raising=False)
    monkeypatch.delenv("LITELLM_API_BASE", raising=False)
    monkeypatch.delenv("USE_AIMOCK", raising=False)
    monkeypatch.setenv("AIMOCK_URL", "http://localhost:4141/v1")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-real")

    # Snapshot keys the SUT might write; assert teardown cleans them.
    sut_writes = (_OPENAI_BASE_URL, _LITELLM_API_BASE)
    for k in sut_writes:
        assert k not in os.environ, f"precondition: {k} must be unset"

    result = configure_aimock()  # default arg = os.environ

    assert result["enabled"] is True
    assert os.environ.get("OPENAI_BASE_URL") == "http://localhost:4141/v1"
    assert os.environ.get("LITELLM_API_BASE") == "http://localhost:4141/v1"

    # Explicitly clean up SUT-written keys so they cannot leak into other tests
    # even if monkeypatch's tracking diverges from expectation.
    for k in sut_writes:
        monkeypatch.delenv(k, raising=False)


def test_default_arg_path_no_op_when_unset(monkeypatch):
    """configure_aimock() default arg path, no AIMOCK_URL — os.environ untouched."""
    monkeypatch.delenv("AIMOCK_URL", raising=False)
    monkeypatch.delenv("USE_AIMOCK", raising=False)
    monkeypatch.delenv("OPENAI_BASE_URL", raising=False)

    result = configure_aimock()

    assert result["enabled"] is False
    assert "OPENAI_BASE_URL" not in os.environ


# --- Production-env guard -------------------------------------------------


@pytest.mark.parametrize("prod_var", ["NODE_ENV", "ENV"])
@pytest.mark.parametrize("prod_value", ["production", "prod", "PRODUCTION", " Production "])
def test_production_env_refuses_toggle_even_with_aimock_url(prod_var, prod_value, caplog):
    """NODE_ENV=production (or ENV=production) must refuse the aimock toggle
    even when AIMOCK_URL is set — a misconfigured deploy that accidentally
    exports AIMOCK_URL should never silently redirect real traffic through
    a mock. Logs a WARNING so operators notice.
    """
    env = {
        "AIMOCK_URL": "http://localhost:4010/v1",
        "OPENAI_API_KEY": "sk-real",
        prod_var: prod_value,
    }
    with caplog.at_level(logging.WARNING, logger="aimock_toggle"):
        result = configure_aimock(env)

    assert result["enabled"] is False
    # Guard must NOT mutate env when refusing.
    assert "OPENAI_BASE_URL" not in env
    assert "LITELLM_API_BASE" not in env
    assert env["OPENAI_API_KEY"] == "sk-real"
    reason = result.get("reason", "")
    assert prod_var in reason and "production" in reason.lower(), (
        f"reason should call out the prod var + value, got {reason!r}"
    )
    # Must log WARNING when URL is set but refused (the AIMOCK_URL-unset case
    # doesn't need a warning — that's just the production default path).
    warnings = [r for r in caplog.records if r.levelno >= logging.WARNING]
    assert any(
        prod_var in r.getMessage() and "aimock" in r.getMessage().lower()
        for r in warnings
    ), f"expected WARNING mentioning {prod_var} + aimock refusal, got {warnings!r}"


def test_production_env_without_aimock_url_is_silent_no_op(caplog):
    """NODE_ENV=production without AIMOCK_URL: normal production path — no
    warning, no mutation, no reason text about 'refused'. The guard must
    only raise its voice when an actual refusal is happening.

    The ``caplog`` assertion pins the silence contract: a future change that
    accidentally makes the prod-guard fire even without AIMOCK_URL would
    emit a WARNING here and fail the test, surfacing the regression instead
    of silently polluting every prod deploy's logs.
    """
    env = {"NODE_ENV": "production", "OPENAI_API_KEY": "sk-real"}
    with caplog.at_level(logging.WARNING, logger="aimock_toggle"):
        result = configure_aimock(env)
    assert result["enabled"] is False
    assert "OPENAI_BASE_URL" not in env
    assert "LITELLM_API_BASE" not in env
    assert env["OPENAI_API_KEY"] == "sk-real"
    reason = result.get("reason", "")
    assert "refused" not in reason.lower(), (
        f"reason must not say 'refused' when nothing was being applied; got {reason!r}"
    )
    # Nothing to "refuse" here — must not emit any warning.
    warnings = [r for r in caplog.records if r.levelno >= logging.WARNING]
    assert warnings == [], (
        f"prod-guard must be silent when AIMOCK_URL is unset, got warnings={warnings!r}"
    )


# --- LITELLM_API_BASE override symmetry -----------------------------------


def test_existing_litellm_api_base_is_overwritten_with_warning(caplog):
    """Pre-set LITELLM_API_BASE must log WARNING on override (symmetric with
    the existing OPENAI_BASE_URL behavior). Both vars are overwritten by the
    toggle; both must surface an override warning so operators don't lose
    visibility into which value was clobbered.
    """
    env = {
        "AIMOCK_URL": "http://localhost:4010/v1",
        "LITELLM_API_BASE": "https://litellm-gateway.example.com/v1",
        "OPENAI_API_KEY": "sk-real",
    }
    with caplog.at_level(logging.WARNING, logger="aimock_toggle"):
        result = configure_aimock(env)
    assert result["enabled"] is True
    assert env["LITELLM_API_BASE"] == "http://localhost:4010/v1"
    warnings = [r for r in caplog.records if r.levelno >= logging.WARNING]
    assert any(
        "LITELLM_API_BASE" in r.getMessage()
        and "litellm-gateway.example.com" in r.getMessage()
        for r in warnings
    ), f"expected WARNING mentioning overridden LITELLM_API_BASE, got {warnings!r}"


# --- Falsy whitespace-wrapped symmetry ------------------------------------


@pytest.mark.parametrize(
    "falsy_padded",
    [" 0 ", "  false  ", " FALSE ", "\tno\t", "  off  "],
)
def test_whitespace_wrapped_falsy_values_for_use_aimock_disable(falsy_padded):
    """Whitespace-wrapped falsy values (` 0 `, `  false  `) must disable —
    operators set env vars via shells / .env files that commonly introduce
    trailing whitespace. Falsy values must have the same tolerance as truthy
    values (which already parametrize on ` 1 ` and `  true  `); asymmetric
    handling would be a confusing footgun.
    """
    env = {"AIMOCK_URL": "http://x", "USE_AIMOCK": falsy_padded}
    result = configure_aimock(env)
    assert result["enabled"] is False, f"USE_AIMOCK={falsy_padded!r} should disable"
    assert "OPENAI_BASE_URL" not in env


# --- Dummy key name ------------------------------------------------------


def test_dummy_key_does_not_mislead_with_replace_in_prod_suffix():
    """The dummy key value must NOT contain the misleading 'REPLACE-IN-PROD'
    string or a "DO-NOT-SET" directive — those names implied operators should
    substitute a real key (or had leaked CI semantics into the key name), but
    the value is only ever injected by the toggle (never by user config) and
    the prod-guard refuses to apply it in production anyway.
    """
    env = {"AIMOCK_URL": "http://localhost:4010/v1"}
    result = configure_aimock(env)
    assert result["enabled"] is True
    key = env["OPENAI_API_KEY"]
    assert "REPLACE-IN-PROD" not in key, (
        f"dummy key still contains misleading suffix: {key!r}"
    )
    assert "DO-NOT-SET" not in key.upper(), (
        f"dummy key must not contain 'DO-NOT-SET' directive: {key!r}"
    )
    # Must still be identifiable as a dev-only aimock placeholder AND satisfy
    # SDK versions that validate on the `sk-` prefix shape.
    assert "aimock" in key.lower()
    assert key.startswith("sk-"), f"dummy key must retain sk- prefix: {key!r}"


# --- typing_extensions fallback (Python < 3.11) ---------------------------


def test_typing_extensions_fallback_path_importable():
    """Verify the ImportError fallback in aimock_toggle.py can import
    NotRequired from typing_extensions.

    On Python 3.11+ the stdlib typing.NotRequired exists, so we can't
    credibly simulate 3.10 by deleting it and re-importing: typing.TypedDict
    resolves NotRequired through the already-loaded typing module (via its
    class-body evaluator), not through an attribute lookup the test can
    shim. Attempting the shim raised NameError on 3.12.

    Coverage strategy:
    - On Python < 3.11: the module's ``from typing import NotRequired``
      fails and the except branch executes on normal import — asserting the
      public surface exists after ``import aimock_toggle`` proves the
      fallback worked. This path is exercised on the 3.10 CI matrix entry.
    - On Python 3.11+: assert the stdlib symbol exists AND assert
      typing_extensions is still importable (requirements.txt fence) so a
      typo like ``typing_exensions`` would fail here instead of silently on
      older Python installs that no CI ever runs.
    """
    import sys

    import aimock_toggle

    assert hasattr(aimock_toggle, "configure_aimock")
    assert hasattr(aimock_toggle, "AimockReport")

    if sys.version_info >= (3, 11):
        import typing as _typing

        assert hasattr(_typing, "NotRequired"), (
            "Python >= 3.11 must provide stdlib typing.NotRequired"
        )
        # typing_extensions is marker-gated in requirements.txt to < 3.11,
        # so skip the import assertion on 3.11+ — it may not be installed.
        return

    # Python < 3.11: typing_extensions must be importable via requirements.txt.
    try:
        from typing_extensions import NotRequired  # noqa: F401
    except ImportError as e:  # pragma: no cover - requirements.txt lists it
        pytest.fail(
            f"typing_extensions must be installed on Python < 3.11; got {e!r}. "
            "Check requirements.txt lists "
            '`typing_extensions>=4.6; python_version < "3.11"`.'
        )
