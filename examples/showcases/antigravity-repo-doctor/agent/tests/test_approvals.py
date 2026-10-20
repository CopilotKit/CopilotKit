from ag_ui.core import Interrupt, ResumeEntry

from repo_doctor.approvals import ApprovalLog, summarize_call


def _interrupt(id_: str, tool: str, args: dict, reason: str = "tool_approval") -> Interrupt:
    return Interrupt(id=id_, reason=reason, metadata={"tool_name": tool, "args": args})


def test_summaries() -> None:
    assert summarize_call("run_command", {"CommandLine": "pip install x"}, "k") == "pip install x"
    assert (
        summarize_call("run_check", {"command": "python bench.py", "label": "b"}, "k")
        == "python bench.py"
    )
    assert (
        summarize_call("edit_file", {"TargetFile": "/private/tmp/rd/ws/k/tests/a.py"}, "k")
        == "tests/a.py"
    )
    assert summarize_call("git_push", {"branch": "fix/x"}, "k") == "fix/x"
    assert (
        summarize_call("manage_task", {"Action": "kill", "TaskId": "abc123/task-44"}, "k")
        == "kill task-44"
    )


def test_decisions_are_matched_to_the_interrupts_they_answer() -> None:
    log = ApprovalLog()
    log.remember(
        "t1",
        [
            _interrupt("a", "install_dependencies", {"command": "uv pip install -e ."}),
            _interrupt("q", "ask", {}, reason="ask_question"),
        ],
        "k",
    )

    records = log.decide(
        "t1",
        [
            ResumeEntry(interrupt_id="a", status="resolved", payload={"approved": True}),
            ResumeEntry(interrupt_id="unknown", status="resolved", payload={"approved": True}),
        ],
    )

    assert len(records) == 1
    assert records[0]["tool"] == "install_dependencies"
    assert records[0]["decision"] == "approved"
    assert records[0]["summary"] == "uv pip install -e ."


def test_denied_cancelled_and_malformed_answers_count_as_denied() -> None:
    log = ApprovalLog()
    log.remember("t1", [_interrupt(i, "git_push", {"branch": "b"}) for i in "abc"], "k")

    records = log.decide(
        "t1",
        [
            ResumeEntry(
                interrupt_id="a",
                status="resolved",
                payload={"approved": False, "message": "not yet"},
            ),
            ResumeEntry(interrupt_id="b", status="cancelled"),
            ResumeEntry(interrupt_id="c", status="resolved", payload="yes"),
        ],
    )

    assert [r["decision"] for r in records] == ["denied", "denied", "denied"]
    assert records[0]["note"] == "not yet"


def test_an_answer_is_logged_once() -> None:
    log = ApprovalLog()
    log.remember("t1", [_interrupt("a", "git_push", {"branch": "b"})], "k")
    answer = [ResumeEntry(interrupt_id="a", status="resolved", payload={"approved": True})]

    assert len(log.decide("t1", answer)) == 1
    assert log.decide("t1", answer) == []


def test_auto_approvals_are_noted() -> None:
    log = ApprovalLog()
    log.remember("t1", [_interrupt("a", "run_command", {"CommandLine": "ls"})], "k")

    (record,) = log.decide(
        "t1",
        [
            ResumeEntry(
                interrupt_id="a", status="resolved", payload={"approved": True, "auto": True}
            )
        ],
    )

    assert record["decision"] == "approved"
    assert record["note"] == "auto"
