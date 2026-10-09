"""The resume envelope reaching a paused tool is not one shape.

`ag_ui_strands` wraps a resolved answer as ``{"response": payload}`` and a
cancel as ``{"cancelled": True}``. The published TypeScript bridge passes the
payload through and cancels with ``{"status": "cancelled"}``, and a client can
answer with something that is not a mapping at all. A tool that assumes one
shape either reports "no time picked" for a real pick or raises inside the tool
body, and no aimock-backed test catches it: the narration comes from the
fixture, not from the tool result.
"""

from __future__ import annotations

import pytest

from agents.interrupt_agent import schedule_meeting


class _Ctx:
    """Tool context whose `interrupt()` replays one resume envelope."""

    def __init__(self, answer):
        self._answer = answer
        self.calls: list[tuple] = []

    def interrupt(self, name, reason=None):
        self.calls.append((name, reason))
        return self._answer


def _run(answer):
    ctx = _Ctx(answer)
    return schedule_meeting("Sales intro call", ctx, "Sales team"), ctx


@pytest.mark.parametrize(
    "answer",
    [
        {"response": {"chosen_label": "Tomorrow 10:00 AM"}},
        {"chosen_label": "Tomorrow 10:00 AM"},
    ],
    ids=["wrapped", "raw"],
)
def test_a_picked_slot_is_reported_as_scheduled(answer):
    result, ctx = _run(answer)
    assert "Meeting scheduled for Tomorrow 10:00 AM" in result
    assert ctx.calls == [
        ("schedule_meeting", {"topic": "Sales intro call", "attendee": "Sales team"})
    ]


@pytest.mark.parametrize(
    "answer",
    [
        {"cancelled": True},
        {"status": "cancelled"},
        {"response": {"cancelled": True}},
        {"response": {"status": "cancelled"}},
    ],
    ids=[
        "python-sentinel",
        "typescript-sentinel",
        "picker-flag",
        "wrapped-typescript-sentinel",
    ],
)
def test_every_cancel_shape_is_reported_as_not_scheduled(answer):
    result, _ = _run(answer)
    assert result.startswith("User cancelled.")


@pytest.mark.parametrize(
    "answer",
    [
        {"response": {"chosen_label": "", "chosen_time": "2026-09-05T10:00:00Z"}},
        {"chosen_label": "", "chosen_time": "2026-09-05T10:00:00Z"},
    ],
    ids=["wrapped", "raw"],
)
def test_an_empty_label_falls_back_to_the_chosen_time(answer):
    result, _ = _run(answer)
    assert "Meeting scheduled for 2026-09-05T10:00:00Z" in result


@pytest.mark.parametrize("answer", [None, "nope", 7, {"response": None}])
def test_an_unreadable_answer_does_not_raise_inside_the_tool(answer):
    result, _ = _run(answer)
    assert "NOT scheduled" in result
