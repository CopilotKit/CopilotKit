"""The repo tools, bound to one thread's workspace.

`build_tools` returns plain async functions. The Antigravity SDK derives each
tool's schema from its signature and docstring, so both are written for the
model. The adapter wraps them so every call and result streams to the browser
as AG-UI TOOL_CALL_* events, which the frontend renders as cards.

Which tools need the user's approval is decided by name in agent.py: reading
and testing run freely, installing and pushing stop for an approve/deny card.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import tomllib
import xml.etree.ElementTree as ET
from collections.abc import Awaitable, Callable
from pathlib import Path, PurePosixPath
from typing import Any

from ag_ui_antigravity import experimental_get_state, experimental_set_state

from . import shell
from .a2ui import report_surface_operations
from .ci import GitHubAPIError, ci_summary
from .config import Settings
from .project import (
    JUNIT_REPORT,
    ProjectPlan,
    UnsupportedProjectError,
    detect,
    optional_extras,
    plan_with_extras,
    versions_from_git,
)
from .test_report import TestReport, parse_junit, report_from_output
from .uvcache import CacheGuard
from .workspace import Workspace

Tool = Callable[..., Awaitable[dict[str, Any]]]

_REPO_REF = re.compile(
    r"^(?:https?://github\.com/)?(?P<owner>[A-Za-z0-9-]{1,39})/(?P<name>[A-Za-z0-9._-]{1,100}?)(?:\.git)?/?$"
)
_GIT_IDENTITY = ("-c", "user.name=Repo Doctor", "-c", "user.email=repo-doctor@localhost")
# The model needs tracebacks to diagnose a failure, not the whole log.
_OUTPUT_TAIL_CHARS = 8_000
_PUSH_DISABLED = "push-disabled-by-repo-doctor"
# git_push runs no hooks: an approved shell command could have written one.
_NO_HOOKS = ("-c", f"core.hooksPath={os.devnull}")
# Above this many tracked files the agent reads CI config before installing.
LARGE_REPO_FILES = 5_000
# run_check: one reproduction command, so it must be quick and its output short.
CHECK_TIMEOUT_SECONDS = 120
_CHECK_TAIL_CHARS = 4_000
_MAX_LABEL_CHARS = 80
_ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")
# How far back clone_repo fetches history when a package is versioned from git tags.
_TAG_HISTORY = "2 years ago"


def _error(message: str) -> dict[str, Any]:
    return {"ok": False, "error": message}


def parse_repo_ref(repo: str) -> str:
    """Returns `owner/name` for a GitHub repo reference, or raises ValueError."""
    match = _REPO_REF.match(repo.strip())
    if not match:
        raise ValueError(
            f"{repo!r} is not a GitHub repository. Use owner/name or https://github.com/owner/name."
        )
    return f"{match.group('owner')}/{match.group('name')}"


def _state() -> dict[str, Any]:
    state: dict[str, Any] = experimental_get_state()
    return state


def _update_state(**changes: Any) -> None:
    experimental_set_state({**_state(), **changes})


def build_tools(
    workspace: Workspace,
    settings: Settings,
    *,
    on_change: Callable[[], None] | None = None,
    cache: CacheGuard | None = None,
) -> list[Tool]:
    """The thread's tools. `on_change` saves the workspace (after a clone or a
    push); `cache` keeps uv's cache in check around installs."""
    repo = workspace.path
    timeout = float(settings.command_timeout_seconds)

    async def git(*args: str, check: bool = True) -> shell.CommandResult:
        # Local transport only, so no URL rewrite can turn a push into a network one.
        # Clone and fetch call shell.run directly and are not limited.
        result = await shell.run(
            ["git", *args], cwd=repo, timeout=120, env={"GIT_ALLOW_PROTOCOL": "file"}
        )
        if check and not result.ok:
            raise RuntimeError(f"`{result.command}` failed: {result.output.strip()[-600:]}")
        return result

    def plan_or_error() -> ProjectPlan | dict[str, Any]:
        if not workspace.has_repo:
            return _error("No repository yet. Call clone_repo first.")
        try:
            plan = detect(repo)
        except UnsupportedProjectError as exc:
            return _error(str(exc))
        if missing := missing_programs(plan):
            return _error(
                f"This {plan.language} project needs {', '.join(missing)}, which "
                "is not installed where the agent runs, so it cannot be installed "
                "or tested here."
            )
        return plan

    async def cloned_slug() -> str | None:
        """The GitHub repo this workspace holds, read from git rather than state."""
        for remote in ("upstream", "origin"):
            url = await git("remote", "get-url", remote, check=False)
            if url.ok and url.output.strip().startswith("https://github.com/"):
                try:
                    return parse_repo_ref(url.output.strip())
                except ValueError:
                    return None
        return None

    async def ensure_local_push_remote() -> None:
        """Points every push at a local bare repository, never at GitHub.

        Idempotent, so a setup interrupted halfway is completed on the next
        call: the GitHub remote keeps fetch access but loses its push URL.
        """
        remotes = set((await git("remote")).output.split())
        if "upstream" not in remotes and "origin" in remotes:
            await git("remote", "rename", "origin", "upstream")
            remotes = (remotes - {"origin"}) | {"upstream"}
        if "upstream" in remotes:
            await git("remote", "set-url", "--push", "upstream", _PUSH_DISABLED)
        if not (workspace.push_remote / "HEAD").exists():
            await git("init", "--bare", "--quiet", str(workspace.push_remote))
            await git(
                "--git-dir", str(workspace.push_remote), "config", "receive.shallowUpdate", "true"
            )
        if "origin" in remotes:
            await git("remote", "set-url", "origin", str(workspace.push_remote))
        else:
            await git("remote", "add", "origin", str(workspace.push_remote))
        # Explicit, so even a raw `git push` lands in the local bare repository.
        await git("remote", "set-url", "--push", "origin", str(workspace.push_remote))

    async def clone_repo(repo_ref: str) -> dict[str, Any]:
        """Clones a public GitHub repository into this conversation's workspace.

        Call this first. The result includes `install_command`, which you pass
        unchanged to install_dependencies, and the command run_tests will use.

        Args:
          repo_ref: The repository as owner/name or https://github.com/owner/name.
        """
        try:
            slug = parse_repo_ref(repo_ref)
        except ValueError as exc:
            return _error(str(exc))

        workspace.ensure()
        if workspace.has_repo:
            current = await cloned_slug()
            if current != slug:
                return _error(
                    f"This conversation already works on {current or 'another repository'}. "
                    "Start a new conversation for another repository."
                )
        else:
            cloned = await shell.run(
                [
                    "git",
                    "clone",
                    # Shallow: the agent needs the current tree, not the history,
                    # and large repositories stay fast to clone.
                    "--depth",
                    "1",
                    "--no-tags",
                    f"https://github.com/{slug}.git",
                    ".",
                ],
                cwd=repo,
                timeout=timeout,
            )
            if not cloned.ok:
                return _error(f"git clone failed: {cloned.output.strip()[-800:]}")
        await ensure_local_push_remote()
        if versions_from_git(repo):
            # The version comes from the nearest tag, so fetch recent history
            # and the tags. Bounded by date: it stays small, and git_push still
            # sends only that much history to the local remote.
            await shell.run(
                [
                    "git",
                    "fetch",
                    "--quiet",
                    "--tags",
                    f"--shallow-since={_TAG_HISTORY}",
                    "upstream",
                ],
                cwd=repo,
                timeout=timeout,
            )

        branch = (await git("rev-parse", "--abbrev-ref", "HEAD")).output.strip()
        commit = (await git("log", "-1", "--format=%h%x09%s")).output.strip()
        short_sha, _, subject = commit.partition("\t")
        tracked = len((await git("ls-files")).output.splitlines())
        info: dict[str, Any] = {
            "slug": slug,
            "path": str(repo),
            "url": f"https://github.com/{slug}",
            "branch": branch,
            "commit": short_sha,
            "commitSubject": subject,
            "trackedFiles": tracked,
            "large": tracked > LARGE_REPO_FILES,
        }
        plan = plan_or_error()
        if isinstance(plan, ProjectPlan):
            info |= {
                "language": plan.language,
                "installCommand": plan.install_command,
                "testCommand": plan.test_command,
            }
            if plan.language == "python":
                # So the model can install what CI installs, through the tool.
                info["optionalExtras"] = optional_extras(repo)
        _update_state(repo=info)
        if on_change is not None:
            on_change()
        return {
            "ok": True,
            **info,
            **({} if isinstance(plan, ProjectPlan) else {"warning": plan["error"]}),
        }

    async def ci_status() -> dict[str, Any]:
        """Shows the latest GitHub Actions result of each workflow on the default branch.

        Call this right after clone_repo, before installing anything. For a failing
        workflow it also lists the failed job names.
        """
        info = _state().get("repo", {})
        slug, branch = info.get("slug"), info.get("branch")
        if not slug or not branch:
            return _error("No repository yet. Call clone_repo first.")
        try:
            token = settings.github_token.get_secret_value() if settings.github_token else None
            return {"ok": True, **(await ci_summary(slug, branch, token))}
        except GitHubAPIError as exc:
            return _error(str(exc))

    async def install_dependencies(command: str) -> dict[str, Any]:
        """Installs the project's dependencies. The user must approve this first.

        Args:
          command: The exact `installCommand` that clone_repo returned. For a
            Python project, `-e .` may become `-e .[extra1,extra2]` to install
            extras the failing CI step installs (from `optionalExtras`). Any
            other command is refused. PyTorch always installs as CPU wheels.
        """
        plan = plan_or_error()
        if not isinstance(plan, ProjectPlan):
            return plan
        if command.strip() != plan.install_command:
            # The same command with the extras the CI step installs, written in
            # as `-e .[a,b]`: the one sanctioned way to install more.
            extended = plan_with_extras(plan, command.strip(), optional_extras(repo))
            if isinstance(extended, str):
                return _error(extended)
            plan = extended

        if plan.language == "python":
            # `.venv` lives on local disk, not next to the repo (see workspace.py).
            workspace.link_venv()
        output: list[str] = []
        duration = 0.0
        if cache is not None:
            cache.install_started()
        try:
            for step in plan.install_steps:
                result = await shell.run(step, cwd=repo, timeout=timeout)
                output.append(f"$ {result.command}\n{result.output}")
                duration += result.duration_seconds
                if not result.ok:
                    return {
                        **_error(f"`{result.command}` exited with {result.exit_code}."),
                        "output_tail": "\n".join(output)[-_OUTPUT_TAIL_CHARS:],
                    }
        finally:
            if cache is not None:
                await cache.install_finished()
        packages = await _key_packages(plan)
        _update_state(install={"command": plan.install_command, "packages": packages})
        return {
            "ok": True,
            "command": plan.install_command,
            "duration_seconds": round(duration, 2),
            "packages": packages,
        }

    async def _key_packages(plan: ProjectPlan) -> list[dict[str, str]]:
        """Installed versions of the project's direct dependencies (Python only)."""
        if plan.language != "python":
            return []
        listed = await shell.run(
            ["uv", "pip", "list", "--python", ".venv", "--format", "json"], cwd=repo, timeout=60
        )
        if not listed.ok:
            return []
        try:
            installed = {p["name"].lower(): p["version"] for p in json.loads(listed.output)}
        except (json.JSONDecodeError, KeyError, TypeError):
            return []
        direct = _direct_dependencies(repo / "pyproject.toml")
        return [{"name": n, "version": installed[n]} for n in direct if n in installed]

    async def run_tests(target: str = "") -> dict[str, Any]:
        """Runs the test suite and shows a live report card to the user.

        The result lists failing tests with their error messages and the first
        failure's traceback.

        Args:
          target: Optional path inside the repo to run a subset, such as
            tests/test_x.py. Empty runs everything.
        """
        plan = plan_or_error()
        if not isinstance(plan, ProjectPlan):
            return plan
        installed_marker = {"python": ".venv", "node": "node_modules"}.get(plan.language)
        if installed_marker and not (repo / installed_marker).exists():
            return _error("Dependencies are not installed. Call install_dependencies first.")
        args = list(plan.test_args)
        if target:
            if not _is_safe_relative(target) or not (repo / target).exists():
                return _error(f"{target!r} is not a path inside the repository.")
            args.append(target)

        junit = repo / JUNIT_REPORT
        junit.parent.mkdir(parents=True, exist_ok=True)
        junit.unlink(missing_ok=True)
        result = await shell.run(args, cwd=repo, timeout=timeout)
        if result.timed_out:
            return _error(
                f"The tests did not finish within {settings.command_timeout_seconds} seconds."
            )
        shown = " ".join([*plan.display_test_args, *([target] if target else [])])
        report = await asyncio.to_thread(
            _build_report,
            plan,
            junit,
            shown,
            result.exit_code,
            result.duration_seconds,
            result.output,
        )

        runs: list[dict[str, Any]] = list(_state().get("testRuns", []))
        number = len(runs) + 1
        runs.append(
            {
                "run": number,
                "status": report.status,
                "headline": report.headline(),
                "passed": report.passed,
                "failed": report.failed + report.errors,
                "total": report.total,
                "durationSeconds": report.duration_seconds,
                "target": target or None,
            }
        )
        _update_state(testRuns=runs)
        details: dict[str, Any] = {}
        if report.first_traceback:
            details["first_traceback"] = report.first_traceback
        elif report.status != "passed":
            # No structured failures (a collection error, or a runner without a
            # report): the console output is all there is.
            details["output_tail"] = result.output[-_OUTPUT_TAIL_CHARS:]
        return {
            # Painted by CopilotKit's A2UI middleware; the model can ignore it.
            "a2ui_operations": report_surface_operations(report, run=number),
            "status": report.status,
            "summary": report.headline(),
            "failures": [{"test": f.id, "error": f.message} for f in report.failures],
            **details,
        }

    def _check_env() -> dict[str, str]:
        """Puts the project's installed tools first on PATH, as an activated CI job would."""
        bins = [repo / ".venv" / "bin", repo / "node_modules" / ".bin"]
        found = [str(b) for b in bins if b.is_dir()]
        if not found:
            return {}
        path = shell.child_env().get("PATH", "")
        env = {"PATH": os.pathsep.join([*found, path])}
        if (repo / ".venv" / "bin").is_dir():
            env["VIRTUAL_ENV"] = str(repo / ".venv")
        return env

    async def run_check(command: str, label: str) -> dict[str, Any]:
        """Runs one shell command that reproduces a failing CI step, and records it.

        The user must approve this first. Use it before the fix (it should
        fail) and again with the same command after the fix (it should pass).
        Passed or failed comes from the exit code. The command runs in the
        repository root with the project's installed tools on PATH and must
        finish within two minutes.

        Args:
          command: One shell command, the smallest piece of the failing CI
            step, for example a single script or test the job runs.
          label: A few words naming what it checks, such as "benchmark smoke run".
        """
        if not workspace.has_repo:
            return _error("No repository yet. Call clone_repo first.")
        command = command.strip()
        if not command:
            return _error("The command is empty.")
        label = " ".join(label.split())[:_MAX_LABEL_CHARS] or command[:_MAX_LABEL_CHARS]
        shell_bin = shutil.which("bash") or "/bin/sh"
        result = await shell.run(
            [shell_bin, "-c", command], cwd=repo, timeout=CHECK_TIMEOUT_SECONDS, env=_check_env()
        )
        if result.timed_out:
            status, exit_code = "failed", None
            headline = f"timed out after {CHECK_TIMEOUT_SECONDS}s, counted as failed"
        else:
            exit_code = result.exit_code
            status = "passed" if exit_code == 0 else "failed"
            headline = f"{status}, exit {exit_code}"

        checks: list[dict[str, Any]] = list(_state().get("checks", []))
        number = len(checks) + 1
        record = {
            "run": number,
            "label": label,
            "command": command,
            "status": status,
            "exitCode": exit_code,
            "timedOut": result.timed_out,
            "headline": headline,
            "durationSeconds": result.duration_seconds,
        }
        checks.append(record)
        _update_state(checks=checks)
        return {
            "ok": True,
            **record,
            "output_tail": _ANSI.sub("", result.output)[-_CHECK_TAIL_CHARS:],
        }

    async def show_diff(summary: str) -> dict[str, Any]:
        """Shows the user the current changes to the repository as a diff card.

        Call this after editing files and before running the tests again.

        Args:
          summary: One plain sentence on what the change fixes and why.
        """
        if not workspace.has_repo:
            return _error("No repository yet. Call clone_repo first.")
        patch = (await git("diff", "--no-color", "--no-ext-diff", "HEAD")).output
        if not patch.strip():
            return _error("There are no changes to show yet.")
        numstat = (await git("diff", "--numstat", "HEAD")).output
        files = [
            {"path": path, "additions": int(add), "deletions": int(rem)}
            for add, rem, path in (line.split("\t", 2) for line in numstat.splitlines() if line)
            if add.isdigit() and rem.isdigit()
        ]
        return {"ok": True, "summary": summary, "files": files, "patch": patch}

    async def git_push(branch: str, commit_message: str) -> dict[str, Any]:
        """Commits the current changes on a new branch and pushes it.

        The user must approve this first. The push goes to this demo's local
        remote, never to GitHub.

        Args:
          branch: A new branch name such as fix/failing-test.
          commit_message: A one-line commit message.
        """
        if not workspace.has_repo:
            return _error("No repository yet. Call clone_repo first.")
        valid = await git("check-ref-format", "--branch", branch, check=False)
        default = _state().get("repo", {}).get("branch")
        if not valid.ok or branch == default:
            return _error(f"{branch!r} is not a valid new branch name.")
        if not commit_message.strip():
            return _error("The commit message is empty.")

        # The push goes to this thread's bare repository by path, not to
        # `origin`: an approved shell command can repoint a remote, and a URL
        # rewrite in the repo's config could still send a path elsewhere.
        if not (workspace.push_remote / "HEAD").exists():
            return _error("The local push remote is missing. Call clone_repo again.")
        # Any URL rewrite in the repository's own config (local or worktree,
        # includes followed) is refused. Rewrites from the environment are
        # safety.py's GitHub block, and the global and system files are off.
        rewrites = await git(
            "config", "--show-scope", "--includes", "--get-regexp", r"^url\.", check=False
        )
        for line in rewrites.output.splitlines():
            scope, _, rest = line.partition("\t")
            if scope in ("local", "worktree"):
                setting = rest.split(None, 1)[0]
                return _error(
                    f"This repository's git config rewrites remote URLs ({setting}), "
                    "so the push cannot be kept local. Remove that setting and try again."
                )

        current = (await git("rev-parse", "--abbrev-ref", "HEAD")).output.strip()
        if current != branch:
            exists = await git(
                "rev-parse", "--verify", "--quiet", f"refs/heads/{branch}", check=False
            )
            await git(*_NO_HOOKS, "switch", *([] if exists.ok else ["-c"]), branch)
        # Tracked files only. The agent edits existing files (it has no
        # create-file tool), while test runs leave stray untracked files
        # (some suites write `:memory:*` databases) that must not be committed.
        await git("add", "--update")
        staged = await git("diff", "--cached", "--quiet", check=False)
        if staged.exit_code != 0:
            await git(*_GIT_IDENTITY, *_NO_HOOKS, "commit", "--quiet", "-m", commit_message.strip())
        else:
            # Nothing new to commit. A commit that is not on the remote branch
            # yet (an earlier push failed) still goes out; otherwise there is
            # nothing to do.
            head = (await git("rev-parse", "HEAD")).output.strip()
            ahead = await git("rev-list", "--count", f"{default}..HEAD", check=False)
            sent = await shell.run(
                [
                    "git",
                    "--git-dir",
                    str(workspace.push_remote),
                    "merge-base",
                    "--is-ancestor",
                    head,
                    f"refs/heads/{branch}",
                ],
                cwd=repo,
                timeout=120,
            )
            if not default or ahead.output.strip() in ("", "0") or sent.ok:
                return _error("There is nothing to commit.")
        pushed = await git(
            *_NO_HOOKS,
            "push",
            "--quiet",
            "--no-recurse-submodules",
            # The receiving side runs its own git, which reads the bare
            # repository's hooks; it gets the same no-hooks setting.
            f"--receive-pack=git -c core.hooksPath={os.devnull} receive-pack",
            str(workspace.push_remote),
            f"{branch}:{branch}",
            check=False,
        )
        if not pushed.ok:
            return _error(f"git push failed: {pushed.output.strip()[-600:]}")
        sha = (await git("rev-parse", "--short", "HEAD")).output.strip()
        files = (await git("show", "--name-only", "--format=", "HEAD")).output.split()
        push = {"branch": branch, "commit": sha, "files": files, "remote": "local"}
        _update_state(push=push)
        if on_change is not None:
            on_change()
        return {"ok": True, **push, "note": "Pushed to the local demo remote, not GitHub."}

    return [
        clone_repo,
        ci_status,
        install_dependencies,
        run_tests,
        run_check,
        show_diff,
        git_push,
    ]


