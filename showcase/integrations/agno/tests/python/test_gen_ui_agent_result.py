"""Native planner results describe the exact state published to the UI."""

import json

import pytest
from agno.run import RunContext

from agents.gen_ui_agent import set_steps


@pytest.mark.parametrize(
    "steps",
    [
        [],
        [{"id": "1", "title": "Plan launch", "status": "pending"}],
        [{"id": "1", "title": "Plan launch", "status": "completed"}],
        [{"id": "1", "title": 'Café: "launch"', "status": "in_progress"}],
        [None, "ignored", {"id": "1", "title": "Kept", "status": "pending"}],
    ],
)
def test_result_serializes_the_actual_published_steps(steps):
    context = RunContext(
        run_id="test-run", session_id="test-session", session_state=None
    )
    result = set_steps(context, steps)
    expected = [step for step in steps if isinstance(step, dict)]
    assert context.session_state["steps"] == expected
    assert json.loads(result) == context.session_state["steps"]
    assert result == json.dumps(expected, ensure_ascii=False, separators=(",", ":"))


def test_preserves_other_state_and_replaces_previous_steps():
    context = RunContext(
        run_id="test-run",
        session_id="test-session",
        session_state={"other": "keep", "steps": [{"id": "old"}]},
    )
    steps = [{"id": "new", "title": "Venue", "status": "completed"}]
    result = set_steps(context, steps)
    assert context.session_state == {"other": "keep", "steps": steps}
    assert json.loads(result) == steps
