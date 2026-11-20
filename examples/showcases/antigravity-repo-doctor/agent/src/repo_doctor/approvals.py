"""A durable log of the user's approve/deny decisions.

The adapter turns each risky tool call into an AG-UI interrupt and resolves it
from the next run's `RunAgentInput.resume`. Nothing in the conversation records
the decision itself: a denied custom tool never runs, so it leaves no tool call
behind. This module remembers each approval interrupt a run ends on, matches it
to the answer in the next run, and appends the decision to shared state. Shared
state travels in STATE_SNAPSHOT events, so a reopened thread shows the full
approval history.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal

from ag_ui.core import Interrupt, ResumeEntry

APPROVAL_REASON = "tool_approval"
MALFORMED_ANSWER = "The approval answer was not a yes or no, so the call was blocked."
MAX_SUMMARY_CHARS = 160


def summarize_call(tool: str, args: dict[str, Any], workspace_key: str) -> str:
    """One line a person can scan in an approval history."""
    if tool in ("install_dependencies", "run_check"):
        summary = str(args.get("command", ""))
    elif tool == "run_command":
        summary = str(args.get("CommandLine", ""))
    elif tool == "edit_file":
        # Absolute paths may come back resolved (/private/tmp on macOS), so cut
        # at the workspace key rather than at a known prefix.
        target = str(args.get("TargetFile", ""))
        summary = target.split(f"/{workspace_key}/", 1)[-1]
    elif tool == "git_push":
        summary = str(args.get("branch", ""))
    elif tool == "manage_task":
        # TaskId is "<conversation id>/task-N"; the task number is enough.
        task = str(args.get("TaskId", "")).rsplit("/", 1)[-1]
        summary = f"{str(args.get('Action', '')).lower()} {task}".strip()
    else:
        summary = ""
    return summary[:MAX_SUMMARY_CHARS]


@dataclass
class _Asked:
    tool: str
    summary: str


@dataclass
class ApprovalLog:
    """Tracks open approval interrupts per thread, in this process."""

    _open: dict[str, dict[str, _Asked]] = field(default_factory=dict)

    def remember(self, thread_id: str, interrupts: list[Interrupt], workspace_key: str) -> None:
        asked = self._open.setdefault(thread_id, {})
        for interrupt in interrupts:
            if interrupt.reason != APPROVAL_REASON:
                continue
            meta = interrupt.metadata or {}
            tool = str(meta.get("tool_name", "tool"))
            raw_args = meta.get("args")
            args: dict[str, Any] = raw_args if isinstance(raw_args, dict) else {}
            summary = summarize_call(tool, args, workspace_key)
            asked[interrupt.id] = _Asked(tool=tool, summary=summary)

    def sanitize(self, thread_id: str, answers: list[ResumeEntry]) -> list[ResumeEntry]:
        """The answers, with every malformed approval turned into a deny.

        The adapter reads `approved` with `bool()`, so `"false"` would run the
        call while `decide` logs it as denied. Only a real boolean counts, in
        `{"approved": ...}` or on its own; anything else is blocked, so the
        call that runs and the decision that is logged always agree.

        Every answer is treated as an approval, recorded here or not: the agent
        turns off the adapter's other interrupts (questions and sub-agents).
        """
        cleaned: list[ResumeEntry] = []
        for answer in answers:
            if answer.status == "resolved":
                payload = answer.payload
                if isinstance(payload, bool):
                    payload = {"approved": payload}
                elif not (isinstance(payload, dict) and isinstance(payload.get("approved"), bool)):
                    payload = {"approved": False, "message": MALFORMED_ANSWER}
                if payload is not answer.payload:
                    answer = answer.model_copy(update={"payload": payload})
            cleaned.append(answer)
        return cleaned

    def command_as_answer(self, thread_id: str, command: Any) -> ResumeEntry | None:
        """An answer sent as `forwardedProps.command`, as a `resume` entry.

        CopilotKit Channels answers an interrupt that way, often with no id.
        The adapter matches such an answer to the single parked interrupt; this
        does the same with the open approvals, so the answer goes through
        `sanitize` and `decide` like any other. None when it cannot be matched.
        """
        interrupt_id: str | None = None
        payload: Any = command
        status: Literal["resolved", "cancelled"] = "resolved"
        if isinstance(command, dict):
            for key in ("interruptId", "interrupt_id"):
                candidate = command.get(key)
                if isinstance(candidate, str) and candidate:
                    interrupt_id = candidate
                    payload = command.get("payload", command)
                    break
            if command.get("status") == "cancelled":
                status = "cancelled"
        if interrupt_id is None:
            asked = self._open.get(thread_id, {})
            if len(asked) != 1:
                return None
            interrupt_id = next(iter(asked))
        return ResumeEntry(
            interrupt_id=interrupt_id,
            status=status,
            payload=None if status == "cancelled" else payload,
        )

    def forget(self, thread_id: str) -> None:
        self._open.pop(thread_id, None)

    def decide(self, thread_id: str, answers: list[ResumeEntry]) -> list[dict[str, Any]]:
        """Records for every answered approval interrupt, oldest first."""
        asked = self._open.get(thread_id, {})
        records: list[dict[str, Any]] = []
        now = datetime.now(UTC).isoformat(timespec="seconds")
        for answer in answers:
            request = asked.pop(answer.interrupt_id, None)
            if request is None:
                continue
            payload = answer.payload if isinstance(answer.payload, dict) else {}
            approved = answer.status == "resolved" and payload.get("approved") is True
            record: dict[str, Any] = {
                "id": answer.interrupt_id,
                "tool": request.tool,
                "summary": request.summary,
                "decision": "approved" if approved else "denied",
                "at": now,
            }
            if note := str(payload.get("message") or "").strip():
                record["note"] = note[:MAX_SUMMARY_CHARS]
            elif approved and payload.get("auto") is True:
                # Answered by the browser's Auto-approve switch, not a click.
                record["note"] = "auto"
            records.append(record)
        if not asked:
            self._open.pop(thread_id, None)
        return records
