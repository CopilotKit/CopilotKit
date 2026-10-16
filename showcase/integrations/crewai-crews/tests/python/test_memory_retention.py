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


def test_successful_request_restores_parent_context():
    async def request():
        template = ProbeFlow()
        startup = crewai_event_bus.runtime_state
        registry = bus_module._registered_entity_ids_var.get()
        # A nonzero caller depth makes restoration observable for every variable.
        bus_module._runtime_scope_depth.set(1)
        depth = bus_module._runtime_scope_depth.get()
        roots = len(startup.root)
        events = len(startup.event_record.nodes)
        app = FastAPI()
        add_crewai_flow_fastapi_endpoint(app, template, "/probe")
        install(app)

        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app), base_url="http://test"
        ) as client:
            await run_flow(client)

        # Check the caller task before asyncio.run restores its outer context.
        assert bus_module._runtime_state_var.get() is startup
        assert bus_module._registered_entity_ids_var.get() is registry
        assert bus_module._runtime_scope_depth.get() == depth
        assert len(startup.root) == roots
        assert len(startup.event_record.nodes) == events

    asyncio.run(request())


def test_server_requests_do_not_accumulate_in_startup_runtime():
    # Seed startup ownership before importing the real server, including when
    # another test has already cached its module-level Flow templates.
    template = ProbeFlow()
    app = import_module("agent_server").app
    startup = crewai_event_bus.runtime_state
    assert startup is not None
    assert startup.root
    add_crewai_flow_fastapi_endpoint(app, template, "/probe")
    roots = len(startup.root)
    events = len(startup.event_record.nodes)

    async def requests():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app), base_url="http://test"
        ) as client:
            for _ in range(3):
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


@pytest.fixture
def trace_listener(monkeypatch, tmp_path):
    from crewai.events.listeners.tracing.first_time_trace_handler import (
        FirstTimeTraceHandler,
    )
    from crewai.events.listeners.tracing.trace_batch_manager import TraceBatchManager
    from crewai.events.listeners.tracing.trace_listener import TraceCollectionListener
    from crewai.events.listeners.tracing import utils

    monkeypatch.setattr(
        "crewai_core.user_data._user_data_file", lambda: tmp_path / "user.json"
    )
    # The tracing module also captured this helper as a direct import.
    monkeypatch.setattr(utils, "_user_data_file", lambda: tmp_path / "user.json")
    monkeypatch.delenv("CREWAI_TRACING_ENABLED", raising=False)
    listener = TraceCollectionListener()
    handler = FirstTimeTraceHandler()
    manager = TraceBatchManager()
    handler.set_batch_manager(manager)
    monkeypatch.setattr(listener, "first_time_handler", handler)
    monkeypatch.setattr(listener, "batch_manager", manager)
    token = utils.set_tracing_enabled(False)
    yield listener
    utils.reset_tracing_enabled(token)


def test_declined_first_trace_releases_batch_and_finishes_first_use(
    trace_listener, monkeypatch
):
    from crewai.events.listeners.tracing.trace_batch_manager import TraceBatch
    from crewai.events.listeners.tracing.types import TraceEvent

    prompts = []

    def decline():
        prompts.append(True)
        return False

    monkeypatch.setattr(
        "crewai.events.listeners.tracing.first_time_trace_handler.prompt_user_for_trace_viewing",
        decline,
    )
    handler = trace_listener.first_time_handler
    handler.is_first_time = True
    handler.mark_events_collected()
    trace_listener.batch_manager.current_batch = TraceBatch()
    trace_listener.batch_manager.event_buffer.append(TraceEvent(type="probe"))
    install(FastAPI())
    handler.handle_execution_completion()

    assert handler.is_first_time is False
    assert not handler.collected_events
    assert not trace_listener.batch_manager.event_buffer
    assert trace_listener.batch_manager.current_batch is None
    handler.handle_execution_completion()
    assert len(prompts) == 1


