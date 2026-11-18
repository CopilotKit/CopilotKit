"""Turns a test run into a structured report.

pytest writes a JUnit XML report next to the run, and that file is the source
of truth: console output is unreliable to parse (plugins print captured logs
for every test, which can run to megabytes). Other runners are read from the
summary lines they print (unittest, jest, vitest, mocha, ava, node:test, uvu,
go test, cargo test). When none matches, the run is judged by its exit code and
the card shows the last lines of the output as they are.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Literal

Status = Literal["passed", "failed", "error"]

# Shown to the model and in the report card. Enough to identify the cause.
MAX_FAILURES = 12
MAX_MESSAGE_CHARS = 300
MAX_TRACEBACK_CHARS = 4_000
# The raw end of the output, shown when nothing finer could be parsed.
SUMMARY_LINES = 12
SUMMARY_CHARS = 1_500


@dataclass(frozen=True)
class FailedTest:
    id: str
    message: str


@dataclass(frozen=True)
class FileResult:
    path: str
    passed: int
    failed: int


@dataclass
class TestReport:
    status: Status
    command: str
    passed: int = 0
    failed: int = 0
    errors: int = 0
    skipped: int = 0
    duration_seconds: float = 0.0
    files: list[FileResult] = field(default_factory=list)
    failures: list[FailedTest] = field(default_factory=list)
    # The first failure's traceback, which is usually enough to find the cause.
    first_traceback: str = ""
    # The last lines of the console output, for runners without a parsed report.
    summary: str = ""
    # No test was collected or run at all.
    no_tests: bool = False

    @property
    def total(self) -> int:
        return self.passed + self.failed + self.errors + self.skipped

    def headline(self) -> str:
        if self.no_tests:
            return "No tests were found"
        if self.status == "error":
            return "The test run could not start"
        if self.total == 0:
            return "Tests pass" if self.status == "passed" else "Tests fail"
        if self.status == "passed":
            return f"All {self.passed} tests pass"
        return f"{self.failed + self.errors} of {self.total} tests fail"


def _test_id(case: ET.Element) -> str:
    path = case.get("file") or case.get("classname", "").replace(".", "/") + ".py"
    classname = case.get("classname", "")
    cls = classname.rsplit(".", 1)[-1] if classname else ""
    module_cls = path.removesuffix(".py").replace("/", ".")
    parts = [path]
    if cls and classname != module_cls:
        parts.append(cls)
    parts.append(case.get("name", "?"))
    return "::".join(parts)


def parse_junit(xml_text: str, *, command: str, exit_code: int, duration: float) -> TestReport:
    """Builds a report from a pytest JUnit XML file (junit_family=xunit1)."""
    root = ET.fromstring(xml_text)
    per_file: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    failures: list[FailedTest] = []
    first_traceback = ""
    counts = {"passed": 0, "failed": 0, "error": 0, "skipped": 0}
    seconds = 0.0

    for suite in root.iter("testsuite"):
        seconds += float(suite.get("time", "0") or 0)
    for case in root.iter("testcase"):
        test_id = _test_id(case)
        bucket = per_file[test_id.split("::", 1)[0]]
        problem = case.find("failure")
        kind = "failed"
        if problem is None:
            problem = case.find("error")
            kind = "error"
        if problem is not None:
            counts[kind] += 1
            bucket[1] += 1
            message = (problem.get("message") or "").strip().splitlines()
            failures.append(
                FailedTest(id=test_id, message=(message[0] if message else "")[:MAX_MESSAGE_CHARS])
            )
            if not first_traceback:
                first_traceback = (problem.text or "").strip()[-MAX_TRACEBACK_CHARS:]
        elif case.find("skipped") is not None:
            counts["skipped"] += 1
        else:
            counts["passed"] += 1
            bucket[0] += 1

    if exit_code == 0:
        status: Status = "passed"
    elif counts["failed"] or counts["error"]:
        status = "failed"
    else:
        status = "error"

    return TestReport(
        status=status,
        command=command,
        passed=counts["passed"],
        failed=counts["failed"],
        errors=counts["error"],
        skipped=counts["skipped"],
        duration_seconds=round(seconds or duration, 2),
        files=sorted(
            (FileResult(path=p, passed=c[0], failed=c[1]) for p, c in per_file.items()),
            key=lambda f: (-f.failed, f.path),
        ),
        failures=failures[:MAX_FAILURES],
        first_traceback=first_traceback,
    )


def report_from_exit_code(*, command: str, exit_code: int, duration: float) -> TestReport:
    """For runs without a report: pass or fail, nothing finer."""
    return TestReport(
        status="passed" if exit_code == 0 else "failed",
        command=command,
        duration_seconds=round(duration, 2),
    )


_ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")


def _count(pattern: str, text: str) -> int:
    """Sum of every match of a one-group numeric pattern (multi-package runs print several)."""
    return sum(int(m) for m in re.findall(pattern, text, re.MULTILINE))


def _last(pattern: str, text: str) -> int | None:
    found = re.findall(pattern, text, re.MULTILINE)
    return int(found[-1]) if found else None


def _word(line: str, word: str) -> int:
    """The number before `word` in a summary line, or 0."""
    match = re.search(rf"(\d+) {word}", line)
    return int(match.group(1)) if match else 0


def parse_console_summary(output: str) -> tuple[int, int, int] | None:
    """(passed, failed, skipped) from the summary a known runner prints, else None."""
    text = _ANSI.sub("", output)

    # cargo test: one "test result:" line per test binary.
    if re.search(r"^test result: ", text, re.MULTILINE):
        return (
            _count(r"^test result: .*?(\d+) passed", text),
            _count(r"^test result: .*?(\d+) failed", text),
            _count(r"^test result: .*?(\d+) ignored", text),
        )
    # jest: "Tests:       1 failed, 2 skipped, 45 passed, 48 total"
    jest = re.findall(r"^Tests:\s+(.*\d+ total)", text, re.MULTILINE)
    if jest:
        line = jest[-1]
        return (_word(line, "passed"), _word(line, "failed"), _word(line, "(?:skipped|todo)"))
    # vitest: " Tests  3 failed | 45 passed | 1 skipped (49)"
    vitest = re.findall(r"^\s*Tests\s+(.*\(\d+\))\s*$", text, re.MULTILINE)
    if vitest:
        line = vitest[-1]
        return (_word(line, "passed"), _word(line, "failed"), _word(line, "(?:skipped|todo)"))
    # unittest: "Ran 48 tests in 0.1s" then "OK (skipped=3)" or "FAILED (failures=1, errors=2)"
    ran = _last(r"^Ran (\d+) tests? in", text)
    if ran is not None:
        failed = (_last(r"^FAILED \(.*?failures=(\d+)", text) or 0) + (
            _last(r"^FAILED \(.*?errors=(\d+)", text) or 0
        )
        skipped = _last(r"^(?:OK|FAILED) \(.*?skipped=(\d+)", text) or 0
        return (max(ran - failed - skipped, 0), failed, skipped)
    # pytest without a report: "== 3 failed, 45 passed, 2 skipped in 1.2s =="
    pytest_line = re.findall(
        r"^=+ (.*\d+ (?:passed|failed|error).*) in [\d.]+s", text, re.MULTILINE
    )
    if pytest_line:
        line = pytest_line[-1]
        return (
            _word(line, "passed"),
            _word(line, "failed") + _word(line, "errors?"),
            _word(line, "skipped"),
        )
    # node:test (TAP): "# pass 10" / "# fail 0" / "# skipped 1"
    if re.search(r"^# pass \d+", text, re.MULTILINE):
        return (
            _last(r"^# pass (\d+)", text) or 0,
            _last(r"^# fail (\d+)", text) or 0,
            (_last(r"^# skip(?:ped)? (\d+)", text) or 0) + (_last(r"^# todo (\d+)", text) or 0),
        )
    # mocha: "45 passing (2s)" / "2 failing" / "1 pending"
    passing = _last(r"^\s*(\d+) passing", text)
    if passing is not None:
        return (
            passing,
            _last(r"^\s*(\d+) failing", text) or 0,
            _last(r"^\s*(\d+) pending", text) or 0,
        )
    # ava: "45 tests passed" / "2 tests failed" / "1 test skipped"
    ava = _last(r"^\s*(\d+) tests? passed", text)
    if ava is not None:
        return (
            ava,
            _last(r"^\s*(\d+) tests? failed", text) or 0,
            _last(r"^\s*(\d+) tests? skipped", text) or 0,
        )
    # uvu: "Total: 45" / "Passed: 45" / "Skipped: 0"
    total = _last(r"^\s*Total:\s+(\d+)", text)
    if total is not None and re.search(r"^\s*Passed:\s+\d+", text, re.MULTILINE):
        passed = _last(r"^\s*Passed:\s+(\d+)", text) or 0
        skipped = _last(r"^\s*Skipped:\s+(\d+)", text) or 0
        return (passed, max(total - passed - skipped, 0), skipped)
    # go test: count failing tests; packages that pass print "ok".
    if re.search(r"^(?:ok|FAIL|---) ", text, re.MULTILINE) and re.search(
        r"^(?:ok|FAIL)\s+\S+", text, re.MULTILINE
    ):
        return (
            len(re.findall(r"^ok\s+\S+", text, re.MULTILINE)),
            len(re.findall(r"^\s*--- FAIL: ", text, re.MULTILINE)),
            0,
        )
    return None


def _failure_names(text: str) -> list[FailedTest]:
    """Failing test names a runner prints, best effort."""
    names: list[str] = []
    names += re.findall(r"^\s*--- FAIL: (\S+)", text, re.MULTILINE)  # go
    names += re.findall(r"^---- (\S+) stdout ----", text, re.MULTILINE)  # cargo
    names += re.findall(r"^(?:FAIL|ERROR): (\S+ \([^)]*\))", text, re.MULTILINE)  # unittest
    names += re.findall(r"^\s*● (.+?)\s*$", text, re.MULTILINE)  # jest
    names += re.findall(r"^\s*(?:\u00d7|\u2717)\s+(\S.*?)\s*$", text, re.MULTILINE)  # vitest
    names += re.findall(r"^\s*FAIL\s+(\S+ > .+?)\s*$", text, re.MULTILINE)  # vitest
    seen: dict[str, None] = {}
    for name in names:
        seen.setdefault(name.strip()[:MAX_MESSAGE_CHARS], None)
    return [FailedTest(id=name, message="") for name in list(seen)[:MAX_FAILURES]]


def tail(output: str) -> str:
    lines = [line for line in _ANSI.sub("", output).rstrip().splitlines() if line.strip()]
    return "\n".join(lines[-SUMMARY_LINES:])[-SUMMARY_CHARS:]


def report_from_output(
    *, command: str, exit_code: int, duration: float, output: str, no_tests: bool = False
) -> TestReport:
    """For runners without a report file: counts from the printed summary when
    a known runner printed one, and the raw end of the output either way."""
    counts = parse_console_summary(output)
    text = _ANSI.sub("", output)
    passed, failed, skipped = counts or (0, 0, 0)
    if exit_code == 0:
        status: Status = "passed"
    elif failed or counts is None:
        status = "failed"
    else:
        status = "error"
    return TestReport(
        status="error" if no_tests else status,
        command=command,
        passed=passed,
        failed=failed,
        skipped=skipped,
        duration_seconds=round(duration, 2),
        failures=_failure_names(text) if exit_code != 0 else [],
        summary=tail(output),
        no_tests=no_tests,
    )
