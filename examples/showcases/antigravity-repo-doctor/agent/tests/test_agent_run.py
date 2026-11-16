"""The run wrapper around the adapter: approval log and the denial rewrite.

The adapter's own run is replaced by a scripted event stream, so these tests
cover only what ThreadScopedAntigravityAgent adds.
"""

from collections.abc import AsyncIterator
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from ag_ui.core import (
    BaseEvent,
    EventType,
    Interrupt,
    ResumeEntry,
    RunAgentInput,
    RunErrorEvent,
    RunFinishedEvent,
    RunStartedEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
)
from ag_ui_antigravity import AntigravityAgent
from ag_ui_antigravity.ui_bridge import _read_approval

from repo_doctor.agent import ThreadScopedAntigravityAgent, create_agent
from repo_doctor.config import Settings

THREAD = "thread-1"
DENIAL = (
    "AntigravityExecutionError: The user denied this tool call. "
    '("denied by pre-tool hook: The user denied this tool call.")'
)


def _input(resume: list[ResumeEntry] | None = None, state: dict[str, Any] | None = None):
    return RunAgentInput(
        thread_id=THREAD,
        run_id="run",
        state=state or {},
        messages=[],
        tools=[],
        context=[],
        forwarded_props={},
        resume=resume,
    )


def _answer(approved: bool) -> RunAgentInput:
    """The next run, carrying the user's answer to interrupt i1."""
    entry = ResumeEntry(interrupt_id="i1", status="resolved", payload={"approved": approved})
    return _input(resume=[entry])


def _started() -> RunStartedEvent:
    return RunStartedEvent(type=EventType.RUN_STARTED, thread_id=THREAD, run_id="run")


def _interrupted(interrupt_id: str) -> RunFinishedEvent:
    interrupt = Interrupt(
        id=interrupt_id,
        reason="tool_approval",
        metadata={"tool_name": "run_command", "args": {"CommandLine": "pip install x"}},
    )
    return RunFinishedEvent.model_validate(
        {
            "type": EventType.RUN_FINISHED,
            "threadId": THREAD,
            "runId": "run",
            "outcome": {"type": "interrupt", "interrupts": [interrupt.model_dump(by_alias=True)]},
        }
    )


@pytest.fixture
def agent(tmp_path: Path) -> ThreadScopedAntigravityAgent:
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None,
        gemini_api_key="k",
        workspace_root=tmp_path / "ws",
        save_dir=tmp_path / "s",
        push_root=tmp_path / "r",
        venv_root=tmp_path / "v",
        uv_cache_dir=tmp_path / "uvc",
    )
    return create_agent(settings)


def _script(monkeypatch: pytest.MonkeyPatch, *runs: list[BaseEvent]) -> None:
    """Each call to the adapter's run yields the next scripted event list."""
    queue = list(runs)

    async def fake_run(
        self: AntigravityAgent, input_data: RunAgentInput
    ) -> AsyncIterator[BaseEvent]:
        for event in queue.pop(0):
            yield event

    monkeypatch.setattr(AntigravityAgent, "run", fake_run)


async def _collect(agent: ThreadScopedAntigravityAgent, data: RunAgentInput) -> list[BaseEvent]:
    return [event async for event in agent.run(data)]


async def test_a_denial_ends_the_run_cleanly_and_is_logged(
    agent: ThreadScopedAntigravityAgent, monkeypatch: pytest.MonkeyPatch
) -> None:
    _script(
        monkeypatch,
        [_started(), _interrupted("i1")],
        [_started(), RunErrorEvent(type=EventType.RUN_ERROR, message=DENIAL)],
    )
    await _collect(agent, _input())

    events = await _collect(
        agent,
        _input(
            resume=[ResumeEntry(interrupt_id="i1", status="resolved", payload={"approved": False})]
        ),
    )

    types = [e.type for e in events]
    assert EventType.RUN_ERROR not in types
    assert types[-1] == EventType.RUN_FINISHED
    assert EventType.TEXT_MESSAGE_CONTENT in types
    snapshot = next(e for e in events if e.type == EventType.STATE_SNAPSHOT)
    [record] = snapshot.snapshot["approvals"]
    assert (record["tool"], record["decision"], record["summary"]) == (
        "run_command",
        "denied",
        "pip install x",
    )


async def test_an_approval_is_logged_and_events_pass_through(
    agent: ThreadScopedAntigravityAgent, monkeypatch: pytest.MonkeyPatch
) -> None:
    finished = RunFinishedEvent(type=EventType.RUN_FINISHED, thread_id=THREAD, run_id="run")
    _script(monkeypatch, [_started(), _interrupted("i1")], [_started(), finished])
    await _collect(agent, _input())

    events = await _collect(
        agent,
        _input(
            resume=[ResumeEntry(interrupt_id="i1", status="resolved", payload={"approved": True})]
        ),
    )

    assert [e.type for e in events] == [
        EventType.RUN_STARTED,
        EventType.STATE_SNAPSHOT,
        EventType.RUN_FINISHED,
    ]
    assert events[1].snapshot["approvals"][0]["decision"] == "approved"