@pytest.mark.parametrize("method", ["_handle_trace_event", "_handle_action_event"])
def test_registered_callbacks_do_not_collect_disabled_traces(trace_listener, method):
    from crewai.events.types.flow_events import FlowStartedEvent

    trace_listener.first_time_handler.is_first_time = False
    install(FastAPI())
    getattr(trace_listener, method)(
        "flow_started", ProbeFlow(), FlowStartedEvent(flow_name="ProbeFlow")
    )
    assert not trace_listener.batch_manager.event_buffer
    assert trace_listener.batch_manager.current_batch is None


def test_disabled_tracing_does_not_initialize_an_unused_batch(trace_listener):
    trace_listener.first_time_handler.is_first_time = False
    install(FastAPI())
    trace_listener._initialize_batch({}, {"execution_type": "flow"})
    assert trace_listener.batch_manager.current_batch is None


def test_explicit_tracing_opt_out_releases_first_time_buffer(
    trace_listener, monkeypatch
):
    from crewai.events.listeners.tracing.types import TraceEvent

    monkeypatch.setenv("CREWAI_TRACING_ENABLED", "false")
    trace_listener.first_time_handler.is_first_time = True
    trace_listener.batch_manager.event_buffer.append(TraceEvent(type="probe"))
    install(FastAPI())
    assert trace_listener.first_time_handler.is_first_time is False
    assert not trace_listener.batch_manager.event_buffer


@pytest.mark.parametrize("first_time", [False, True])
def test_requested_traces_still_collect(trace_listener, first_time):
    from crewai.events.listeners.tracing import utils
    from crewai.events.types.flow_events import FlowStartedEvent

    trace_listener.first_time_handler.is_first_time = first_time
    flow = ProbeFlow()
    token = utils.set_tracing_enabled(not first_time)
    try:
        install(FastAPI())
        trace_listener._handle_trace_event(
            "flow_started", flow, FlowStartedEvent(flow_name="ProbeFlow")
        )
        assert len(trace_listener.batch_manager.event_buffer) == 1
    finally:
        utils.reset_tracing_enabled(token)


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


@pytest.mark.parametrize("requested", [False, True])
def test_declined_trace_write_failure_releases_only_unrequested_batch(
    trace_listener, monkeypatch, tmp_path, requested
):
    from crewai.events.listeners.tracing import utils
    from crewai.events.types.flow_events import FlowStartedEvent

    parent_file = tmp_path / "not-a-directory"
    parent_file.write_text("blocks consent persistence")
    consent_file = parent_file / "user.json"
    monkeypatch.setattr("crewai_core.user_data._user_data_file", lambda: consent_file)
    monkeypatch.setattr(utils, "_user_data_file", lambda: consent_file)
    assert not utils._is_interactive_terminal()

    flow = ProbeFlow()
    token = utils.set_tracing_enabled(False)
    try:
        handler = trace_listener.first_time_handler
        assert handler.initialize_for_first_time_user()
        install(FastAPI())
        trace_listener._initialize_batch({}, {"execution_type": "flow"})
        trace_listener._handle_trace_event(
            "flow_started", flow, FlowStartedEvent(flow_name="ProbeFlow")
        )
        handler.mark_events_collected()
        manager = trace_listener.batch_manager
        assert manager.current_batch is not None
        assert len(manager.event_buffer) == 1

        requested_token = utils.set_tracing_enabled(requested)
        try:
            with pytest.raises(NotADirectoryError) as error:
                handler.handle_execution_completion()
        finally:
            utils.reset_tracing_enabled(requested_token)
        assert error.value.filename == str(consent_file)

        if requested:
            assert handler.is_first_time
            assert handler.collected_events
            assert len(manager.event_buffer) == 1
            assert manager.current_batch is not None
        else:
            assert handler.is_first_time is False
            assert not handler.collected_events
            assert not manager.event_buffer
            assert manager.current_batch is None
            for method in ("_handle_trace_event", "_handle_action_event"):
                getattr(trace_listener, method)(
                    "flow_started", flow, FlowStartedEvent(flow_name="ProbeFlow")
                )
            assert not manager.event_buffer
            assert manager.current_batch is None
    finally:
        utils.reset_tracing_enabled(token)
