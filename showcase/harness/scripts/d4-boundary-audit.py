"""Finite offline D4 audit. Authoring is static-only; execution is CI-only.

The outer Nx target has no build dependencies. Nested Vitest invocations are
intentionally bounded to this corpus or sixteen named regression cases.
Artifacts survive scratch cleanup and are printed in full to the CI log.
"""

import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
from pathlib import Path

BASE = "ac417d57f4abcaece2f279713285104afe8d7514"
RECORDED_BASE = "89629de0a26cb0965399c033894a2eed9bee52a2"
# Historical genuine timing RED; its evidence remains separate from this audit.
TIMING_RECORDED_BASE = "21eadbded84b050d9704648ec086e708daec72ed"
TIMING_RECORDED_SOURCE = "1145d25e2427faca66ae1733e26a7d13f53533c0"
HARNESS = Path(__file__).resolve().parents[1]
ROOT = HARNESS.parents[1]
SOURCE = "showcase/harness/src/probes/drivers/d4-chat-roundtrip.ts"
OLD_TEST = "src/probes/drivers/d4-chat-roundtrip.test.ts"
ASYNC_TEST = "src/probes/drivers/d4-request-failed-async-consumer.test.ts"
TIMING_TEST = "src/probes/drivers/d4-request-failed-timing.test.ts"
CORPUS = "src/probes/drivers/d4-request-failed-boundary.test.ts"
IMMUTABLE = {
    SOURCE: "daab55752fadc64a3d73e9f7a8a3c8e5c2cf0d6d",
    f"showcase/harness/{OLD_TEST}": "6c6ddf71e232ad6d1ca650b7704a1329f09c1839",
    f"showcase/harness/{ASYNC_TEST}": "207c4f0c566dbf102937da9f5d46de55d7774c70",
    f"showcase/harness/{TIMING_TEST}": "ab7e251cae2b81cdfacb953f14e24abe2599be60",
    "showcase/harness/test/fixtures/d4-request-failed/strict.ts": "bd1b60fbd320a967df4e47b112d4b0f7df3ab4a9",
    "showcase/harness/test/fixtures/d4-request-failed/async-consumer.ts": "37636e9ae8dfff3f26c13e0efb980938c3761e5d",
}
DIAGNOSTICS = "wirePlaywrightPage failed-request diagnostics"
FIFO = "FIX A: a responseless request that ABORTS does not leak a queue entry that mis-pairs a later same-URL response"
ASYNC = "D4 async diagnostic consumer containment"
TIMING = "D4 installed Playwright failed-request timing eviction"
TIMING_DOUBLE_EVICTION = "preserves B duration 50 after A response then requestfailed without double eviction"
TIMING_RESPONSELESS = "evicts a responseless failure synchronously while its response lookup remains pending"
PATTERN = (
    f"{re.escape(DIAGNOSTICS)}|{re.escape(FIFO)}|{re.escape(ASYNC)}|{re.escape(TIMING)}"
)
TITLES = {
    "delivers one diagnostic when the Playwright response Promise resolves null",
    "retains the request diagnostic for resolved status",
    "retains the request diagnostic for synchronous response throw",
    "retains the request diagnostic for status accessor throw",
    "uses unknown when failure is null",
    "uses unknown when failure is undefined",
    "retains captured URL and error when response lookup rejects after dispatch",
    "keeps independent requests associated when responses settle in reverse order",
    "contains a throwing diagnostic consumer",
    "does not crash on malformed event accessors",
    "survives delayed rejection and a throwing consumer under strict Node rejection handling",
    FIFO,
    "survives an async fulfilled consumer under strict Node rejection handling",
    "survives an async rejecting consumer under strict Node rejection handling",
    TIMING_DOUBLE_EVICTION,
    TIMING_RESPONSELESS,
}
VARIANTS = (
    "control",
    "baseline-hunk",
    "no-response-await",
    "no-iife-catch",
    "capture-after-await",
    "drop-rejected-lookup",
    "force-null-status",
    "no-fifo-eviction",
    "no-callback-await",
    "no-responded-request-guard",
)
# Exact production-only block at recorded 89629de0. Tests and loader never revert.
BASELINE_HUNK = """    onRequestFailed(handler) {
      page.on("requestfailed", (arg) => {
        try {
          const req = arg as {
            url(): string;
            failure(): { errorText: string } | null;
            response(): { status(): number } | null;
          };
          const resp = req.response?.();
          handler({
            url: req.url(),
            errorClass: req.failure()?.errorText ?? "unknown",
            responseStatus: resp ? resp.status() : null,
          });
        } catch {
          /* ignore */
        }
      });
    },
"""
ENV = {
    **os.environ,
    "NX_DAEMON": "false",
    "NX_NO_CLOUD": "true",
    "NX_TUI": "false",
    "NO_COLOR": "1",
    "FORCE_COLOR": "0",
}
OWNED = set()