def _capture(monkeypatch: pytest.MonkeyPatch, *runs: list[BaseEvent]) -> list[RunAgentInput]:
    """Like _script, and records the input the adapter receives on each run."""
    queue, seen = list(runs), []

    async def fake_run(
        self: AntigravityAgent, input_data: RunAgentInput
    ) -> AsyncIterator[BaseEvent]:
        seen.append(input_data)
        for event in queue.pop(0):
            yield event

    monkeypatch.setattr(AntigravityAgent, "run", fake_run)
    return seen


@pytest.mark.parametrize(
    ("answer", "decision"),
    [
        ({"approved": "false"}, "denied"),
        ({"approved": False}, "denied"),
        ({"approved": True}, "approved"),
    ],
)
async def test_the_adapter_runs_what_the_log_records(
    agent: ThreadScopedAntigravityAgent,
    monkeypatch: pytest.MonkeyPatch,
    answer: dict[str, Any],
    decision: str,
) -> None:
    """`"false"` used to be logged as denied while the adapter ran the call."""
    finished = RunFinishedEvent(type=EventType.RUN_FINISHED, thread_id=THREAD, run_id="run")
    seen = _capture(monkeypatch, [_started(), _interrupted("i1")], [_started(), finished])
    await _collect(agent, _input())

    events = await _collect(
        agent, _input(resume=[ResumeEntry(interrupt_id="i1", status="resolved", payload=answer)])
    )

    [entry] = seen[1].resume or []
    assert _read_approval(entry.payload)[0] is (decision == "approved")
    snapshot = next(e for e in events if e.type == EventType.STATE_SNAPSHOT)
    assert snapshot.snapshot["approvals"][0]["decision"] == decision


@pytest.mark.parametrize(
    ("command", "decision"),
    [
        ({"approved": "false"}, "denied"),
        ({"approved": True}, "approved"),
        ({"interruptId": "i1", "payload": {"approved": "false"}}, "denied"),
    ],
)
async def test_an_answer_in_forwarded_props_is_checked_and_logged(
    agent: ThreadScopedAntigravityAgent,
    monkeypatch: pytest.MonkeyPatch,
    command: dict[str, Any],
    decision: str,
) -> None:
    """CopilotKit Channels answers with forwardedProps.command, not resume."""
    finished = RunFinishedEvent(type=EventType.RUN_FINISHED, thread_id=THREAD, run_id="run")
    seen = _capture(monkeypatch, [_started(), _interrupted("i1")], [_started(), finished])
    await _collect(agent, _input())
    resumed = _input().model_copy(update={"forwarded_props": {"command": command, "other": 1}})

    events = await _collect(agent, resumed)

    assert seen[1].forwarded_props == {"other": 1}
    [entry] = seen[1].resume or []
    assert entry.interrupt_id == "i1"
    assert _read_approval(entry.payload)[0] is (decision == "approved")
    snapshot = next(e for e in events if e.type == EventType.STATE_SNAPSHOT)
    assert snapshot.snapshot["approvals"][0]["decision"] == decision


async def test_other_errors_are_not_rewritten(
    agent: ThreadScopedAntigravityAgent, monkeypatch: pytest.MonkeyPatch
) -> None:
    _script(
        monkeypatch,
        [_started(), _interrupted("i1")],
        [_started(), RunErrorEvent(type=EventType.RUN_ERROR, message="quota exceeded")],
    )
    await _collect(agent, _input())

    events = await _collect(
        agent,
        _input(
            resume=[ResumeEntry(interrupt_id="i1", status="resolved", payload={"approved": True})]
        ),
    )

    assert events[-1].type == EventType.RUN_ERROR


async def test_a_new_message_forgets_unanswered_approvals(
    agent: ThreadScopedAntigravityAgent, monkeypatch: pytest.MonkeyPatch
) -> None:
    finished = RunFinishedEvent(type=EventType.RUN_FINISHED, thread_id=THREAD, run_id="run")
    _script(
        monkeypatch,
        [_started(), _interrupted("i1")],
        [_started(), finished],
        [_started(), finished],
    )
    await _collect(agent, _input())
    await _collect(agent, _input())  # The user typed instead of answering.

    events = await _collect(
        agent,
        _input(
            resume=[ResumeEntry(interrupt_id="i1", status="resolved", payload={"approved": True})]
        ),
    )

    assert EventType.STATE_SNAPSHOT not in [e.type for e in events]


def test_each_thread_builds_with_its_own_workspace(agent: ThreadScopedAntigravityAgent) -> None:
    """Pins the private adapter surface the per-thread override depends on."""
    from ag_ui_antigravity import UIBridge

    built = agent._build_agent(UIBridge(), _input(), None)

    [workspace] = built._config.workspaces
    assert workspace.startswith(str(agent._settings.workspace_root))
    assert workspace != str(agent._settings.workspace_root)
    assert agent._workspaces == [str(agent._settings.workspace_root)]
    assert agent._static_tools == []
    # An approved run_command must not be denied by the SDK's default policy.
    assert [p.name for p in built._config.policies] == ["allow_all"]
    # The harness-call recorder runs before the approval hook and sees every call.
    from google.antigravity.hooks.hooks import PostToolCallHook, PreToolCallDecideHook

    decide = [h for h in built._pending_hooks if isinstance(h, PreToolCallDecideHook)]
    assert len(decide) >= 2
    assert decide[0].f.__name__ == "_guard"  # hard limits before anything else
    assert decide[1].f.__name__ == "_record_call"
    assert any(isinstance(h, PostToolCallHook) for h in built._pending_hooks)
    assert agent._harness_calls[_input().thread_id] is not None


