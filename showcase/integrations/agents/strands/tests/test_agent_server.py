"""Tests for the rewritten agent_server module (AGENT_FACTORIES pattern).

These tests must survive being run alongside tests/python/, whose conftest
installs strands/ag_ui_strands stubs into sys.modules.  We clear those stubs
before importing agent_server so the OTel pre-import guard passes cleanly.
"""
import os
import sys

os.environ.setdefault("OPENAI_API_KEY", "test-key-not-real")

def _fresh_app():
    """Return the FastAPI app from a freshly-imported agent_server.

    Clears any cached agent_server + strands stubs from sys.modules so the
    OTel pre-import guard inside agent_server.py passes cleanly regardless of
    which conftest ran before this test module.

    We do a broad prefix-based sweep rather than an explicit list because
    tests/python/conftest.py installs stub sub-modules (strands.hooks,
    strands.models.openai, ag_ui_strands, …) and the exact set can grow.
    Any leftover stub module whose objects lack real attributes (e.g.
    _Permissive lacking .stateful) will cause AttributeError inside the
    freshly-imported real strands package.
    """
    for name in list(sys.modules.keys()):
        if (
            name == "agent_server"
            or name.startswith("strands")
            or name.startswith("ag_ui_strands")
            or name.startswith("agents.")
            or name == "agents"
        ):
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
