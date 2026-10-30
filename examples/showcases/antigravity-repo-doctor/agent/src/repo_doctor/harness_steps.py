"""Reshapes harness steps the adapter would otherwise show raw or treat as fatal.

The Antigravity harness runs a `run_command` that does not finish within its
wait time (at most 10 s, the model's `WaitMsBeforeAsync`) as a background
task, and enables a `manage_task` tool next to `run_command`. Neither has a
field of its own in the harness's StepUpdate proto, so the SDK
(google-antigravity 0.1.22, `LocalConnectionStep.from_dict`) reports them as
plain text steps without tool calls:

* a `manage_task` call is a step from the model, aimed at the environment,
  whose text is the model's own label ("Check task 33 status");
* a finished or cancelled background task is a text step that starts
  `[Message] timestamp=... sender=<conversation>/task-N priority=...
  content=Task id "..." finished with result: ... Output: ... Log: file://...`.

ag-ui-antigravity 0.2.1 translates every such step's text as assistant prose,
so the chat filled with raw task notices and local log paths. And when a
`manage_task` call fails (killing a task that already finished), the harness
reports it as an ERROR step with no tool call, which the adapter's
`step_failure` turns into RUN_ERROR although the harness carries on and hands
the error to the model.

`StepShaper` turns these into ordinary tool-call steps the adapter already
knows how to stream: a `background_task` call for each notice and a
`manage_task` call for each task action, with the arguments the approval hook
saw (recorded by `HarnessCalls`). Recoverable tool errors become completed
calls that carry the error, so the run keeps going; model, quota and auth
failures stay fatal.
"""

from __future__ import annotations

import json
import re
from collections import deque
from dataclasses import dataclass, field
from typing import Any

from google.antigravity.hooks import hooks as ag_hooks
from google.antigravity.types import (
    HookResult,
    Step,
    StepSource,
    StepStatus,
    StepTarget,
    StepType,
    ToolCall,
    ToolResult,
)

from .guards import BLOCKED, blocked_tool

# google-antigravity raises this when a pre-tool decide hook denies a call;
# `ThreadScopedAntigravityAgent.run` turns it into a clean finish.
DENIED_BY_HOOK = "denied by pre-tool hook"

BACKGROUND_TASK = "background_task"
MANAGE_TASK = "manage_task"
HARNESS_ACTION = "harness_action"

_NOTICE = re.compile(
    r"^\s*\[Message\]\s+timestamp=(?P<at>\S*)\s+sender=(?P<sender>\S*)\s+"
    r"priority=(?P<priority>\S*)\s+content=(?P<content>.*)\Z",
    re.DOTALL,
)
_TASK_HEAD = re.compile(r'^Task id "(?P<task>[^"]*)" (?P<status>.+?) with result:\s*\n?', re.DOTALL)
_EXIT_CODE = re.compile(r"exited with code (-?\d+)")
_LOG_LINE = re.compile(r"^\s*Log:\s*file://\S*\s*$", re.MULTILINE)
_FILE_URI = re.compile(r"file://\S+")
_TASK_ID = re.compile(r"(?:^|/)(task-\d+)\b")
# Task ids carry the harness conversation id: "<32 hex>/task-26".
_CONVERSATION_TASK = re.compile(r"\b[0-9a-f]{16,}/(task-\d+)\b")

# The harness wraps a step that failed while running as
# "error executing cascade step: CORTEX_STEP_TYPE_<KIND>: <reason>".
_STEP_ERROR = re.compile(
    r"error executing cascade step:\s*CORTEX_STEP_TYPE_([A-Z_]+):\s*(.*)", re.DOTALL
)

# "The model produced an invalid tool call. (... argument TargetFile not found)"
_INVALID_CALL = re.compile(
    r"(?:invalid tool call|model produced invalid output|improper format stop reason)"
    r"(?:.*?argument (\w+) not found)?",
    re.IGNORECASE | re.DOTALL,
)

