"""Bounded, offline CI audit; never modifies the checkout being audited."""

import ctypes
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[3]
HARNESS = Path("showcase/harness")
SOURCE = HARNESS / "src/probes/helpers/browser-pool.ts"
TEST = "src/probes/helpers/browser-pool-signals.test.ts"
OPTIONS = "leaves harness drain and reload signals to the harness on real launches"
SIGNALS = ("SIGTERM", "SIGINT", "SIGHUP")
REAL = {s: f"keeps active work usable through {s} until pool shutdown" for s in SIGNALS}
ENV = dict(
    os.environ, NX_DAEMON="false", NX_NO_CLOUD="true", NX_TUI="false", NO_COLOR="1"
)


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def stop_children():
    """Linux subreaper owns adopted descendants too, including detached Chromium."""

    def identity(pid):
        try:
            # /proc stat comm may contain spaces and parentheses.
            fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
            return int(fields[1]), fields[19]  # ppid, kernel start ticks
        except (FileNotFoundError, ProcessLookupError):
            return None

    owned = {}
    while True:
        processes = {
            int(item.name): identity(int(item.name))
            for item in Path("/proc").iterdir()
            if item.name.isdecimal()
        }
        family = {os.getpid()}
        while True:
            descendants = {
                pid for pid, info in processes.items() if info and info[0] in family
            }
            if descendants <= family:
                break
            family |= descendants
        discovered = {pid: processes[pid][1] for pid in family - {os.getpid()}}
        fresh = {
            pid: ticks for pid, ticks in discovered.items() if owned.get(pid) != ticks
        }
        if not fresh:
            break
        owned.update(fresh)
        # Freeze and rescan: include children created during the previous scan.
        for pid, ticks in fresh.items():
            info = identity(pid)
            if info and info[1] == ticks:
                try:
                    os.kill(pid, signal.SIGSTOP)
                except ProcessLookupError:
                    pass
    for pid, ticks in owned.items():
        info = identity(pid)
        if info and info[1] == ticks:  # never signal a reused PID
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
    while True:
        try:
            os.waitpid(-1, 0)
        except ChildProcessError:
            break


