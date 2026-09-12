"""The CVDIAG capture must follow the harness modules out of ``agents/``.

Moving ``_header_forwarding`` / ``_cvdiag_backend`` from ``src/agents/`` into
``_shared/harness/`` renamed their loggers from ``agents.*`` to
``_shared.harness.*``. ``cvdiag_bootstrap`` attaches its capture handler (and
raises the level to INFO) on the ``agents`` logger only, so after the move every
CVDIAG breadcrumb those modules emit — ``outbound-llm``, the header-capture
lines, the ``emit-failed`` warning — was silently dropped. That is exactly the
silent-drop bug the bootstrap exists to fix, reintroduced by the relocation.

RED before the fix: ``_shared.harness.*`` has no handler and an effective level
of WARNING, so ``test_harness_logger_is_captured`` fails while the ``agents.*``
control passes. GREEN after: both subtrees are captured.
"""

from __future__ import annotations

import logging

from _shared import cvdiag_bootstrap


def _fresh_capture(monkeypatch):
    """Install the capture handler against a clean logging state."""
    cvdiag_bootstrap.reset_for_test()
    for name in (cvdiag_bootstrap._AGENTS_LOG_NAME, cvdiag_bootstrap._HARNESS_LOG_NAME):
        lg = logging.getLogger(name)
        lg.handlers.clear()
        lg.setLevel(logging.NOTSET)
    cvdiag_bootstrap._install_agents_log_capture()


def test_agents_logger_is_captured(monkeypatch):
    """Control: the original ``agents.*`` subtree still emits at INFO."""
    _fresh_capture(monkeypatch)
    lg = logging.getLogger("agents.some_agent")
    assert lg.getEffectiveLevel() <= logging.INFO
    assert lg.handlers or logging.getLogger("agents").handlers


def test_harness_logger_is_captured(monkeypatch):
    """The relocated harness modules must emit on the same terms."""
    _fresh_capture(monkeypatch)
    lg = logging.getLogger("_shared.harness.header_forwarding")
    assert lg.getEffectiveLevel() <= logging.INFO, (
        "_shared.harness.* is above INFO — every CVDIAG breadcrumb from the "
        "relocated header_forwarding / cvdiag_backend modules is dropped"
    )
    assert logging.getLogger(cvdiag_bootstrap._HARNESS_LOG_NAME).handlers, (
        "no capture handler on the _shared.harness subtree"
    )


def test_reset_detaches_both_subtrees():
    """``reset_for_test`` must leave no residual host-logging mutation."""
    cvdiag_bootstrap.reset_for_test()
    cvdiag_bootstrap._install_agents_log_capture()
    cvdiag_bootstrap.reset_for_test()
    for name in (cvdiag_bootstrap._AGENTS_LOG_NAME, cvdiag_bootstrap._HARNESS_LOG_NAME):
        assert not logging.getLogger(name).handlers, f"{name} kept a handler"


def test_framework_tag_is_not_hardcoded_for_one_integration():
    """The tag must be overridable before a second integration imports this.

    ``_CVDIAG_FRAMEWORK`` lives in a single-source shared module whose own
    ``__init__`` says never to copy it per integration. Left hardcoded, the next
    consumer would emit every breadcrumb as ``backend-ag2``.
    """
    import importlib
    import os

    from _shared.harness import header_forwarding

    assert header_forwarding._CVDIAG_FRAMEWORK == "ag2", "default must stay ag2"

    os.environ["CVDIAG_FRAMEWORK"] = "crewai-crews"
    try:
        reloaded = importlib.reload(header_forwarding)
        assert reloaded._CVDIAG_FRAMEWORK == "crewai-crews"
    finally:
        os.environ.pop("CVDIAG_FRAMEWORK", None)
        importlib.reload(header_forwarding)
