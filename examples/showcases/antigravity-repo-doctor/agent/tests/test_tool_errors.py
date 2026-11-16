"""A built-in tool that fails on bad input must not end the run."""

from ag_ui_antigravity.event_translator import EventTranslator, step_failure
from google.antigravity.types import BuiltinTools, Step, StepSource, StepStatus, StepType, ToolCall

from repo_doctor.agent import recover_tool_error

MISSING = "Cannot view file file:///tmp/rd/ws/abc/tqdm/_version.py which does not exist."


def _failed_view(error: str = MISSING) -> Step:
    return Step(
        id="s1",
        type=StepType.TOOL_CALL,
        source=StepSource.MODEL,
        status=StepStatus.ERROR,
        error=error,
        tool_calls=[
            ToolCall(
                name=BuiltinTools.VIEW_FILE, args={"file_path": "/tmp/rd/ws/abc/tqdm/_version.py"}
            )
        ],
    )


def test_failed_tool_step_is_not_a_run_failure() -> None:
    step = _failed_view()
    assert step_failure(step) is not None  # what ended the run before

    recovered = recover_tool_error(step)
    assert recovered.status == StepStatus.DONE
    assert step_failure(recovered) is None
    assert recovered.tool_calls[0].args["error"] == MISSING


async def test_recovered_step_closes_the_call_with_the_error() -> None:
    translator = EventTranslator()
    events = [e async for e in translator.translate(recover_tool_error(_failed_view()))]
    results = [e for e in events if e.type == "TOOL_CALL_RESULT"]
    assert len(results) == 1
    assert results[0].content.startswith("There was an error executing view_file:")
    assert "does not exist" in results[0].content


def test_denials_and_model_errors_are_left_alone() -> None:
    denied = _failed_view("denied by pre-tool hook: The user denied this tool call.")
    assert recover_tool_error(denied) is denied

    model_error = Step(
        type=StepType.TEXT_RESPONSE,
        source=StepSource.SYSTEM,
        status=StepStatus.ERROR,
        error="Resource exhausted",
    )
    assert recover_tool_error(model_error) is model_error


# ── Harness task steps (background commands and manage_task) ─────────────

import json  # noqa: E402

from google.antigravity.connections.local.event_processor import LocalConnectionStep  # noqa: E402
from google.antigravity.types import StepTarget  # noqa: E402

from repo_doctor.harness_steps import (  # noqa: E402
    HarnessCalls,
    StepShaper,
    parse_task_notice,
    recoverable_error,
)

CONV = "627ebf0139abc9ddfa6754b8e7323523"
KILL_DONE = (
    "error executing cascade step: CORTEX_STEP_TYPE_GENERIC: cannot kill task "
    f'"{CONV}/task-69": task is not running (status: DONE)'
)
LOG = f"file:///Users/me/.gemini/antigravity/brain/{CONV}/.system_generated/tasks/task-69.log"
FINISHED = (
    f"[Message] timestamp=2026-10-16T08:58:52Z sender={CONV}/task-69 "
    f'priority=MESSAGE_PRIORITY_HIGH content=Task id "{CONV}/task-69" finished with result:\n'
    "The command exited with code 1.\nOutput:\n  error: subprocess-exited-with-error\n"
    f" exit code: 1\nLog: {LOG}\n"
)
CANCELED = (
    f"[Message] timestamp=2026-10-16T08:52:44Z sender={CONV}/task-26 "
    f'priority=MESSAGE_PRIORITY_LOW content=Task id "{CONV}/task-26" was canceled with result:\n'
    "Step was canceled: context canceled by manage_task\n"
    "The following output was generated before the cancellation.\nOutput:\n"
    "Resolved 16 packages in 788ms\n + asv==0.6.6\n"
    f"Log: file:///Users/me/.gemini/antigravity/brain/{CONV}/.system_generated/tasks/task-26.log\n"
)


def _step(index: int, **fields: object) -> LocalConnectionStep:
    base: dict[str, object] = {
        "id": f"{CONV}:{index}",
        "step_index": index,
        "trajectory_id": CONV,
        "source": StepSource.MODEL,
        "status": StepStatus.DONE,
    }
    base.update(fields)
    return LocalConnectionStep(**base)  # type: ignore[arg-type]


