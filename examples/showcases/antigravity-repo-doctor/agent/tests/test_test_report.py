from pathlib import Path

import pytest

from repo_doctor.a2ui import CATALOG_ID, report_surface_operations
from repo_doctor.test_report import parse_console_summary, parse_junit, report_from_output

FIXTURES = Path(__file__).parent / "fixtures"


def _parse(name: str, exit_code: int):
    xml = (FIXTURES / name).read_text(encoding="utf-8")
    return parse_junit(xml, command="pytest", exit_code=exit_code, duration=9.9)


def test_red_run_counts_and_groups_failures_by_file() -> None:
    report = _parse("junit_red.xml", exit_code=1)

    assert report.status == "failed"
    assert (report.passed, report.failed, report.errors, report.total) == (174, 8, 0, 182)
    assert report.headline() == "8 of 182 tests fail"
    assert report.files[0].path == "tests/test_cli_operation.py"
    assert report.files[0].failed == 6
    assert sum(f.passed + f.failed for f in report.files) == 182


def test_red_run_keeps_messages_and_first_traceback() -> None:
    report = _parse("junit_red.xml", exit_code=1)

    first = report.failures[0]
    assert first.id == "tests/test_cli_operation.py::TestCLIOperation::test_move_on_move_command"
    assert first.message.startswith("TypeError: move_items() got multiple values")
    assert "plugin_fixture.py" in report.first_traceback


def test_green_run() -> None:
    report = _parse("junit_green.xml", exit_code=0)

    assert report.status == "passed"
    assert report.headline() == "All 182 tests pass"
    assert report.failures == []
    assert report.first_traceback == ""


@pytest.mark.parametrize(
    ("output", "counts"),
    [
        ("Tests:       1 failed, 2 skipped, 45 passed, 48 total\n", (45, 1, 2)),
        (
            " Test Files  1 failed | 4 passed (5)\n      Tests  3 failed | 45 passed (48)\n",
            (45, 3, 0),
        ),
        ("....\nRan 48 tests in 0.101s\n\nFAILED (failures=1, errors=2, skipped=3)\n", (42, 3, 3)),
        ("Ran 5 tests in 0.010s\n\nOK\n", (5, 0, 0)),
        ("== 3 failed, 45 passed, 2 skipped in 1.20s ==\n", (45, 3, 2)),
        (
            "test result: ok. 10 passed; 0 failed; 1 ignored; 0 measured\n"
            "test result: FAILED. 4 passed; 2 failed; 0 ignored; 0 measured\n",
            (14, 2, 1),
        ),
        ("# tests 12\n# pass 11\n# fail 1\n# skipped 0\n", (11, 1, 0)),
        ("  45 passing (2s)\n  2 failing\n  1 pending\n", (45, 2, 1)),
        ("  12 tests passed\n  1 test failed\n", (12, 1, 0)),
        (
            "--- FAIL: TestParse (0.00s)\nFAIL\texample.com/x/parse\t0.01s\n"
            "ok  \texample.com/x/util\t0.02s\n",
            (1, 1, 0),
        ),
        ("\x1b[32m  45 passing\x1b[0m (2s)\n", (45, 0, 0)),
        ("compiled successfully\n", None),
    ],
)
def test_console_summaries(output: str, counts: tuple[int, int, int] | None) -> None:
    assert parse_console_summary(output) == counts


def test_unknown_runner_shows_the_end_of_its_output() -> None:
    output = "\n".join(f"line {i}" for i in range(40)) + "\nsomething broke\n"

    failed = report_from_output(command="make test", exit_code=2, duration=2.0, output=output)
    passed = report_from_output(command="make test", exit_code=0, duration=2.0, output="done\n")

    assert failed.status == "failed"
    assert failed.headline() == "Tests fail"
    assert failed.summary.endswith("something broke")
    assert len(failed.summary.splitlines()) == 12
    assert passed.headline() == "Tests pass"


def test_failing_names_are_picked_up() -> None:
    output = "--- FAIL: TestParse (0.00s)\nFAIL\texample.com/x\t0.01s\n"

    report = report_from_output(command="go test ./...", exit_code=1, duration=1.0, output=output)

    assert [f.id for f in report.failures] == ["TestParse"]
    assert report.headline() == "1 of 1 tests fail"


def test_no_tests() -> None:
    report = report_from_output(
        command="pytest", exit_code=5, duration=0.4, output="no tests ran\n", no_tests=True
    )

    assert report.status == "error"
    assert report.headline() == "No tests were found"


def test_surface_operations_bind_every_prop_to_the_data_model() -> None:
    report = report_from_output(
        command="npm test", exit_code=1, duration=1.0, output="  3 passing\n  1 failing\n"
    )

    create, components, data = report_surface_operations(report, run=2)

    assert create["createSurface"] == {"surfaceId": "test-run-2", "catalogId": CATALOG_ID}
    root = components["updateComponents"]["components"][0]
    assert root["component"] == "TestReport"
    assert root["summary"] == {"path": "/summary"}
    value = data["updateDataModel"]["value"]
    assert (value["run"], value["status"], value["passed"], value["failed"]) == (2, "failed", 3, 1)
    assert value["summary"] == "  3 passing\n  1 failing"
