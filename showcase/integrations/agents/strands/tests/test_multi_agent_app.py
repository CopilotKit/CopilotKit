"""Tests for create_multi_agent_strands_app."""
from fastapi.testclient import TestClient

from agents._multi_agent_app import create_multi_agent_strands_app


class FakeAgent:
    def __init__(self, name: str):
        self.name = name


def fake_create_strands_app(agent, agent_path: str):
    from fastapi import FastAPI
    sub = FastAPI()

    @sub.get("/")
    def root():
        return {"agent": agent.name, "path": agent_path}

    return sub


def test_mounts_each_factory_at_subpath():
    factories = {
        "agentic-chat": lambda: FakeAgent("agentic-chat"),
        "byoc-hashbrown": lambda: FakeAgent("byoc-hashbrown"),
    }
    app = create_multi_agent_strands_app(factories, create_strands_app=fake_create_strands_app)
    client = TestClient(app)
    r1 = client.get("/agentic-chat/")
    assert r1.status_code == 200
    assert r1.json()["agent"] == "agentic-chat"
    r2 = client.get("/byoc-hashbrown/")
    assert r2.status_code == 200
    assert r2.json()["agent"] == "byoc-hashbrown"


def test_health_short_circuits():
    factories = {"agentic-chat": lambda: FakeAgent("agentic-chat")}
    app = create_multi_agent_strands_app(factories, create_strands_app=fake_create_strands_app)
    client = TestClient(app)
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_unknown_subpath_404():
    factories = {"agentic-chat": lambda: FakeAgent("agentic-chat")}
    app = create_multi_agent_strands_app(factories, create_strands_app=fake_create_strands_app)
    client = TestClient(app)
    assert client.get("/unknown-demo/").status_code == 404