# A harness notice the model's own text can carry inline, e.g. "Waiting for
# pytest. ...An async task has completed: Task ID: <conv>/task-36 Task Summary:
# .venv/bin/pytest Exit Code: 0 Log Path: file://... Output: ...".
_INLINE_NOTICE = re.compile(r"(?:\.\.\.|\u2026)?\s*(?:An async task has completed:|\[Message\])")
_ASYNC_TASK = re.compile(r"Task ID:\s*(?P<task>\S+)", re.IGNORECASE)
_ASYNC_EXIT = re.compile(r"Exit Code:\s*(?P<code>-?\d+)", re.IGNORECASE)
_ASYNC_SUMMARY = re.compile(
    r"Task Summary:\s*(?P<summary>.*?)\s*(?:Exit Code:|Log Path:|Output:|$)",
    re.IGNORECASE | re.DOTALL,
)
# Model-facing argument names to the tool they belong to.
_INVALID_ARG_TOOL = {
    "TargetFile": "edit_file",
    "TargetContent": "edit_file",
    "ReplacementContent": "edit_file",
    "ReplacementChunks": "edit_file",
    "CommandLine": "run_command",
    "AbsolutePath": "view_file",
    "DirectoryPath": "list_directory",
    "SearchPath": "search_directory",
    "Query": "search_directory",
}

# Step kinds that are a tool acting on the workspace. Their failure is a
# failed action the model can react to, not a broken run.
_ACTION_KINDS: dict[str, str] = {
    "GENERIC": MANAGE_TASK,
    "COMMAND_STATUS": MANAGE_TASK,
    "RUN_COMMAND": "run_command",
    "SHELL_EXEC": "run_command",
    "SEND_COMMAND_INPUT": "run_command",
    "READ_TERMINAL": "run_command",
    "VIEW_FILE": "view_file",
    "VIEW_FILE_OUTLINE": "view_file",
    "VIEW_CONTENT_CHUNK": "view_file",
    "LIST_DIRECTORY": "list_directory",
    "FIND": "find_file",
    "GREP_SEARCH": "search_directory",
    "CODE_ACTION": "edit_file",
    "FILE_CHANGE": "edit_file",
    "MOVE": HARNESS_ACTION,
    "DELETE_DIRECTORY": HARNESS_ACTION,
    "WAIT": HARNESS_ACTION,
    "MCP_TOOL": HARNESS_ACTION,
}

# Words that mark a model, quota or credential failure. Those end the run even
# when they surface on a tool step.
_FATAL_MARKERS = (
    "quota",
    "rate limit",
    "ratelimit",
    "resource exhausted",
    "resource_exhausted",
    "api key",
    "api_key",
    "unauthenticated",
    "billing",
)

# Harness status labels on environment steps that say nothing to a person.
_SILENT_LABELS = ("requesting permission",)


def strip_local_paths(text: str) -> str:
    """Drops harness log lines, file:// URIs (they point into ~/.gemini) and
    the conversation id in task ids."""
    text = _FILE_URI.sub("", _LOG_LINE.sub("", text))
    return _CONVERSATION_TASK.sub(r"\1", text)


def short_task_id(raw: str) -> str:
    """`<conversation>/task-26` -> `task-26`."""
    match = _TASK_ID.search(raw or "")
    return match.group(1) if match else (raw or "").rsplit("/", 1)[-1]


def parse_task_notice(text: str) -> dict[str, Any] | None:
    """Reads a harness background-task notice, or returns None.

    Shapes seen in a real run (harness bundled with google-antigravity 0.1.22):
    `Task id "<id>" finished with result:\\nThe command exited with code 1.\\n
    Output:\\n...\\nLog: file://...` and `Task id "<id>" was canceled with
    result:\\nStep was canceled: ...\\nThe following output was generated
    before the cancellation.\\nOutput:\\n...\\nLog: file://...`.
    """
    match = _NOTICE.match(text or "")
    if not match:
        return None
    content = match.group("content")
    head = _TASK_HEAD.match(content)
    task = short_task_id(head.group("task") if head else match.group("sender"))
    body = content[head.end() :] if head else content
    raw_status = head.group("status").strip().lower() if head else ""
    if "cancel" in raw_status:
        status = "canceled"
    elif "finish" in raw_status or "complete" in raw_status:
        status = "finished"
    elif "fail" in raw_status or "error" in raw_status:
        status = "failed"
    else:
        status = raw_status or "update"
    output = ""
    summary = body
    if "Output:" in body:
        summary, output = body.split("Output:", 1)
    exit_match = _EXIT_CODE.search(summary)
    reason_lines = [
        line.strip()
        for line in summary.splitlines()
        if line.strip()
        and not _EXIT_CODE.search(line)
        and not line.strip().startswith("The following output was generated")
    ]
    return {
        "task": task,
        "status": status,
        "exit_code": int(exit_match.group(1)) if exit_match else None,
        "reason": strip_local_paths(" ".join(reason_lines)).strip()[:300],
        "output": strip_local_paths(output).strip("\n"),
    }