class Audit:
    def __init__(self, logs):
        self.logs = logs
        self.sequence = 0
        self.results = []

    def run(self, args, cwd=ROOT, timeout=30, checked=True):
        self.sequence += 1
        log = self.logs / f"{self.sequence:02d}-command.log"
        print(
            "AUDIT_COMMAND",
            json.dumps({"argv": args, "cwd": str(cwd), "timeoutSeconds": timeout}),
            flush=True,
        )
        with log.open("w") as output:
            output.write(f"$ {shlex.join(args)}\ncwd={cwd}\n")
            output.flush()
            child = subprocess.Popen(
                args,
                cwd=cwd,
                env=ENV,
                stdout=output,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            try:
                code = child.wait(timeout=timeout)
            except subprocess.TimeoutExpired as error:
                stop_children()
                child.wait()
                raise RuntimeError(
                    f"SETUP/TIMEOUT: {args} exceeded {timeout}s; never a mutant kill"
                ) from error
            finally:
                # Reap any orphaned fixture/browser children before the next variant.
                stop_children()
                print(log.read_text(), flush=True)
        if checked:
            require(code == 0, f"SETUP: command exited {code}: {args}")
        # Strip only our command header; preserve command output in its entirety.
        return code, log.read_text().split("\n", 2)[2]

    def git(self, *args, cwd=ROOT):
        return self.run(["git", *args], cwd=cwd)[1].strip()

    def assess(self, case, report, code, output):
        require(report.is_file(), f"{case}: missing JSON report (setup failure)")
        data = json.loads(report.read_text())
        require(
            data.get("numTotalTests") == 4, f"{case}: must collect exactly four tests"
        )
        require(
            data.get("numPendingTests") == 0 and data.get("numTodoTests") == 0,
            f"{case}: skipped/pending tests",
        )
        files = data.get("testResults", [])
        require(
            len(files) == 1 and Path(files[0]["name"]).as_posix().endswith("/" + TEST),
            f"{case}: unexpected test file",
        )
        require(not files[0].get("message"), f"{case}: suite setup/framework failure")
        assertions = files[0].get("assertionResults", [])
        require(len(assertions) == 4, f"{case}: missing/duplicate assertions")
        by_title = {a["title"]: a for a in assertions}
        require(
            set(by_title) == {OPTIONS, *REAL.values()}, f"{case}: test names changed"
        )
        diagnostics = "\n".join(
            "\n".join(a.get("failureMessages", [])) for a in assertions
        )
        # Vitest JSON's success field omits onFinished framework errors; inspect
        # verbose output as well. A framework failure is never a behavioral kill.
        forbidden = r"Unhandled (?:Error|Rejection|Exception)|Uncaught Exception|Errors? during|Failed to (?:load|resolve)|Transform failed|Cannot find (?:module|package)|ERR_MODULE_NOT_FOUND|deadline exceeded|timed out|TimeoutError|\(retry|Retry #"
        require(
            not re.search(forbidden, output + "\n" + diagnostics, re.I),
            f"{case}: setup/unhandled/timeout/retry diagnostic",
        )
        failed = set()
        for title, assertion in by_title.items():
            require(
                assertion["status"] in ("passed", "failed"),
                f"{case}: nonterminal result",
            )
            if assertion["status"] == "failed":
                failed.add(title)
            else:
                require(
                    not assertion.get("failureMessages"),
                    f"{case}: passing assertion has errors",
                )
        if case == "control":
            require(
                code == 0 and data.get("success") is True and not failed,
                "unchanged control must pass all four tests",
            )
        else:
            require(
                code == 1 and data.get("success") is False,
                f"{case}: abnormal exit or mutant survived",
            )
            expected = (
                set(REAL.values()) if case == "shutdown-noop" else {OPTIONS, REAL[case]}
            )
            require(
                failed == expected,
                f"{case}: unexpected failing tests: {sorted(failed)}",
            )
            selected = SIGNALS if case == "shutdown-noop" else (case,)
            for sig in selected:
                message = "\n".join(by_title[REAL[sig]].get("failureMessages", []))
                start = "reload-start" if sig == "SIGHUP" else "drain-start"
                require(
                    f"ready -> {start}" in message and "AssertionError" in message,
                    f"{case}/{sig}: no real post-ready assertion diagnostic",
                )
                if case == "shutdown-noop":
                    done = "reload-survived" if sig == "SIGHUP" else "work-reported"
                    require(
                        f"{start} -> {done} -> pool-shutdown -> error:" in message,
                        f"{case}/{sig}: no completed-work markers",
                    )
                    require(
                        "pool shutdown must close the active context" in message,
                        f"{case}/{sig}: wrong shutdown assertion",
                    )
                else:
                    closed = re.search(
                        r"(?:Target page, context or browser|Browser|browserContext|page).*?(?:closed|terminated)",
                        message,
                        re.I,
                    )
                    premature = (
                        "error:" not in message
                        and re.search(r"(?:code|signal):", message)
                        and re.search(
                            r"[+-].*(?:0|null|SIGTERM|SIGINT|SIGHUP)", message
                        )
                    )
                    require(
                        closed or premature,
                        f"{case}/{sig}: no browser-close or premature-exit evidence",
                    )
        require(
            data.get("numFailedTests") == len(failed)
            and data.get("numPassedTests") == 4 - len(failed),
            f"{case}: inconsistent counts",
        )
        result = {
            "case": case,
            "verdict": "PASS",
            "exitCode": code,
            "assertions": [
                {"title": a["title"], "status": a["status"]} for a in assertions
            ],
        }
        self.results.append(result)
        print("VARIANT_VERDICT", json.dumps(result), flush=True)


def main():
    require(
        sys.platform == "linux" and os.environ.get("CI") == "true",
        "audit requires provisioned Linux CI",
    )
    require(os.environ.get("RUNNER_TEMP"), "RUNNER_TEMP is required")
    # Adopt double-forked browser/worker children so bounded cleanup can reap them.
    require(
        ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) == 0,
        "could not enable child subreaper",
    )
    temp = Path(os.environ["RUNNER_TEMP"]).resolve()
    logs = Path(tempfile.mkdtemp(prefix="signal-boundary-logs-", dir=temp))
    scratch_root = Path(tempfile.mkdtemp(prefix="signal-boundary-worktrees-", dir=temp))
    audit = Audit(logs)
    scratch = None
    primary_source = (ROOT / SOURCE).read_bytes()
    outcome = "FAIL"
    try:
        head = audit.git("rev-parse", "HEAD")
        parents = audit.git("show", "-s", "--format=%P", "HEAD")
        audit.git("diff", "--exit-code", "HEAD", "--")
        event = (
            json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
            if os.environ.get("GITHUB_EVENT_PATH")
            else {}
        )
        print(
            "CHECKOUT_METADATA",
            json.dumps(
                {
                    "head": head,
                    "parents": parents.split(),
                    "prHeadEventSha": event.get("pull_request", {})
                    .get("head", {})
                    .get("sha"),
                    "githubSha": os.environ.get("GITHUB_SHA"),
                    "logs": str(logs),
                }
            ),
            flush=True,
        )
        resolver = "const {createRequire}=require('node:module'); const r=createRequire(process.argv[1]); console.log(r.resolve('tsx'));"
        _, loader = audit.run(
            ["node", "-e", resolver, str(ROOT / HARNESS / "package.json")]
        )
        loader = loader.strip()
        require(Path(loader).is_file(), "installed tsx loader missing")
        audit.run(
            [
                "node",
                "--import",
                loader,
                str(ROOT / HARNESS / "scripts/signal-boundary-contract.mjs"),
            ],
            timeout=60,
        )
        original = primary_source.decode()
        variants = [("control", original)]
        for sig in SIGNALS:
            before = f"handle{sig}: false,"
            require(original.count(before) == 1, f"ambiguous {sig} mutation seam")
            variants.append((sig, original.replace(before, f"handle{sig}: true,", 1)))
        entry = "  async shutdown(): Promise<void> {\n"
        require(original.count(entry) == 1, "ambiguous shutdown seam")
        variants.append(
            (
                "shutdown-noop",
                original.replace(
                    entry,
                    entry + "    return; // signal-boundary scratch mutation\n",
                    1,
                ),
            )
        )
        for case, changed in variants:
            scratch = scratch_root / case
            audit.git("worktree", "add", "--detach", str(scratch), head)
            try:
                require(
                    audit.git("rev-parse", "HEAD", cwd=scratch) == head,
                    "scratch HEAD differs",
                )
                for dependency in (Path("node_modules"), HARNESS / "node_modules"):
                    provisioned = ROOT / dependency
                    require(
                        provisioned.is_dir(),
                        f"missing provisioned dependencies: {provisioned}",
                    )
                    (scratch / dependency).symlink_to(
                        provisioned.resolve(), target_is_directory=True
                    )
                if case != "control":
                    (scratch / SOURCE).write_text(changed)
                changed_files = audit.git(
                    "diff", "--name-only", "HEAD", cwd=scratch
                ).splitlines()
                require(
                    changed_files == ([] if case == "control" else [str(SOURCE)]),
                    f"{case}: mutation exceeded source seam",
                )
                require(
                    (scratch / SOURCE).read_text() == changed,
                    f"{case}: wrong mutation bytes",
                )
                require(
                    not audit.git(
                        "ls-files", "--others", "--exclude-standard", cwd=scratch
                    ),
                    f"{case}: unexpected untracked files",
                )
                delta = audit.git(
                    "diff", "--no-ext-diff", "HEAD", "--", str(SOURCE), cwd=scratch
                )
                (logs / f"{case}.diff").write_text(delta + "\n")
                report = logs / f"{case}.json"
                command = [
                    "pnpm",
                    "exec",
                    "nx",
                    "run",
                    "@copilotkit/showcase-harness:test:signal-boundary:case",
                    "--skip-nx-cache",
                    f"--outputFile.json={report}",
                ]
                code, output = audit.run(
                    command, cwd=scratch, timeout=90, checked=False
                )
                audit.assess(case, report, code, output)
            except BaseException as error:
                audit.results.append(
                    {"case": case, "verdict": "FAIL", "reason": str(error)}
                )
                raise
            finally:
                stop_children()
                # Raw reports and mutation diffs survive outside the scratch tree.
                for diagnostic in (logs / f"{case}.diff", logs / f"{case}.json"):
                    if diagnostic.exists():
                        print(
                            f"AUDIT_DIAGNOSTIC {diagnostic}\n{diagnostic.read_text()}",
                            flush=True,
                        )
                audit.git("worktree", "remove", "--force", str(scratch))
                scratch = None
        require(len(audit.results) == 5, "missing variant")
        require(
            (ROOT / SOURCE).read_bytes() == primary_source, "primary source was changed"
        )
        audit.git("diff", "--exit-code", "HEAD", "--")
        outcome = "PASS"
    finally:
        try:
            stop_children()
            # Includes partial setup; never prune/remove someone else's tree.
            if scratch is not None and scratch.exists():
                audit.git("worktree", "remove", "--force", str(scratch))
            shutil.rmtree(scratch_root)
        except BaseException:
            outcome = "FAIL"
            raise
        finally:
            final = {"verdict": outcome, "variants": audit.results, "logs": str(logs)}
            (logs / "verdict.json").write_text(json.dumps(final, indent=2) + "\n")
            print("SIGNAL_BOUNDARY_VERDICT", json.dumps(final), flush=True)


def interrupted(signum, _frame):
    raise RuntimeError(f"audit interrupted by signal {signum}; not a behavioral kill")


if __name__ == "__main__":
    for handled in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(handled, interrupted)
    main()
