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
from unittest.mock import MagicMock, patch

import pytest
from ag_ui.core import EventType, TextMessageContentEvent
from ag_ui_langgraph import LangGraphAgent as AGUIBase

from copilotkit.langgraph_agui_agent import LangGraphAGUIAgent


BASE_INIT_PARAMS = inspect.signature(AGUIBase.__init__).parameters


def _make_graph():
    graph = MagicMock()
    graph.nodes = {}
    return graph


def test_init_forwards_unknown_kwargs_to_base():
    """The passthrough itself is pinned, independent of the installed base.

    Every other test here can only observe flags the installed ag-ui-langgraph
    happens to define, so they go quiet on an older base — exactly the version
    where a closed signature would look fine. This spies on the base __init__
    instead, so the assertion is about ``__init__`` forwarding **kwargs and
    nothing else. It cannot skip, and it fails on any base version if the
    subclass goes back to restating a closed signature.
    """
    recorded: dict = {}

    def recording_init(self, **kwargs):
        recorded.update(kwargs)
        # The subclass __init__ appends to this after super() returns.
        self.constant_schema_keys = []

    graph = _make_graph()
    with patch.object(AGUIBase, "__init__", recording_init):
        LangGraphAGUIAgent(
            name="test",
            graph=graph,
            not_a_real_flag_the_base_defines=True,
        )

    assert recorded["not_a_real_flag_the_base_defines"] is True
    assert recorded["name"] == "test"
    assert recorded["graph"] is graph


def test_init_rejects_unknown_kwarg_end_to_end():
    """**kwargs must forward to the base and let it reject typos.

    Forwarding is only safe because the base still validates: a misspelled
    flag has to surface as a TypeError at construction, never be silently
    swallowed by the subclass.
    """
    with pytest.raises(TypeError):
        LangGraphAGUIAgent(
            name="test",
            graph=_make_graph(),
            not_a_real_flag_the_base_defines=True,
        )


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
    """Base-class flags must be reachable through this subclass, and honored.

    Without the passthrough, emit_raw_events=False — the OSS-607 payload
    opt-out — cannot be set by any CopilotKit user at all. Asserted through
    _dispatch_event rather than through the attribute: an attribute assertion
    still passes if the flag stops being applied to outgoing events.
    """
    default_agent = LangGraphAGUIAgent(name="test", graph=_make_graph())
    opted_out = LangGraphAGUIAgent(
        name="test", graph=_make_graph(), emit_raw_events=False
    )

    def _event():
        return TextMessageContentEvent(
            type=EventType.TEXT_MESSAGE_CONTENT,
            message_id="msg-1",
            delta="hi",
            raw_event={"event": "on_chat_model_stream"},
        )

    assert default_agent._dispatch_event(_event()).raw_event is not None
    assert opted_out._dispatch_event(_event()).raw_event is None


@pytest.mark.skipif(
    "emit_raw_events" not in BASE_INIT_PARAMS,
    reason="installed ag-ui-langgraph predates emit_raw_events",
)
def test_clone_carries_upstream_flags():
    """A non-default flag must survive the clone, or it resets every request."""
    agent = LangGraphAGUIAgent(name="test", graph=_make_graph(), emit_raw_events=False)
    cloned = agent.clone()
    dispatched = cloned._dispatch_event(
        TextMessageContentEvent(
            type=EventType.TEXT_MESSAGE_CONTENT,
            message_id="msg-1",
            delta="hi",
            raw_event={"event": "on_chat_model_stream"},
        )
    )
    assert dispatched.raw_event is None