def _name(call: ToolCall | ToolResult) -> str:
    return call.name.value if hasattr(call.name, "value") else str(call.name)


def task_args(name: str, args: dict[str, Any]) -> dict[str, Any]:
    """The arguments a task row needs, without the conversation id."""
    if name != MANAGE_TASK:
        return {k: v for k, v in args.items() if isinstance(v, (str, int, float, bool))}
    action = str(args.get("Action") or args.get("action") or "").lower()
    out: dict[str, Any] = {"action": action}
    task = args.get("TaskId") or args.get("task_id") or args.get("TaskIds")
    if isinstance(task, list):
        out["task"] = ", ".join(short_task_id(str(t)) for t in task)
    elif task:
        out["task"] = short_task_id(str(task))
    summary = args.get("toolSummary")
    if isinstance(summary, str) and summary:
        out["summary"] = summary[:120]
    return out


@dataclass
class _Recorded:
    name: str
    args: dict[str, Any]
    step_id: str | None


@dataclass
class HarnessCalls:
    """Tool calls and results seen by the SDK hooks, for one thread.

    The hooks see every harness tool call with its arguments and step id,
    including the ones (`manage_task`) whose steps carry no tool call.
    """

    by_step: dict[str, _Recorded] = field(default_factory=dict)
    results: dict[str, str] = field(default_factory=dict)
    unmatched: deque[_Recorded] = field(default_factory=lambda: deque(maxlen=32))

    def record_call(self, call: ToolCall) -> None:
        args = call.args if isinstance(call.args, dict) else {}
        recorded = _Recorded(name=_name(call), args=dict(args), step_id=call.step_id)
        if call.step_id:
            self.by_step[call.step_id] = recorded
        if recorded.name == MANAGE_TASK:
            self.unmatched.append(recorded)

    def record_result(self, result: ToolResult) -> None:
        if not result.step_id or _name(result) != MANAGE_TASK:
            return
        if result.error:
            self.results[result.step_id] = f"error: {result.error}"
            return
        value = result.result
        text = value if isinstance(value, str) else json.dumps(value, default=str)
        self.results[result.step_id] = strip_local_paths(text or "")[:20_000]

    def call_for(self, step: Step) -> _Recorded | None:
        """The recorded call behind a step that has no tool call of its own."""
        recorded = self.by_step.get(step.id)
        if recorded is None and self.unmatched:
            # Older harnesses may not report the step id to the hook.
            recorded = self.unmatched.popleft()
        elif recorded is not None and recorded in self.unmatched:
            self.unmatched.remove(recorded)
        return recorded

    def hooks(self) -> list[Any]:
        """A decide hook that only records (it always allows) and a post hook."""

        @ag_hooks.pre_tool_call_decide  # type: ignore[untyped-decorator]
        async def _record_call(call: ToolCall) -> HookResult:
            self.record_call(call)
            return HookResult(allow=True)

        @ag_hooks.post_tool_call  # type: ignore[untyped-decorator]
        async def _record_result(result: ToolResult) -> None:
            self.record_result(result)

        return [_record_call, _record_result]


def _is_fatal_text(text: str) -> bool:
    lowered = text.lower()
    return any(marker in lowered for marker in _FATAL_MARKERS)