async def _events(steps: list[Step], translator: EventTranslator | None = None) -> list:
    translator = translator or EventTranslator()
    out = []
    for step in steps:
        assert step_failure(step) is None
        out.extend([e async for e in translator.translate(step)])
    return out


def test_killing_a_finished_task_is_recoverable() -> None:
    step = _step(76, status=StepStatus.ERROR, target=StepTarget.ENVIRONMENT, error=KILL_DONE)
    assert step_failure(step) is not None  # what crashed the real run
    assert recoverable_error(step) == "manage_task"


def test_fatal_errors_stay_fatal() -> None:
    rate_limited = _step(
        5,
        status=StepStatus.ERROR,
        source=StepSource.SYSTEM,
        error="error executing cascade step: CORTEX_STEP_TYPE_GENERIC: try later",
        http_code=429,
    )
    quota = _step(6, status=StepStatus.ERROR, error=KILL_DONE.replace("cannot kill", "quota"))
    model = _step(
        7,
        status=StepStatus.ERROR,
        error="error executing cascade step: CORTEX_STEP_TYPE_PLANNER_RESPONSE: model failed",
    )
    plain = _step(8, status=StepStatus.ERROR, source=StepSource.SYSTEM, error="internal error")
    for step in (rate_limited, quota, model, plain):
        assert recoverable_error(step) is None
        assert recover_tool_error(step) is step
        assert StepShaper(HarnessCalls()).shape(step) == [step]


async def test_failed_task_action_becomes_a_tool_error_and_the_run_continues() -> None:
    calls = HarnessCalls()
    calls.record_call(
        ToolCall(
            name="manage_task",
            args={"Action": "kill", "TaskId": f"{CONV}/task-69", "toolSummary": "Kill task 69"},
            step_id=f"{CONV}:76",
        )
    )
    shaper = StepShaper(calls)
    active = _step(
        76,
        status=StepStatus.ACTIVE,
        target=StepTarget.ENVIRONMENT,
        content="Kill task 69",
        content_delta="Kill task 69",
    )
    failed = _step(
        76,
        status=StepStatus.ERROR,
        target=StepTarget.ENVIRONMENT,
        content="Kill task 69",
        error=KILL_DONE,
    )

    events = await _events([*shaper.shape(active), *shaper.shape(failed)])

    assert not [e for e in events if e.type.startswith("TEXT_MESSAGE")]
    start = next(e for e in events if e.type == "TOOL_CALL_START")
    assert start.tool_call_name == "manage_task"
    args = json.loads(next(e for e in events if e.type == "TOOL_CALL_ARGS").delta)
    assert args["action"] == "kill" and args["task"] == "task-69"
    result = next(e for e in events if e.type == "TOOL_CALL_RESULT").content
    assert result.startswith("There was an error executing manage_task:")
    assert "task is not running" in result
    assert CONV not in result


def test_task_notices_parse() -> None:
    finished = parse_task_notice(FINISHED)
    assert finished is not None
    assert finished["task"] == "task-69"
    assert finished["status"] == "finished"
    assert finished["exit_code"] == 1
    assert "subprocess-exited-with-error" in finished["output"]
    assert ".gemini" not in json.dumps(finished) and "file://" not in json.dumps(finished)

    canceled = parse_task_notice(CANCELED)
    assert canceled is not None
    assert canceled["status"] == "canceled" and canceled["exit_code"] is None
    assert "context canceled by manage_task" in canceled["reason"]
    assert canceled["output"].startswith("Resolved 16 packages")

    assert parse_task_notice("The tests pass now.") is None


async def test_a_task_notice_is_a_tool_row_not_prose() -> None:
    shaper = StepShaper(HarnessCalls())
    head, rest = FINISHED[:5], FINISHED[5:]
    steps = [
        _step(
            77, status=StepStatus.ACTIVE, source=StepSource.SYSTEM, content=head, content_delta=head
        ),
        _step(
            77,
            status=StepStatus.ACTIVE,
            source=StepSource.SYSTEM,
            content=FINISHED,
            content_delta=rest,
        ),
        _step(77, source=StepSource.SYSTEM, content=FINISHED),
    ]
    shaped = [s for step in steps for s in shaper.shape(step)]
    translator = EventTranslator()
    events = await _events(shaped, translator)

    assert not [e for e in events if e.type.startswith("TEXT_MESSAGE")]
    assert (
        next(e for e in events if e.type == "TOOL_CALL_START").tool_call_name == "background_task"
    )
    result = json.loads(next(e for e in events if e.type == "TOOL_CALL_RESULT").content)
    assert result["status"] == "finished" and result["exit_code"] == 1
    assert ".gemini" not in json.dumps([e.model_dump() for e in events])

    # A later run of the same turn re-delivers the step: nothing is emitted twice.
    again = await _events(shaper.shape(steps[-1]), translator)
    assert again == []


