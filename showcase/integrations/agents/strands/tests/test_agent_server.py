"""Tests for the rewritten agent_server module (AGENT_FACTORIES pattern).

These tests must survive being run alongside tests/python/, whose conftest
installs strands/ag_ui_strands stubs into sys.modules.  We clear those stubs
before importing agent_server so the OTel pre-import guard passes cleanly.
"""
import os
import sys

os.environ.setdefault("OPENAI_API_KEY", "test-key-not-real")

# Modules that the python/ conftest seeds as stubs and that agent_server's
# OTel guard will reject if they land in sys.modules before the patch runs.
_STUBS_TO_CLEAR = (
    "strands",
    "strands.hooks",
    "strands.models",
    "strands.models.openai",
    "ag_ui_strands",
    "agent_server",
)


def _fresh_app():
    """Return the FastAPI app from a freshly-imported agent_server.

    Clears any cached agent_server + strands stubs from sys.modules so the
    OTel pre-import guard inside agent_server.py passes cleanly regardless of
    which conftest ran before this test module.
    """
    for name in _STUBS_TO_CLEAR:
        sys.modules.pop(name, None)
    from agent_server import app  # noqa: PLC0415
    return app


def test_health_endpoint():
    from fastapi.testclient import TestClient
    app = _fresh_app()
    client = TestClient(app)
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_agentic_chat_subpath_mounted():
    from fastapi.testclient import TestClient
    app = _fresh_app()
    client = TestClient(app)
    r = client.get("/agentic-chat/")
    assert r.status_code != 404
