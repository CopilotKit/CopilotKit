"""Tests for LangGraphAGUIAgent under the per-request clone().

``add_langgraph_fastapi_endpoint`` clones the agent on every request, so
``clone()`` is on the hot path for every self-hosted LangGraph deployment — a
failure there is a 500 on every request, not a startup error.

``LangGraphAgent.clone()`` reconstructs via ``type(self)(...)`` and forwards the
base class's own behavior flags. Any flag ag-ui-langgraph adds to that call is a
keyword argument this subclass must be able to receive, which is why __init__
forwards **kwargs upstream rather than restating the base signature.
"""

import inspect
from unittest.mock import MagicMock

import pytest
from ag_ui_langgraph import LangGraphAgent as AGUIBase

from copilotkit.langgraph_agui_agent import LangGraphAGUIAgent


BASE_INIT_PARAMS = inspect.signature(AGUIBase.__init__).parameters


def _make_graph():
    graph = MagicMock()
    graph.nodes = {}
    graph.get_state = MagicMock()
    return graph


def test_clone_succeeds():
    """clone() must not raise, whatever flags the installed base forwards.

    ag-ui-langgraph 0.0.43 forwards enable_legacy_on_interrupt_event,
    emit_interrupt_outcome and emit_raw_events through __init__. A closed
    signature rejects them and every request 500s.
    """
    agent = LangGraphAGUIAgent(name="test", graph=_make_graph())
    cloned = agent.clone()
    assert isinstance(cloned, LangGraphAGUIAgent)
    assert cloned is not agent


def test_clone_preserves_copilotkit_state_namespace():
    """The copilotkit schema key must survive the per-request clone."""
    agent = LangGraphAGUIAgent(name="test", graph=_make_graph())
    cloned = agent.clone()
    assert "copilotkit" in cloned.constant_schema_keys
    assert cloned.constant_schema_keys.count("copilotkit") == 1


def test_clone_resets_per_request_state():
    """Run-local state must not carry over — that is what clone() is for."""
    agent = LangGraphAGUIAgent(name="test", graph=_make_graph())
    agent.active_run = {"id": "run-1"}
    agent._copilotkit_runtime_payload = {"actions": [], "context": []}

    cloned = agent.clone()

    assert cloned.active_run is None
    assert cloned._copilotkit_runtime_payload is None


@pytest.mark.skipif(
    "emit_raw_events" not in BASE_INIT_PARAMS,
    reason="installed ag-ui-langgraph predates emit_raw_events",
)
def test_init_forwards_upstream_flags():
    """Base-class flags must be reachable through this subclass.

    Without the passthrough, emit_raw_events=False — the OSS-607 payload
    opt-out — cannot be set by any CopilotKit user at all.
    """
    agent = LangGraphAGUIAgent(
        name="test", graph=_make_graph(), emit_raw_events=False
    )
    assert agent.emit_raw_events is False


@pytest.mark.skipif(
    "emit_raw_events" not in BASE_INIT_PARAMS,
    reason="installed ag-ui-langgraph predates emit_raw_events",
)
def test_clone_carries_upstream_flags():
    """A non-default flag must survive the clone, or it resets every request."""
    agent = LangGraphAGUIAgent(
        name="test", graph=_make_graph(), emit_raw_events=False
    )
    assert agent.clone().emit_raw_events is False