def recoverable_error(step: Step) -> str | None:
    """The tool name a failed step belongs to when the run can continue, else None.

    Recoverable: a failed built-in TOOL_CALL step, or a harness step that
    failed while running a tool action ("error executing cascade step:
    CORTEX_STEP_TYPE_GENERIC: cannot kill task ...: task is not running").
    Fatal: denials (handled by `run()`), errors with an HTTP code (rate limits,
    5xx, auth), and anything that names a quota, key or billing problem.
    """
    if step.status != StepStatus.ERROR:
        return None
    detail = step.error or ""
    if BLOCKED in detail:
        # A guard's rejection (guards.py) goes back to the model as the call's
        # error. The harness reports it as a step without the call, so the
        # message says which tool it was.
        if step.tool_calls:
            return _name(step.tool_calls[0])
        return blocked_tool(detail)
    if DENIED_BY_HOOK in detail:
        return None  # a user's denial ends the run (see `run()`)
    if step.type == StepType.TOOL_CALL and step.tool_calls:
        return _name(step.tool_calls[0])
    detail = step.error or ""
    if getattr(step, "http_code", 0) or _is_fatal_text(detail):
        return None
    # A malformed call from the model (a missing argument): the call never ran,
    # so it goes back as a failed call of the tool it was meant for.
    invalid = _INVALID_CALL.search(detail)
    if invalid:
        return _INVALID_ARG_TOOL.get(invalid.group(1) or "", HARNESS_ACTION)
    match = _STEP_ERROR.search(detail)
    if not match:
        return None
    return _ACTION_KINDS.get(match.group(1))


def _call_step(
    step: Step, call_id: str, name: str, args: dict[str, Any], status: StepStatus
) -> Step:
    return step.model_copy(
        update={
            "type": StepType.TOOL_CALL,
            "status": status,
            "content": "",
            "content_delta": "",
            "error": "",
            "tool_calls": [ToolCall(name=name, args=args, id=call_id, step_id=step.id)],
        }
    )


def _call_steps(
    step: Step, call_id: str, name: str, args: dict[str, Any], result: dict[str, Any]
) -> list[Step]:
    """An ACTIVE then a DONE step for one call.

    The adapter takes a built-in call's result from the argument keys that
    appear after it first saw the call, so the result keys arrive on the DONE
    step only.
    """
    return [
        _call_step(step, call_id, name, args, StepStatus.ACTIVE),
        _call_step(step, call_id, name, {**args, **result}, StepStatus.DONE),
    ]


