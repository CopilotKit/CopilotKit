"""Tripwire coverage for the partialjson dependency behind predict_state().

`pyproject.toml` allows any partialjson in `>=0.0.8,<2.0.0` (#6123, issue #4131).
The only consumer is `predict_state()` in copilotkit/runloop.py, which parses the
still-incomplete tool-call argument buffer via `JSONParser().parse(...)` inside a
bare `except`. That makes a regression silent: every partialjson failure mode
degrades to "no predicted state was emitted", and nothing else in the suite looks
at this path — disabling `JSONParser.parse` outright left all other tests passing.

These assertions are deliberately version-agnostic. Intermediate frames legitimately
differ across the allowed range (1.1.0 keeps trailing whitespace inside a partially
streamed string where 0.0.8 dropped it), so we pin only the guarantees the range must
keep: a completed payload parses exactly, and a prefix yields a prefix.
"""

import json

from partialjson.json_parser import JSONParser

from copilotkit.protocol import RuntimeEventTypes
from copilotkit.runloop import predict_state

TOOL_NAME = "set_plan"
ARGUMENTS = {
    "task": "Write a haiku about the sea",
    "steps": ["draft", "revise"],
    "done": False,
}
PAYLOAD = json.dumps(ARGUMENTS)


def _execution() -> dict:
    """A CopilotKitRunExecution primed to predict `task` and the whole argument dict."""
    return {
        "thread_id": "t-1",
        "agent_name": "agent",
        "run_id": "run-1",
        "should_exit": False,
        "node_name": "node",
        "is_finished": False,
        "predict_state_configuration": {
            "plan": {"tool_name": TOOL_NAME, "tool_argument": "task"},
            "whole": {"tool_name": TOOL_NAME},
        },
        "predicted_state": {},
        "argument_buffer": "",
        "current_tool_call": None,
        "state": {},
    }


def _stream(chunk_size: int) -> tuple[list[dict], dict]:
    """Stream PAYLOAD through predict_state() and collect each predicted state."""
    execution = _execution()
    predict_state(
        thread_id="t-1",
        agent_name="agent",
        run_id="run-1",
        execution=execution,
        event={"type": RuntimeEventTypes.ACTION_EXECUTION_START, "actionName": TOOL_NAME},
    )

    frames = []
    for start in range(0, len(PAYLOAD), chunk_size):
        message = predict_state(
            thread_id="t-1",
            agent_name="agent",
            run_id="run-1",
            execution=execution,
            event={
                "type": RuntimeEventTypes.ACTION_EXECUTION_ARGS,
                "args": PAYLOAD[start : start + chunk_size],
            },
        )
        if message is not None:
            frames.append(dict(execution["predicted_state"]))
    return frames, execution["predicted_state"]


def test_streaming_arguments_emit_predicted_state():
    """A streamed tool call must produce predicted-state updates, not silence."""
    frames, _ = _stream(chunk_size=1)

    assert frames, (
        "no predicted state was emitted while arguments streamed — partialjson "
        "parsed nothing usable from any prefix of the buffer"
    )
    assert len(frames) > 10, f"expected many incremental frames, got {len(frames)}"


def test_completed_arguments_parse_exactly():
    """Once the buffer is complete the prediction must equal the real arguments."""
    for chunk_size in (1, 3, 7, 20):
        _, predicted = _stream(chunk_size)
        assert predicted["whole"] == ARGUMENTS, f"chunk_size={chunk_size}"
        assert predicted["plan"] == ARGUMENTS["task"], f"chunk_size={chunk_size}"


def test_intermediate_predictions_are_prefixes_of_the_final_value():
    """Every partial value must be a prefix of the finished string, never garbage."""
    frames, predicted = _stream(chunk_size=1)
    final = predicted["plan"]

    for frame in frames:
        partial = frame.get("plan")
        if partial is None:
            continue
        assert isinstance(partial, str), f"expected a string, got {partial!r}"
        # Trailing whitespace handling differs across the allowed range, so compare
        # on the stripped prefix rather than the raw frame.
        assert final.startswith(partial.rstrip()), f"{partial!r} is not a prefix of {final!r}"


def test_unterminated_escape_does_not_escape_predict_state():
    """Prefixes that older partialjson rejects must stay contained by the bare except."""
    execution = _execution()
    predict_state(
        thread_id="t-1",
        agent_name="agent",
        run_id="run-1",
        execution=execution,
        event={"type": RuntimeEventTypes.ACTION_EXECUTION_START, "actionName": TOOL_NAME},
    )

    # 0.0.8 raises JSONDecodeError here; 1.x parses it. Either way predict_state()
    # must not propagate the failure to the run loop.
    predict_state(
        thread_id="t-1",
        agent_name="agent",
        run_id="run-1",
        execution=execution,
        event={"type": RuntimeEventTypes.ACTION_EXECUTION_ARGS, "args": '{"task": "line\\'},
    )


def test_partialjson_api_contract():
    """The API predict_state() depends on, asserted directly against the dependency.

    This is the tripwire for a future release inside `>=0.0.8,<2.0.0`: the range
    admits versions that do not exist yet, and this is what notices if one of them
    changes the constructor, the method, or the parse of a truncated object.
    """
    parser = JSONParser()

    assert parser.parse(PAYLOAD) == ARGUMENTS
    assert parser.parse('{"task": "wri') == {"task": "wri"}
    assert parser.parse('{"steps": ["draft"') == {"steps": ["draft"]}
    assert parser.parse("") == {}
