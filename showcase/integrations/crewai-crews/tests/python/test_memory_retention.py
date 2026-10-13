"""Regression tests against the pinned CrewAI runtime, without provider calls."""

import asyncio
from importlib import import_module
import uuid

import httpx
import pytest
from fastapi import FastAPI

from _shared import ag_ui_crewai_compat as compat
from ag_ui_crewai import CopilotKitState, add_crewai_flow_fastapi_endpoint
from crewai.events.event_bus import crewai_event_bus
from crewai.flow.flow import Flow, start


bus_module = import_module("crewai.events.event_bus")


@pytest.fixture(autouse=True)
def runtime_context():
    variables = (
        (bus_module._runtime_state_var, None),
        (bus_module._registered_entity_ids_var, None),
        (bus_module._runtime_scope_depth, 0),
    )
    tokens = [(variable, variable.set(value)) for variable, value in variables]
    yield
    for variable, token in reversed(tokens):
        variable.reset(token)


class ProbeState(CopilotKitState):
    payload: str = ""


class ProbeFlow(Flow[ProbeState]):
    @start()
    def finish(self):
        return "ok"


def install(app):
    compat.install_memory_compat(app)


async def run_flow(client):
    response = await client.post(
        "/probe",
        json={
            "threadId": str(uuid.uuid4()),
            "runId": str(uuid.uuid4()),
            "state": {"payload": str(uuid.uuid4()) + "x" * 16000},
            "messages": [],
            "tools": [],
            "context": [],
            "forwardedProps": {},
        },
    )
    assert response.status_code == 200
    assert "RUN_FINISHED" in response.text
    assert "RUN_ERROR" not in response.text


def test_completed_requests_do_not_accumulate_in_startup_runtime():
    template = ProbeFlow()
    startup = crewai_event_bus.runtime_state
    roots = len(startup.root)
    events = len(startup.event_record.nodes)
    app = FastAPI()
    add_crewai_flow_fastapi_endpoint(app, template, "/probe")
    install(app)

    async def requests():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app), base_url="http://test"
        ) as client:
            for _ in range(20):
                await run_flow(client)

    asyncio.run(requests())
    assert crewai_event_bus.runtime_state is startup
    assert len(startup.root) == roots
    assert len(startup.event_record.nodes) == events


@pytest.mark.parametrize("error", [RuntimeError, asyncio.CancelledError])
def test_request_restores_parent_context_after_error(error):
    ProbeFlow()
    startup = crewai_event_bus.runtime_state
    registry = bus_module._registered_entity_ids_var.get()
    app = FastAPI()

    @app.get("/fail")
    async def fail():
        assert crewai_event_bus.runtime_state is None
        assert bus_module._registered_entity_ids_var.get() is None
        assert bus_module._runtime_scope_depth.get() == 0
        ProbeFlow()
        raise error("request failed")

    install(app)

    async def request():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app), base_url="http://test"
        ) as client:
            with pytest.raises(error):
                await client.get("/fail")
        assert crewai_event_bus.runtime_state is startup
        assert bus_module._registered_entity_ids_var.get() is registry
        assert bus_module._runtime_scope_depth.get() == 0

    asyncio.run(request())
    assert len(startup.root) == 1


def test_memory_compat_rejects_unreviewed_crewai_version(monkeypatch):
    app = FastAPI()
    monkeypatch.setattr(compat, "package_version", lambda _package: "1.16.0")
    with pytest.raises(RuntimeError, match="supports crewai 1.15.11"):
        compat.install_memory_compat(app)
    assert not app.user_middleware


def test_memory_compat_installs_once():
    app = FastAPI()
    compat.install_memory_compat(app)
    compat.install_memory_compat(app)
    assert len(app.user_middleware) == 1


def test_concurrent_requests_have_separate_runtime_owners():
    ProbeFlow()
    startup = crewai_event_bus.runtime_state
    app = FastAPI()
    states = []

    @app.get("/scope")
    async def scope():
        ProbeFlow()
        state = crewai_event_bus.runtime_state
        states.append(state)
        await asyncio.sleep(0.01)
        assert crewai_event_bus.runtime_state is state
        assert len(state.root) == 1
        return {"ok": True}

    install(app)

    async def requests():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app), base_url="http://test"
        ) as client:
            responses = await asyncio.gather(client.get("/scope"), client.get("/scope"))
        assert all(response.status_code == 200 for response in responses)

    asyncio.run(requests())
    assert states[0] is not states[1]
    assert all(state is not startup for state in states)
    assert len(startup.root) == 1


def test_nested_flow_keeps_the_enclosing_request_runtime():
    class ParentFlow(Flow[ProbeState]):
        @start()
        async def finish(self):
            parent_state = crewai_event_bus.runtime_state
            await ProbeFlow().kickoff_async()
            assert crewai_event_bus.runtime_state is parent_state
            return "ok"

    template = ParentFlow()
    startup = crewai_event_bus.runtime_state
    app = FastAPI()
    add_crewai_flow_fastapi_endpoint(app, template, "/probe")
    install(app)

    async def request():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app), base_url="http://test"
        ) as client:
            await run_flow(client)

    asyncio.run(request())
    assert len(startup.root) == 1