@dataclass
class StepShaper:
    """Per-session state for reshaping steps; see the module docstring."""

    calls: HarnessCalls
    _held: set[str] = field(default_factory=set)
    _streamed: set[str] = field(default_factory=set)
    # Characters of each prose step already sent, so a notice the harness
    # appends to the model's text is cut off before it streams.
    _sent: dict[str, int] = field(default_factory=dict)
    # Reshaped output of finished steps. A turn that spans several AG-UI runs
    # gets its earlier steps re-delivered; the same output keeps the
    # adapter's per-turn de-duplication working.
    _finished: dict[str, list[Step]] = field(default_factory=dict)

    @staticmethod
    def _key(step: Step) -> str:
        return step.id or f":{step.step_index}"

    def _may_be_prose(self, step: Step) -> bool:
        """A text step the model meant for the user (stream it as it grows)."""
        if step.source != StepSource.MODEL or step.target == StepTarget.ENVIRONMENT:
            return False
        text = (step.content or step.content_delta or "").lstrip()
        # A task notice must never stream, even if a harness version tags it
        # as model output.
        return not (text and ("[Message]".startswith(text[:9]) or text.startswith("[Message]")))

    def shape(self, step: Step) -> list[Step]:
        if step.source == StepSource.USER:
            return [step]
        key = self._key(step)
        if key in self._finished and step.status in (StepStatus.DONE, StepStatus.ERROR):
            return self._finished[key]

        failed_tool = recoverable_error(step)
        if failed_tool is not None:
            shaped = [self._recover(step, failed_tool)]
            self._finished[key] = shaped
            return shaped
        if step.status == StepStatus.ERROR:
            return [step]

        if step.tool_calls or step.type not in (StepType.TEXT_RESPONSE, StepType.UNKNOWN):
            return [step]

        if key in self._streamed:
            return self._prose(step, key)
        if key not in self._held and self._may_be_prose(step):
            if step.content_delta:
                self._streamed.add(key)
            return self._prose(step, key)

        # Hold everything else until the step is complete, then decide.
        self._held.add(key)
        if step.status != StepStatus.DONE:
            return [step.model_copy(update={"content_delta": ""})]
        self._held.discard(key)
        shaped = self._finish_held(step)
        self._finished[key] = shaped
        return shaped

    def _prose(self, step: Step, key: str) -> list[Step]:
        """Streams the model's text up to any inline harness notice."""
        content = step.content or ""
        if not content:
            return [step]
        cut = _INLINE_NOTICE.search(content)
        allowed = content[: cut.start()].rstrip() if cut else content
        sent = self._sent.get(key, 0)
        delta = allowed[sent:] if len(allowed) > sent else ""
        self._sent[key] = max(sent, len(allowed))
        clipped = step.model_copy(update={"content": allowed, "content_delta": delta})
        if not cut or step.status != StepStatus.DONE:
            return [clipped]
        notice = content[cut.start() :]
        task = _ASYNC_TASK.search(notice)
        code = _ASYNC_EXIT.search(notice)
        out = notice.split("Output:", 1)[1].strip() if "Output:" in notice else ""
        result: dict[str, Any] = {
            "status": "finished",
            "output": strip_local_paths(out)[-4000:],
        }
        if code:
            result["exit_code"] = int(code.group("code"))
        summary = _ASYNC_SUMMARY.search(notice)
        if summary:
            result["summary"] = strip_local_paths(summary.group("summary").strip())[:200]
        args = {"task": short_task_id(task.group("task")) if task else "task"}
        shaped = [clipped, *_call_steps(step, f"rd-task:{step.id}", BACKGROUND_TASK, args, result)]
        self._finished[key] = shaped
        return shaped

    def _finish_held(self, step: Step) -> list[Step]:
        text = step.content or ""
        notice = parse_task_notice(text)
        if notice is not None:
            task = notice.pop("task")
            return _call_steps(step, f"rd-task:{step.id}", BACKGROUND_TASK, {"task": task}, notice)

        label = text.strip()
        if step.target == StepTarget.ENVIRONMENT and (
            not label or label.lower().startswith(_SILENT_LABELS)
        ):
            return [step.model_copy(update={"content_delta": ""})]

        recorded = self.calls.call_for(step) if step.target == StepTarget.ENVIRONMENT else None
        if recorded is not None:
            args = task_args(recorded.name, recorded.args)
            result = self.calls.results.get(step.id, "")
            return _call_steps(step, f"rd-call:{step.id}", recorded.name, args, {"output": result})

        if step.target == StepTarget.ENVIRONMENT:
            # A harness label for an action with no tool call of its own.
            return _call_steps(
                step, f"rd-call:{step.id}", HARNESS_ACTION, {"label": label[:120]}, {"output": ""}
            )

        # Text that is neither a notice nor a tool label: show it once, whole.
        return [step.model_copy(update={"content_delta": strip_local_paths(text)})]

    def _recover(self, step: Step, tool: str) -> Step:
        """A failed tool step as a completed call that carries the error."""
        detail = step.error or step.content or "the tool failed"
        if step.tool_calls:
            calls = [
                call.model_copy(
                    update={
                        "args": {
                            **(call.args if isinstance(call.args, dict) else {}),
                            "error": detail,
                        }
                    }
                )
                for call in step.tool_calls
            ]
            return step.model_copy(update={"status": StepStatus.DONE, "tool_calls": calls})
        match = _STEP_ERROR.search(detail)
        reason = strip_local_paths(match.group(2) if match else detail).strip()
        self._held.discard(self._key(step))
        recorded = self.calls.call_for(step)
        name = recorded.name if recorded is not None else tool
        args = task_args(name, recorded.args) if recorded is not None else {}
        if name == MANAGE_TASK and "task" not in args and (task := _TASK_ID.search(reason)):
            args["task"] = task.group(1)
        return _call_step(
            step, f"rd-call:{step.id}", name, {**args, "error": reason}, StepStatus.DONE
        )
