"""Tests for LangGraphAGUIAgent under the per-request clone().

``add_langgraph_fastapi_endpoint`` clones the agent on every request, so
``clone()`` is on the hot path for every self-hosted LangGraph deployment — a
failure there is a 500 on every request, not a startup error.

``LangGraphAgent.clone()`` reconstructs via ``type(self)(...)`` and forwards
whatever behavior flags the base defines, so each of them is a keyword argument
this subclass must be able to receive — which is why ``__init__`` forwards
**kwargs upstream rather than restating the base signature.

These tests deliberately assert behavior rather than upstream specifics: no
enumerated flag names, no error-message text, no traceback locations. The
supported range is ``ag-ui-langgraph>=0.0.42``, and CI exercises both 0.0.42
and 0.0.43, so anything version-dependent is guarded rather than assumed.
"""

import inspect
from unittest.mock import MagicMock

import pytest
from ag_ui.core import EventType, TextMessageContentEvent
from ag_ui_langgraph import LangGraphAgent as AGUIBase

from copilotkit.langgraph_agui_agent import LangGraphAGUIAgent


BASE_INIT_PARAMS = inspect.signature(AGUIBase.__init__).parameters


def _make_graph():
    graph = MagicMock()
    graph.nodes = {}
    return graph


def _raw_event_message():
    """A content event carrying the piggy-backed raw_event ``emit_raw_events`` gates."""
    return TextMessageContentEvent(
        type=EventType.TEXT_MESSAGE_CONTENT,
        message_id="msg-1",
        delta="hi",
        raw_event={"event": "on_chat_model_stream"},
    )


def test_clone_succeeds():
    """clone() must not raise, whatever flags the installed base forwards.

    A closed signature rejects them, and since the endpoint clones per request
    that is a 500 on every request.
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


def test_clone_isolates_per_request_state_from_the_source():
    """The clone starts with a fresh run scope and the source keeps its own.

    The endpoint holds one long-lived template agent and clones it per request,
    so both halves are observable. The clone must not inherit the template's
    run-local state — a ``copy.copy``-style clone would hand request N+1 the
    state of request N — and cloning must not disturb the template either, or
    the template stops being a clean starting point for every later request.
    """
    agent = LangGraphAGUIAgent(name="test", graph=_make_graph())
    agent.active_run = {"id": "run-1"}
    agent._copilotkit_runtime_payload = {"actions": [], "context": []}

    cloned = agent.clone()

    assert cloned.active_run is None
    assert cloned._copilotkit_runtime_payload is None
    assert agent.active_run == {"id": "run-1"}
    assert agent._copilotkit_runtime_payload == {"actions": [], "context": []}


@pytest.mark.skipif(
    "emit_raw_events" not in BASE_INIT_PARAMS,
    reason="installed ag-ui-langgraph predates emit_raw_events",
)
def test_clone_carries_a_non_default_upstream_option():
    """A non-default base option must be settable here, and survive the clone.

    Without the passthrough, ``emit_raw_events=False`` — the OSS-607 payload
    opt-out — cannot be set by any CopilotKit user at all. Asserted through
    ``_dispatch_event`` rather than through the attribute: an attribute
    assertion still passes if the option stops being applied to outgoing
    events. Two-sided on purpose, since the opt-out direction alone also passes
    in a world where raw events are dropped for everybody.
    """
    default_clone = LangGraphAGUIAgent(name="test", graph=_make_graph()).clone()
    opted_out_clone = LangGraphAGUIAgent(
        name="test", graph=_make_graph(), emit_raw_events=False
    ).clone()

    assert default_clone._dispatch_event(_raw_event_message()).raw_event is not None
    assert opted_out_clone._dispatch_event(_raw_event_message()).raw_event is None