class AuditFailure(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise AuditFailure(message)


def emit(label, value):
    print(f"D4_AUDIT {label} {json.dumps(value, ensure_ascii=False)}", flush=True)


def run(command, cwd, seconds, artifact=None):
    """Kill only this invocation's owned process group, then reap its leader."""
    emit(
        "command",
        {"argv": [str(x) for x in command], "cwd": str(cwd), "seconds": seconds},
    )
    process = subprocess.Popen(
        [str(x) for x in command],
        cwd=cwd,
        env=ENV,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
    )
    OWNED.add(process)
    timed_out = False
    try:
        try:
            stdout, stderr = process.communicate(timeout=seconds)
        except subprocess.TimeoutExpired:
            timed_out = True
            os.killpg(process.pid, signal.SIGKILL)
            stdout, stderr = process.communicate()
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.communicate()
        OWNED.discard(process)
    result = {
        "code": process.returncode,
        "timeout": timed_out,
        "stdout": stdout,
        "stderr": stderr,
    }
    if artifact:
        artifact.with_suffix(".stdout.log").write_text(stdout)
        artifact.with_suffix(".stderr.log").write_text(stderr)
        artifact.with_suffix(".process.json").write_text(json.dumps(result, indent=2))
    emit("raw-process", result)
    return result


def checked(command, cwd=ROOT, seconds=5):
    result = run(command, cwd, seconds)
    require(not result["timeout"] and result["code"] == 0, f"command failed: {command}")
    return result["stdout"].strip()


def blob(root, path):
    return checked(["git", "hash-object", path], root)


def identities(root, mutated=False):
    for path, expected in IMMUTABLE.items():
        if mutated and path == SOURCE:
            continue
        require(blob(root, path) == expected, f"immutable blob mismatch: {path}")


def replace_once(text, old, new):
    require(text.count(old) == 1, f"mutation anchor count: {old!r}")
    return text.replace(old, new, 1)


def mutate(source, variant):
    if variant == "control":
        return source
    start = source.index("    onRequestFailed(handler) {")
    end = source.index("    onConsole(handler) {", start)
    hunk = source[start:end]
    if variant == "baseline-hunk":
        changed = BASELINE_HUNK
    elif variant == "no-response-await":
        changed = replace_once(
            hunk,
            "const resp = await req.response?.();",
            "const resp = req.response?.();",
        )
    elif variant == "no-iife-catch":
        changed = replace_once(
            hunk,
            """          })().catch(() => {
            // EventEmitter does not await listeners. Consume a diagnostic
            // consumer's exception instead of leaking a rejected Promise.
          });""",
            "          })();",
        )
    elif variant == "capture-after-await":
        capture = """          const url = req.url();
          const errorClass = req.failure?.()?.errorText ?? "unknown";
"""
        changed = replace_once(hunk, capture, "")
        changed = replace_once(
            changed,
            "            await handler({ url, errorClass, responseStatus });",
            capture + "            await handler({ url, errorClass, responseStatus });",
        )
    elif variant == "drop-rejected-lookup":
        changed = replace_once(
            hunk,
            "              // Browser closure must not discard the original diagnostic.",
            "              return; // mutant: discard lookup rejection",
        )
    elif variant == "force-null-status":
        changed = replace_once(
            hunk, "responseStatus = resp?.status() ?? null;", "responseStatus = null;"
        )
    elif variant == "no-callback-await":
        changed = replace_once(
            hunk,
            "await handler({ url, errorClass, responseStatus });",
            "handler({ url, errorClass, responseStatus });",
        )
    elif variant == "no-fifo-eviction":
        # The separate synchronous timing listener, not the diagnostic listener.
        anchor = source.index('      page.on("requestfailed", (arg) => {')
        require(anchor < start, "FIFO listener must precede diagnostic listener")
        stop = source.index("      });", anchor) + len("      });\n")
        removed = source[anchor:stop]
        require("requestStartsByUrl.delete(url)" in removed, "wrong FIFO hunk")
        return source[:anchor] + source[stop:]
    elif variant == "no-responded-request-guard":
        return replace_once(
            source, "          if (respondedRequests.has(req)) return;\n", ""
        )
    else:
        raise AuditFailure(f"unknown mutation: {variant}")
    return source[:start] + changed + source[end:]


def dependency_links():
    paths = []
    for directory, children, _ in os.walk(ROOT):
        if "node_modules" in children:
            paths.append(Path(directory, "node_modules"))
        children[:] = [
            name for name in children if name not in {"node_modules", ".git"}
        ]
    require(ROOT / "node_modules" in paths, "provisioned root dependencies missing")
    require(
        HARNESS / "node_modules" in paths, "provisioned harness dependencies missing"
    )
    return paths


def link_dependencies(scratch, paths):
    for original in paths:
        target = scratch / original.relative_to(ROOT)
        require(
            not target.exists() and not target.is_symlink(),
            f"unexpected scratch dependency: {target}",
        )
        target.parent.mkdir(parents=True, exist_ok=True)
        target.symlink_to(original, target_is_directory=True)


def remove_scratch(scratch, scratch_root):
    require(scratch.parent == scratch_root, "cleanup path is not invocation-owned")
    registrations = checked(["git", "worktree", "list", "--porcelain", "-z"])
    registered = {
        field.removeprefix("worktree ")
        for field in registrations.split("\0")
        if field.startswith("worktree ")
    }
    if str(scratch) in registered:
        result = run(["git", "worktree", "remove", "--force", scratch], ROOT, 20)
        registrations = checked(["git", "worktree", "list", "--porcelain", "-z"])
        require(
            not result["timeout"]
            and result["code"] == 0
            and f"worktree {scratch}" not in registrations.split("\0"),
            f"scratch registration cleanup failed; retain reconciliation context: {scratch}",
        )
    # A failed add may leave only an unregistered partial directory. Remove
    # that owned path only after registration removal has been verified. Never
    # globally prune shared worktree registrations.
    if scratch.exists():
        shutil.rmtree(scratch)
    require(
        not scratch.exists() and not scratch.is_symlink(),
        f"scratch path remains: {scratch}",
    )


def vitest(node, binary, cwd, files, seconds, artifact, pattern=None):
    report = artifact.with_suffix(".vitest.json")
    command = [
        node,
        binary,
        "run",
        *files,
        "--config",
        "vitest.config.ts",
        "--retry=0",
        "--no-cache",
        "--maxWorkers=1",
        "--no-file-parallelism",
        "--reporter=verbose",
        "--reporter=json",
        f"--outputFile.json={report}",
    ]
    if pattern:
        command += ["--testNamePattern", pattern]
    result = run(command, cwd, seconds, artifact)
    require(not result["timeout"], f"global timeout, never a kill: {artifact.name}")
    require(report.is_file(), f"missing JSON, never a kill: {artifact.name}")
    data = json.loads(report.read_text())
    emit("raw-vitest-json", data)
    require(
        len(data.get("testResults", [])) == len(files),
        "missing test file/setup failure",
    )
    assertions = []
    for suite in data["testResults"]:
        require(not suite.get("message"), f"suite setup error: {suite.get('message')}")
        for assertion in suite["assertionResults"]:
            selected = pattern is None or re.search(pattern, assertion["fullName"])
            if selected:
                assertions.append(assertion)
            else:
                require(
                    assertion["status"] in {"pending", "skipped"},
                    "unrelated test executed",
                )
    require(
        all(row["status"] in {"passed", "failed"} for row in assertions),
        "selected case skipped/pending",
    )
    combined = result["stdout"] + result["stderr"] + json.dumps(data)
    for error in (
        "Transform failed",
        "Failed to load url",
        "Cannot find module",
        "ERR_MODULE_NOT_FOUND",
        "ERR_PACKAGE_PATH_NOT_EXPORTED",
        "SyntaxError",
        "Hook timed out",
        "Test timed out",
    ):
        require(error not in combined, f"setup/timeout error, never a kill: {error}")
    return result, data, assertions


def reporter_assertion(row, stderr):
    """Recover display diff omitted from JSON, bound to the same test/frame."""
    heading = "FAIL " + " > ".join([OLD_TEST, *row["ancestorTitles"], row["title"]])
    lines = stderr.splitlines()
    starts = [
        index
        for index, line in enumerate(lines)
        if re.sub(r"\s+", " ", line).strip() == heading
    ]
    require(len(starts) == 1, f"missing/ambiguous named reporter failure: {heading}")
    block = [lines[starts[0]]]
    for line in lines[starts[0] + 1 :]:
        if re.match(r"^\s*FAIL\s+|^[⎯─━=-]{5,}", line):
            break
        block.append(line)
    evidence = "\n".join(block)
    frames = set(
        re.findall(
            re.escape(OLD_TEST) + r":(\d+:\d+)", "\n".join(row["failureMessages"])
        )
    )
    require(
        len(frames) == 1 and f"{OLD_TEST}:{next(iter(frames))}" in evidence,
        f"reporter failure does not match JSON assertion frame: {heading}",
    )
    return evidence


def killed(variant, rows, stderr):
    """Require the targeted behavioral assertion, never just exit != 0."""
    failed = {row["title"]: row for row in rows if row["status"] == "failed"}
    null = "delivers one diagnostic when the Playwright response Promise resolves null"
    status = "retains the request diagnostic for resolved status"
    capture = (
        "retains captured URL and error when response lookup rejects after dispatch"
    )
    strict = "survives delayed rejection and a throwing consumer under strict Node rejection handling"
    adoption = (
        "survives an async rejecting consumer under strict Node rejection handling"
    )
    requirements = {
        "baseline-hunk": (null, [r"failed-request diagnostic was not delivered"]),
        "no-response-await": (
            status,
            [
                r"AssertionError",
                r'-\s+"responseStatus": 503',
                r'\+\s+"responseStatus": null',
            ],
        ),
        "no-iife-catch": (strict, [r"diagnostic consumer failed", r"strict\.ts"]),
        "capture-after-await": (
            capture,
            [
                r"AssertionError",
                r'-\s+"url": "https://x\.example\.com/failed"',
                r'\+\s+"url": "https://x\.example\.com/changed"',
                r'-\s+"errorClass": "net::ERR_ABORTED"',
                r'\+\s+"errorClass": "changed"',
            ],
        ),
        "drop-rejected-lookup": (
            capture,
            [r"failed-request diagnostic was not delivered"],
        ),
        "force-null-status": (
            status,
            [
                r"AssertionError",
                r'-\s+"responseStatus": 503',
                r'\+\s+"responseStatus": null',
            ],
        ),
        "no-fifo-eviction": (FIFO, [r"AssertionError", r"(?:less than|<)\s*10"]),
        "no-callback-await": (
            adoption,
            [r"D4_ASYNC_DIAGNOSTIC_CONSUMER", r"async-consumer\.ts"],
        ),
        "no-responded-request-guard": (
            TIMING_DOUBLE_EVICTION,
            [
                r"AssertionError",
                r"B keeps its 50ms start after A responds then fails: expected \+?0 to be 50",
            ],
        ),
    }
    title, patterns = requirements[variant]
    require(
        title in failed, f"survivor or wrong failing test: {variant}; expected {title}"
    )
    row = failed[title]
    if variant == "no-responded-request-guard":
        require(
            set(failed) == {TIMING_DOUBLE_EVICTION},
            "guard mutant must fail only the named timing assertion",
        )
    evidence = "\n".join(row["failureMessages"])
    if variant in {"no-response-await", "force-null-status", "capture-after-await"}:
        # Vitest 3.2.4's JSON reporter stores e.stack, which abbreviates object
        # diffs. Use only the matching verbose failure, never unrelated output.
        evidence += "\n" + reporter_assertion(row, stderr)
    require(
        all(re.search(pattern, evidence) for pattern in patterns),
        f"wrong assertion, never a kill: {variant}: {evidence}",
    )
    emit(
        "intended-assertion-kill",
        {"variant": variant, "test": title, "failureMessages": evidence},
    )
    return {
        "variant": variant,
        "verdict": "KILLED",
        "test": title,
        "assertion": evidence,
    }


def main():
    require(
        os.environ.get("GITHUB_ACTIONS") == "true",
        "CI-only audit: local execution is forbidden",
    )
    runner_temp = Path(os.environ["RUNNER_TEMP"]).resolve()
    artifact_dir = Path(tempfile.mkdtemp(prefix="d4-audit-results-", dir=runner_temp))
    scratch_root = Path(tempfile.mkdtemp(prefix="d4-audit-scratch-", dir=runner_temp))
    active_scratch = None
    cleanup_attempted = False
    verdicts = []
    try:
        head = checked(["git", "rev-parse", "HEAD"])
        raw_commit = checked(["git", "cat-file", "-p", "HEAD"])
        event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
        metadata = {
            "checkout": head,
            "parents": re.findall(r"^parent ([0-9a-f]{40})$", raw_commit, re.MULTILINE),
            "github_sha": os.environ.get("GITHUB_SHA"),
            "pr_head": event.get("pull_request", {}).get("head", {}).get("sha"),
            "reference_base": BASE,
            "recorded_production_base": RECORDED_BASE,
            "timing_recorded_red_base": TIMING_RECORDED_BASE,
            "timing_recorded_red_source_blob": TIMING_RECORDED_SOURCE,
            "source_and_test_blobs": IMMUTABLE,
            "artifacts": str(artifact_dir),
        }
        emit("metadata", metadata)
        (artifact_dir / "metadata.json").write_text(json.dumps(metadata, indent=2))
        require(
            not checked(["git", "status", "--porcelain", "--untracked-files=no"]),
            "audit checkout is dirty",
        )
        identities(ROOT)
        # Resolve tsx with createRequire, exactly like the corrected regressions.
        node = shutil.which("node")
        require(node, "installed Node missing")
        resolver = """import {createRequire} from 'node:module';
const r=createRequire(process.cwd()+'/package.json');
const pr=createRequire(r.resolve('playwright/package.json'));
console.log(JSON.stringify({node:process.execPath,nodeVersion:process.version,
vitest:r.resolve('vitest/vitest.mjs'),vitestPackage:r.resolve('vitest/package.json'),
tsx:r.resolve('tsx'),versions:{vitest:r('vitest/package.json').version,
tsx:r('tsx/package.json').version,playwright:r('playwright/package.json').version,
core:pr('playwright-core/package.json').version}}));"""
        resolved = json.loads(
            checked([node, "--input-type=module", "-e", resolver], HARNESS)
        )
        emit("resolved-versions", resolved)
        require(
            resolved["versions"]["vitest"] == "3.2.4",
            "CLI contract requires installed Vitest 3.2.4",
        )
        cli = "\n".join(
            path.read_text()
            for path in Path(resolved["vitestPackage"]).parent.glob(
                "dist/chunks/cac.*.js"
            )
        )
        for flag in (
            "retry:",
            "cache:",
            "maxWorkers:",
            "fileParallelism:",
            "reporters:",
            "outputFile:",
            "testNamePattern:",
        ):
            require(flag in cli, f"installed CLI contract missing {flag}")
        binary = resolved["vitest"]
        node = resolved["node"]
        corpus, data, assertions = vitest(
            node, binary, HARNESS, [CORPUS], 90, artifact_dir / "corpus"
        )
        require(
            len(assertions) == 23, "expected 20 corpus tests and 3 validator controls"
        )
        require(
            corpus["code"] == 0
            and data["success"]
            and all(row["status"] == "passed" for row in assertions),
            "consumer corpus must pass",
        )
        observed = []
        catalogs = []
        for line in corpus["stdout"].splitlines():
            # Verbose Vitest prefixes logs on separate lines; JSON stays whole.
            if line.startswith('{"kind":"D4_BOUNDARY_'):
                record = json.loads(line)
                if record["kind"] == "D4_BOUNDARY_CATALOG":
                    catalogs.append(record)
                elif record["kind"] == "D4_BOUNDARY_OBSERVED":
                    observed.append(record["id"])
        require(
            len(catalogs) == 1 and catalogs[0]["count"] == 21,
            "missing finite corpus catalog",
        )
        require(
            len(observed) == 21 and sorted(observed) == sorted(catalogs[0]["caseIds"]),
            "missing/unexpected consumer case",
        )
        for fixture, mode, marker in (
            ("strict.ts", None, "D4_REQUEST_FAILED_DIAGNOSTIC_OK\n"),
            ("async-consumer.ts", "fulfilled", "D4_REQUEST_FAILED_ASYNC_CONSUMER_OK\n"),
            ("async-consumer.ts", "rejecting", "D4_REQUEST_FAILED_ASYNC_CONSUMER_OK\n"),
        ):
            command = [
                node,
                "--unhandled-rejections=strict",
                "--import",
                resolved["tsx"],
                HARNESS / "test/fixtures/d4-request-failed" / fixture,
            ]
            if mode:
                command.append(mode)
            result = run(
                command,
                HARNESS,
                5,
                artifact_dir / f"direct-{Path(fixture).stem}-{mode or 'sync'}",
            )
            require(
                result == {"code": 0, "timeout": False, "stdout": marker, "stderr": ""},
                f"strict child failed: {fixture}/{mode}; setup/import failure is not a behavioral kill",
            )
        links = dependency_links()
        original = (ROOT / SOURCE).read_text()
        boundary_blob = blob(ROOT, f"showcase/harness/{CORPUS}")
        for variant in VARIANTS:
            scratch = scratch_root / variant
            # Git can register the path before checkout completes or times out.
            active_scratch = scratch
            cleanup_attempted = False
            checked(
                ["git", "worktree", "add", "--detach", str(scratch), head], seconds=20
            )
            try:
                link_dependencies(scratch, links)
                changed = mutate(original, variant)
                (scratch / SOURCE).write_text(changed)
                identities(scratch, mutated=variant != "control")
                require(
                    blob(scratch, f"showcase/harness/{CORPUS}") == boundary_blob,
                    "new corpus changed in scratch",
                )
                paths = checked(["git", "diff", "--name-only"], scratch).splitlines()
                require(
                    paths == ([] if variant == "control" else [SOURCE]),
                    "mutation-only delta violated",
                )
                require(
                    not checked(
                        ["git", "ls-files", "--others", "--exclude-standard"], scratch
                    ),
                    "untracked scratch files",
                )
                diff = checked(["git", "diff", "--", SOURCE], scratch)
                (artifact_dir / f"{variant}.diff").write_text(diff + "\n")
                emit("exact-mutation-diff", {"variant": variant, "diff": diff})
                result, data, rows = vitest(
                    node,
                    binary,
                    scratch / "showcase/harness",
                    [OLD_TEST, ASYNC_TEST, TIMING_TEST],
                    45,
                    artifact_dir / variant,
                    PATTERN,
                )
                require(
                    len(rows) == 16 and {row["title"] for row in rows} == TITLES,
                    "focused selection must be exactly 16 named tests",
                )
                if variant == "control":
                    require(
                        result["code"] == 0
                        and data["success"]
                        and all(row["status"] == "passed" for row in rows),
                        "control must be 16 PASS before mutation kills",
                    )
                    verdicts.append({"variant": variant, "verdict": "16 PASS"})
                else:
                    require(
                        result["code"] != 0 and not data["success"], "surviving mutant"
                    )
                    verdicts.append(killed(variant, rows, result["stderr"]))
            finally:
                cleanup_attempted = True
                remove_scratch(scratch, scratch_root)
                active_scratch = None
        require(len(verdicts) == 10, "missing variant")
        emit(
            "verdict",
            {
                "status": "PASS",
                "cases": 21,
                "validator_controls": 3,
                "strict_children": 3,
                "regression_tests": 16,
                "variants": verdicts,
            },
        )
        return 0
    except (AuditFailure, KeyError, ValueError, OSError) as error:
        emit(
            "verdict",
            {"status": "FAIL", "error": str(error), "completed_variants": verdicts},
        )
        return 1
    finally:
        for process in list(OWNED):
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
            process.communicate()
            OWNED.discard(process)
        try:
            if active_scratch is not None:
                require(
                    not cleanup_attempted,
                    "scratch cleanup already failed; context retained",
                )
                remove_scratch(active_scratch, scratch_root)
                active_scratch = None
            # Preserve the scratch root if targeted cleanup cannot reconcile its
            # registration. The failure remains fatal; do not erase its context.
            shutil.rmtree(scratch_root)
        except (AuditFailure, OSError) as error:
            emit(
                "scratch-cleanup-failure",
                {
                    "scratch_root": str(scratch_root),
                    "active_scratch": str(active_scratch),
                    "error": str(error),
                },
            )
            raise
        finally:
            # Full raw evidence always survives outside scratch, including an
            # interrupted creation or failed removal and its reconciliation path.
            emit(
                "retained-artifacts",
                {
                    "directory": str(artifact_dir),
                    "files": sorted(path.name for path in artifact_dir.iterdir()),
                    "scratch_root_retained": str(scratch_root)
                    if scratch_root.exists()
                    else None,
                },
            )


def interrupted(signum, _frame):
    raise AuditFailure(f"audit interrupted by signal {signum}")


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    sys.exit(main())