# pytest's exit code when it collected no tests.
_PYTEST_NO_TESTS = 5


def missing_programs(plan: ProjectPlan) -> list[str]:
    """The plan's programs that are not on the PATH its commands run with.

    Paths such as `.venv/bin/python` are left out: the install creates them.
    """
    path = shell.child_env()["PATH"]
    programs = dict.fromkeys(
        args[0] for args in (*plan.install_steps, plan.test_args) if "/" not in args[0]
    )
    return [program for program in programs if shutil.which(program, path=path) is None]


def _no_tests(plan: ProjectPlan, exit_code: int, output: str) -> bool:
    if plan.runner == "pytest":
        return exit_code == _PYTEST_NO_TESTS
    if plan.runner == "unittest":
        return "Ran 0 tests" in output
    if plan.runner == "go":
        return "[no test files]" in output and not re.search(r"^(?:ok|FAIL)\s", output, re.M)
    return False


def _build_report(
    plan: ProjectPlan, junit: Path, command: str, exit_code: int, duration: float, output: str
) -> TestReport:
    """pytest's JUnit report when it wrote one, else what the runner printed."""
    no_tests = _no_tests(plan, exit_code, output)
    if plan.runner == "pytest" and junit.is_file() and not no_tests:
        try:
            return parse_junit(
                junit.read_text(encoding="utf-8"),
                command=command,
                exit_code=exit_code,
                duration=duration,
            )
        except ET.ParseError:
            pass  # A truncated report: fall back to the console summary.
    return report_from_output(
        command=command,
        exit_code=exit_code,
        duration=duration,
        output=output,
        no_tests=no_tests,
    )


def _is_safe_relative(target: str) -> bool:
    path = PurePosixPath(target)
    return not path.is_absolute() and ".." not in path.parts


def _direct_dependencies(pyproject: Path) -> list[str]:
    try:
        data = tomllib.loads(pyproject.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError):
        return []
    names: list[str] = []
    for spec in data.get("project", {}).get("dependencies", []):
        name = re.split(r"[\s<>=!~;\[(]", spec, maxsplit=1)[0].strip().lower()
        if name:
            names.append(name)
    return names


# Tool names, for the approval policy in agent.py. Cloning, testing and
# showing a diff run freely; installing, checks (arbitrary shell commands)
# and pushing wait for the user.
AUTO_APPROVED_TOOLS = ("clone_repo", "ci_status", "run_tests", "show_diff")