def _finished() -> RunFinishedEvent:
    return RunFinishedEvent(type=EventType.RUN_FINISHED, thread_id=THREAD, run_id="run")


CLOSED = "ConnectionClosedOK: received 1000 (OK); then sent 1000 (OK)"


def _lost_then(
    agent: ThreadScopedAntigravityAgent,
    monkeypatch: pytest.MonkeyPatch,
    first: list[BaseEvent],
    second: list[BaseEvent],
) -> list[RunAgentInput]:
    """First adapter run marks the harness lost (as the adapter does), then fails."""
    calls: list[RunAgentInput] = []

    async def fake_run(
        self: AntigravityAgent, input_data: RunAgentInput
    ) -> AsyncIterator[BaseEvent]:
        calls.append(input_data)
        if len(calls) == 1:
            self._sessions._sessions[THREAD] = SimpleNamespace(
                harness_lost=True, conversation_id=None, agent=SimpleNamespace(conversation_id=None)
            )
            for event in first:
                yield event
        else:
            self._sessions._sessions.pop(THREAD, None)
            for event in second:
                yield event

    monkeypatch.setattr(AntigravityAgent, "run", fake_run)
    return calls


def _text(text: str) -> list[BaseEvent]:
    return [
        TextMessageStartEvent(type=EventType.TEXT_MESSAGE_START, message_id="m", role="assistant"),
        TextMessageContentEvent(type=EventType.TEXT_MESSAGE_CONTENT, message_id="m", delta=text),
        TextMessageEndEvent(type=EventType.TEXT_MESSAGE_END, message_id="m"),
    ]


async def test_a_closed_harness_connection_is_rebuilt_and_the_message_resent(
    agent: ThreadScopedAntigravityAgent, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = _lost_then(
        agent,
        monkeypatch,
        [_started(), RunErrorEvent(type=EventType.RUN_ERROR, message=CLOSED)],
        [_started(), *_text("Picked up where we left off."), _finished()],
    )
    events = await _collect(agent, _input())
    types = [e.type for e in events]
    assert len(calls) == 2
    assert EventType.RUN_ERROR not in types
    assert types.count(EventType.RUN_STARTED) == 1
    assert types[-1] == EventType.RUN_FINISHED
    assert EventType.TEXT_MESSAGE_CONTENT in types


async def test_no_retry_once_the_run_streamed_or_for_an_approval_answer(
    agent: ThreadScopedAntigravityAgent, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = _lost_then(
        agent,
        monkeypatch,
        [_started(), *_text("partial"), RunErrorEvent(type=EventType.RUN_ERROR, message=CLOSED)],
        [_finished()],
    )
    events = await _collect(agent, _input())
    assert len(calls) == 1
    assert events[-1].type == EventType.RUN_ERROR

    calls = _lost_then(
        agent,
        monkeypatch,
        [_started(), RunErrorEvent(type=EventType.RUN_ERROR, message=CLOSED)],
        [_finished()],
    )
    resumed = _input(
        resume=[ResumeEntry(interrupt_id="i9", status="resolved", payload={"approved": True})]
    )
    events = await _collect(agent, resumed)
    assert len(calls) == 1
    assert events[-1].type == EventType.RUN_ERROR


def test_compacting_the_session_db_keeps_rows_still_in_the_wal(
    agent: ThreadScopedAntigravityAgent, tmp_path: Path
) -> None:
    import sqlite3

    conv = "c" * 32
    save_dir = agent._settings.save_dir
    save_dir.mkdir(parents=True, exist_ok=True)
    live = sqlite3.connect(save_dir / f"{conv}.db")
    live.execute("PRAGMA journal_mode=WAL")
    live.execute("PRAGMA wal_autocheckpoint=0")
    live.execute("CREATE TABLE t (x TEXT)")
    live.execute("INSERT INTO t VALUES ('from the wal')")
    live.commit()
    assert (save_dir / f"{conv}.db-wal").exists()
    agent._sessions._sessions[THREAD] = SimpleNamespace(
        harness_lost=True, conversation_id=None, agent=SimpleNamespace(conversation_id=conv)
    )
    agent._compact_session_db(THREAD)
    live.close()
    assert (
        not (save_dir / f"{conv}.db-wal").exists()
        or (save_dir / f"{conv}.db-wal").stat().st_size == 0
    )
    # Read the way the harness reopens it: immutable, so the WAL is ignored.
    uri = f"file:{save_dir / f'{conv}.db'}?immutable=1"
    rows = sqlite3.connect(uri, uri=True).execute("SELECT x FROM t").fetchall()
    assert rows == [("from the wal",)]
