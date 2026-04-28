"""Tests for _ToolCallCapHook in src/agents/agent.py.

Exercises the cap behavior by firing synthetic BeforeInvocationEvent /
BeforeToolCallEvent / AfterToolCallEvent instances at the hook and
asserting:

  * the cap fires at exactly ``_max_calls + 1`` (i.e. the (N+1)-th call is
    cancelled, not the N-th),
  * ``BeforeInvocationEvent`` resets the counter between invocations,
  * ``AfterToolCallEvent`` sets the ``stop_event_loop`` sentinel on the
    invocation state once the cap is hit.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest


@pytest.fixture
def hook_cls():
    from agents.agent import _ToolCallCapHook
    return _ToolCallCapHook


def _make_before_event():
    # ``BeforeToolCallEvent`` exposes a mutable ``cancel_tool`` attribute.
    # We fake the event with a SimpleNamespace that accepts the assignment.
    return SimpleNamespace(cancel_tool=None)


def _make_after_event(invocation_state=None):
    return SimpleNamespace(invocation_state=invocation_state if invocation_state is not None else {})


def test_cap_fires_on_call_n_plus_one(hook_cls):
    hook = hook_cls(max_calls=3)

    # Calls 1..3 should pass through; call 4 (N+1) should cancel.
    for i in range(1, 4):
        ev = _make_before_event()
        hook._on_before_tool(ev)
        assert ev.cancel_tool is None, f"call {i} should not be cancelled"

    trip_event = _make_before_event()
    hook._on_before_tool(trip_event)
    assert trip_event.cancel_tool is not None
    assert "3" in trip_event.cancel_tool  # max_calls surfaced in message


def test_before_invocation_resets_counter(hook_cls):
    hook = hook_cls(max_calls=2)

    # Exhaust the cap.
    hook._on_before_tool(_make_before_event())
    hook._on_before_tool(_make_before_event())
    trip = _make_before_event()
    hook._on_before_tool(trip)
    assert trip.cancel_tool is not None

    # Reset via BeforeInvocationEvent.
    hook._on_invocation_start(SimpleNamespace())

    # The counter should be back to zero; the next 2 calls must pass.
    next_ev = _make_before_event()
    hook._on_before_tool(next_ev)
    assert next_ev.cancel_tool is None

    second = _make_before_event()
    hook._on_before_tool(second)
    assert second.cancel_tool is None


def test_after_tool_sets_stop_event_loop_sentinel(hook_cls):
    """Once the counter reaches ``max_calls``, ``_on_after_tool`` must set
    the ``stop_event_loop`` sentinel on the invocation state so strands halts
    the event loop at the end of the current cycle.

    Note on sentinel timing: the sentinel fires at ``_count >= _max_calls``
    (one call earlier than the cancellation, which fires at
    ``_count > _max_calls``). The sentinel and the cancellation are
    orthogonal mechanisms: the sentinel halts the event loop before a
    potential (N+1)-th call is ever attempted, and the cancellation is a
    belt-and-suspenders guard for the case where strands dispatches the
    (N+1)-th call anyway (e.g. because the sentinel was set too late in
    the cycle, or the tool dispatch was already in flight).
    """
    hook = hook_cls(max_calls=3)

    # Calls under the cap must not set the sentinel.
    for _ in range(2):
        hook._on_before_tool(_make_before_event())
        state = {}
        hook._on_after_tool(_make_after_event(state))
        assert not state.get("request_state", {}).get("stop_event_loop")

    # Reaching the cap (count == max) sets the sentinel.
    hook._on_before_tool(_make_before_event())  # count now == 3
    at_cap_state = {}
    hook._on_after_tool(_make_after_event(at_cap_state))
    assert at_cap_state["request_state"]["stop_event_loop"] is True

    # Over-cap call is cancelled AND sets the sentinel.
    tripping = _make_before_event()
    hook._on_before_tool(tripping)  # count now == 4
    assert tripping.cancel_tool is not None

    over_state = {}
    hook._on_after_tool(_make_after_event(over_state))
    assert over_state["request_state"]["stop_event_loop"] is True


def test_default_cap_matches_module_constant(hook_cls):
    from agents.agent import _MAX_TOOL_CALLS_PER_INVOCATION

    hook = hook_cls()
    assert hook._max_calls == _MAX_TOOL_CALLS_PER_INVOCATION


def test_concurrent_before_tool_calls_respect_cap(hook_cls):
    """Fire 100 concurrent ``_on_before_tool`` calls against a cap of 50
    and assert the cap holds: exactly 50 calls pass through and 50 are
    cancelled.

    The hook's ``_lock`` guards ``_count`` mutation so that under
    concurrent invocation (e.g. strands dispatching tools on a
    ThreadPoolExecutor, or misuse via two concurrent requests on the same
    thread_id) we degrade gracefully rather than race silently. Without
    the lock, the classic read-modify-write race would allow more than 50
    calls to pass the ``current > max_calls`` gate.
    """
    import threading

    max_calls = 50
    total = 100
    hook = hook_cls(max_calls=max_calls)

    events = [_make_before_event() for _ in range(total)]
    barrier = threading.Barrier(total)

    def _fire(ev):
        barrier.wait()
        hook._on_before_tool(ev)

    threads = [threading.Thread(target=_fire, args=(ev,)) for ev in events]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    passed = sum(1 for ev in events if ev.cancel_tool is None)
    cancelled = sum(1 for ev in events if ev.cancel_tool is not None)

    assert passed == max_calls, f"expected exactly {max_calls} passes, got {passed}"
    assert cancelled == total - max_calls, (
        f"expected exactly {total - max_calls} cancellations, got {cancelled}"
    )
    # And the internal counter should land at ``total`` (every call was counted).
    assert hook._count == total


def test_tool_call_cap_validates_max_calls(hook_cls):
    """``max_calls < 1`` silently cancels every tool call because the
    first ``_on_before_tool`` increment-then-compare ends up with
    ``1 > 0`` -> cancel. Constructor must reject this up front."""
    with pytest.raises(ValueError, match="max_calls must be >= 1"):
        hook_cls(max_calls=0)

    with pytest.raises(ValueError, match="max_calls must be >= 1"):
        hook_cls(max_calls=-1)

    # Boundary: 1 is valid. The very next call would cancel, but the
    # hook itself must construct without error.
    hook = hook_cls(max_calls=1)
    assert hook._max_calls == 1
