"""Tests for LangGraphAGUIAgent under the per-request clone().

``add_langgraph_fastapi_endpoint`` clones the agent on every request, so
``clone()`` is on the hot path for every self-hosted LangGraph deployment — a
failure there is a 500 on every request, not a startup error.

``LangGraphAgent.clone()`` reconstructs via ``type(self)(...)`` and forwards
whatever behavior flags the base defines, so each of them is a keyword argument
this subclass must be able to receive — which is why ``__init__`` forwards
**kwargs upstream rather than restating the base signature.
``test_init_forwards_base_kwargs`` is the version-independent guard on that
passthrough: it spies on the base ``__init__``, so it observes the forwarding
itself instead of whichever flags the installed ag-ui-langgraph happens to
define, and it can neither skip nor rot when the base adds a flag.
"""

import inspect
from unittest.mock import MagicMock, patch

import pytest
from ag_ui.core import EventType, TextMessageContentEvent
from ag_ui_langgraph import LangGraphAgent as AGUIBase

from copilotkit.langgraph_agui_agent import LangGraphAGUIAgent


BASE_INIT_PARAMS = inspect.signature(AGUIBase.__init__).parameters

# Behavior flags ag-ui-langgraph 0.0.43's clone() forwards through __init__.
# Illustrative of the shape of the problem, NOT a list that stays exhaustive:
# the base is free to add a fourth, which is why the passthrough is guarded by
# mechanism (test_init_forwards_base_kwargs spies on the base __init__) rather
# than by enumerating names. These are asserted there so the list is live data
# instead of prose that quietly goes stale.
CLONE_FORWARDED_FLAGS_0_0_43 = (
    "enable_legacy_on_interrupt_event",
    "emit_interrupt_outcome",
    "emit_raw_events",
)


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


def test_init_forwards_base_kwargs():
    """The passthrough itself is pinned, independent of the installed base.

    Every other test here can only observe flags the installed ag-ui-langgraph
    happens to define, so they go quiet on an older base — exactly the version
    where a closed signature would look fine. This spies on the base __init__
    instead, so the assertion is about ``__init__`` forwarding its arguments and
    nothing else. It cannot skip, and it fails on any base version if the
    subclass goes back to restating a closed signature or stops passing one of
    the four parameters it does name.
    """
    recorded: dict = {}

    def recording_init(self, **kwargs):
        recorded.update(kwargs)
        # The subclass __init__ appends to this after super() returns.
        self.constant_schema_keys = []

    graph = _make_graph()
    config = {"configurable": {"thread_id": "thread-1"}}
    flags = {name: True for name in CLONE_FORWARDED_FLAGS_0_0_43}
    with patch.object(AGUIBase, "__init__", recording_init):
        LangGraphAGUIAgent(
            name="test",
            graph=graph,
            description="a description",
            config=config,
            not_a_real_flag_the_base_defines=True,
            **flags,
        )

    # The four parameters the subclass names must be relayed, not consumed:
    # the base owns name/description discovery and config merging.
    assert recorded["name"] == "test"
    assert recorded["graph"] is graph
    assert recorded["description"] == "a description"
    assert recorded["config"] is config
    # Everything else must reach the base untouched — both the flags 0.0.43's
    # clone() forwards today and a name no base version has ever defined.
    for flag in CLONE_FORWARDED_FLAGS_0_0_43:
        assert recorded[flag] is True, f"{flag} was not forwarded to the base"
    assert recorded["not_a_real_flag_the_base_defines"] is True


def test_init_rejects_unknown_kwarg_in_the_base_not_locally():
    """A typo must be rejected BY THE BASE — that is what proves forwarding.

    Forwarding is only safe because the base still validates: a misspelled flag
    has to surface as a TypeError at construction, never be silently swallowed.
    But a bare ``pytest.raises(TypeError)`` proves nothing here, because the
    pre-fix closed signature raises TypeError on the same call from the subclass
    frame. So this pins where the error came from, two ways: the message names
    the BASE class's ``__init__`` (a closed signature names the subclass's), and
    the raising frame is the subclass's own ``super().__init__`` call site rather
    than this test module's construction call.
    """
    expected = (
        rf"{AGUIBase.__name__}\.__init__\(\) got an unexpected keyword argument "
        r"'not_a_real_flag_the_base_defines'"
    )
    with pytest.raises(TypeError, match=expected) as excinfo:
        LangGraphAGUIAgent(
            name="test",
            graph=_make_graph(),
            not_a_real_flag_the_base_defines=True,
        )

    innermost = excinfo.value.__traceback__
    while innermost.tb_next is not None:
        innermost = innermost.tb_next
    assert innermost.tb_frame.f_code.co_filename == inspect.getfile(LangGraphAGUIAgent)


def test_clone_succeeds():
    """clone() must not raise, whatever flags the installed base forwards.

    A closed signature rejects them and every request 500s. See
    CLONE_FORWARDED_FLAGS_0_0_43 for what the installed base forwards today.
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
def test_init_forwards_upstream_flags():
    """Base-class flags must be reachable through this subclass, and honored.

    Without the passthrough, emit_raw_events=False — the OSS-607 payload
    opt-out — cannot be set by any CopilotKit user at all. Asserted through
    _dispatch_event rather than through the attribute: an attribute assertion
    still passes if the flag stops being applied to outgoing events. Two-sided
    on purpose: the opt-out direction alone also passes in a world where raw
    events are dropped for everybody, which is the inverse of the intent.
    """
    default_agent = LangGraphAGUIAgent(name="test", graph=_make_graph())
    opted_out = LangGraphAGUIAgent(
        name="test", graph=_make_graph(), emit_raw_events=False
    )

    assert default_agent._dispatch_event(_raw_event_message()).raw_event is not None
    assert opted_out._dispatch_event(_raw_event_message()).raw_event is None


@pytest.mark.skipif(
    "emit_raw_events" not in BASE_INIT_PARAMS,
    reason="installed ag-ui-langgraph predates emit_raw_events",
)
def test_clone_carries_upstream_flags():
    """A non-default flag must survive the clone, and so must the default.

    Two-sided for the same reason as its sibling above, and it has to be
    self-contained: relying on the sibling for the default-direction control
    leaves this test one-sided the moment the sibling is edited, and the two
    skipif guards mean they go quiet together.
    """
    default_clone = LangGraphAGUIAgent(name="test", graph=_make_graph()).clone()
    opted_out_clone = LangGraphAGUIAgent(
        name="test", graph=_make_graph(), emit_raw_events=False
    ).clone()

    assert default_clone._dispatch_event(_raw_event_message()).raw_event is not None
    assert opted_out_clone._dispatch_event(_raw_event_message()).raw_event is None