async def test_a_task_check_is_a_tool_row() -> None:
    calls = HarnessCalls()
    calls.record_call(
        ToolCall(
            name="manage_task",
            args={"Action": "status", "TaskId": f"{CONV}/task-33"},
            step_id=f"{CONV}:35",
        )
    )
    shaper = StepShaper(calls)
    label = "Check task 33 status"
    shaped = [
        *shaper.shape(
            _step(
                35,
                status=StepStatus.ACTIVE,
                target=StepTarget.ENVIRONMENT,
                content=label,
                content_delta=label,
            )
        ),
        *shaper.shape(_step(35, target=StepTarget.ENVIRONMENT, content=label)),
    ]
    events = await _events(shaped)

    assert not [e for e in events if e.type.startswith("TEXT_MESSAGE")]
    args = json.loads(next(e for e in events if e.type == "TOOL_CALL_ARGS").delta)
    assert args == {"action": "status", "task": "task-33"}


async def test_model_prose_still_streams() -> None:
    shaper = StepShaper(HarnessCalls())
    steps = [
        _step(
            15,
            status=StepStatus.ACTIVE,
            target=StepTarget.USER,
            content="I will",
            content_delta="I will",
        ),
        _step(
            15,
            status=StepStatus.ACTIVE,
            target=StepTarget.USER,
            content="I will run it.",
            content_delta=" run it.",
        ),
        _step(15, target=StepTarget.USER, content="I will run it."),
    ]
    shaped = [s for step in steps for s in shaper.shape(step)]
    assert shaped == steps
    events = await _events(shaped)
    text = "".join(e.delta for e in events if e.type == "TEXT_MESSAGE_CONTENT")
    assert text == "I will run it."


def test_an_invalid_tool_call_from_the_model_is_recoverable() -> None:
    step = Step(
        type=StepType.TEXT_RESPONSE,
        source=StepSource.SYSTEM,
        status=StepStatus.ERROR,
        error=(
            'The model produced an invalid tool call. ("model output error: invalid tool call '
            'error (invalid_args) argument TargetFile not found")'
        ),
    )
    assert recoverable_error(step) == "edit_file"


def test_an_improper_format_stop_is_recoverable() -> None:
    step = Step(
        type=StepType.TEXT_RESPONSE,
        source=StepSource.SYSTEM,
        status=StepStatus.ERROR,
        error=(
            'Model produced invalid output. ("model output error: encountered an improper '
            'format stop reason.\\nPlease retry with a properly formatted function call.")'
        ),
    )
    assert recoverable_error(step) is not None


def test_an_inline_async_notice_is_cut_from_prose() -> None:
    from repo_doctor.harness_steps import HarnessCalls, StepShaper

    text = (
        "Waiting for pytest to finish. ...An async task has completed: Task ID: "
        "33eaaf20d43cc6b30a8eaf97e6de7c52/task-36 Task Summary: .venv/bin/pytest Exit Code: 0 "
        "Log Path: file:///Users/x/.gemini/antigravity/brain/abc/task-36.log Output: 85 passed"
    )
    shaper = StepShaper(HarnessCalls())
    base = dict(type=StepType.TEXT_RESPONSE, source=StepSource.MODEL, id="s1")
    first = shaper.shape(
        Step(**base, status=StepStatus.ACTIVE, content=text[:20], content_delta=text[:20])
    )
    last = shaper.shape(Step(**base, status=StepStatus.DONE, content=text, content_delta=text[20:]))
    streamed = "".join(s.content_delta or "" for s in [*first, *last] if not s.tool_calls)
    assert streamed == "Waiting for pytest to finish."
    calls = [c for s in last for c in (s.tool_calls or [])]
    assert calls and calls[-1].name == "background_task"
    assert calls[-1].args["exit_code"] == 0
    assert "gemini" not in json.dumps(calls[-1].args)
