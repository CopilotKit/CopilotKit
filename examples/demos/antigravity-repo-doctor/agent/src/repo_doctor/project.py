"""Works out how to install and test a cloned repository from its own files.

Supported: Python (uv; pytest when the project uses it, else unittest), Node
(the package manager its lockfile or `packageManager` field names, and its
`test` script), Go (go.mod) and Rust (Cargo.toml). Nothing is added that the
project does not declare, except the test runner itself.

The plan is deterministic, so the approval card can show the exact command
before anything runs, and `install_dependencies` refuses any other command.
"""

from __future__ import annotations

import json
import re
import sys
import tomllib
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Literal

Runner = Literal["pytest", "unittest", "script", "go", "cargo"]
Language = Literal["python", "node", "go", "rust"]

# Dependency groups worth installing to run a test suite.
_TEST_GROUPS = ("test", "tests", "testing", "dev")
# Inside .git so the report never shows up as a change in the worktree.
JUNIT_REPORT = ".git/repo-doctor/junit.xml"
_PYTEST_ARGS = (
    "-q",
    "--tb=short",
    "--color=no",
    "-rfE",
    "-p",
    "no:cacheprovider",
    f"--junitxml={JUNIT_REPORT}",
    "-o",
    "junit_family=xunit1",
    "-o",
    "junit_logging=no",
)
# The venv uses this process's Python version, which is always installed. A
# repo's own `.python-version` may name an interpreter the machine lacks.
_PYTHON = f"{sys.version_info.major}.{sys.version_info.minor}"


@dataclass(frozen=True)
class ProjectPlan:
    language: Language
    runner: Runner
    install_steps: tuple[tuple[str, ...], ...]
    test_args: tuple[str, ...]

    @property
    def install_command(self) -> str:
        """What the user approves: every install step, joined as one line."""
        return " && ".join(" ".join(step) for step in self.install_steps)

    @property
    def display_test_args(self) -> tuple[str, ...]:
        """The test command without report plumbing, for people to read."""
        if self.runner == "pytest":
            return ("pytest",)
        if self.test_args[0] == ".venv/bin/python":
            return ("python", *self.test_args[1:])
        return self.test_args

    @property
    def test_command(self) -> str:
        return " ".join(self.display_test_args)


class UnsupportedProjectError(Exception):
    pass


def optional_extras(repo: Path) -> list[str]:
    """The extras a Python project declares (`[project.optional-dependencies]`)."""
    try:
        data = tomllib.loads((repo / "pyproject.toml").read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError):
        return []
    extras = data.get("project", {}).get("optional-dependencies", {})
    return sorted(extras) if isinstance(extras, dict) else []


_EXTRAS_IN_COMMAND = re.compile(r"(?<=-e )\.\[([A-Za-z0-9_.,-]+)\]")


def plan_with_extras(plan: ProjectPlan, command: str, declared: list[str]) -> ProjectPlan | str:
    """The plan installing `-e .[a,b]` when `command` is the install command
    with declared extras added, else why the command is refused."""
    refused = f"Refused: pass the exact install command `{plan.install_command}`"
    match = _EXTRAS_IN_COMMAND.search(command)
    if match is None or plan.language != "python":
        return f"{refused}, optionally with declared extras as `-e .[extra1,extra2]`."
    if _EXTRAS_IN_COMMAND.sub(".", command, count=1) != plan.install_command:
        return f"{refused}, changing only `-e .` to `-e .[extra1,extra2]`."
    extras = [e for e in match.group(1).split(",") if e]
    unknown = [e for e in extras if e not in declared]
    if unknown:
        listed = ", ".join(declared) or "none"
        return (
            f"Refused: {', '.join(unknown)} is not an extra of this project (declared: {listed})."
        )
    target = f".[{','.join(extras)}]"
    steps = []
    for step in plan.install_steps:
        args = list(step)
        for i in range(len(args) - 1):
            if args[i] == "-e" and args[i + 1] == ".":
                args[i + 1] = target
        steps.append(tuple(args))
    return replace(plan, install_steps=tuple(steps))


def _python_groups(pyproject: Path) -> list[str]:
    try:
        data = tomllib.loads(pyproject.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError):
        return []
    groups = data.get("dependency-groups", {})
    return [g for g in _TEST_GROUPS if g in groups]


# Plugins a test suite needs are often only named in tox or extra-dependency
# config (an `--asyncio-mode` addopt fails without pytest-asyncio), so collect
# them from the places that declare dependencies. Tool config such as ruff's
# `flake8-pytest-style` rules is not a dependency and is not scanned.
_PLUGIN = re.compile(r"\bpytest-[a-z][a-z0-9-]*[a-z0-9]\b")


def _dependency_text(repo: Path) -> str:
    parts: list[str] = []
    for name in ("tox.ini", "setup.cfg"):
        try:
            parts.append((repo / name).read_text(encoding="utf-8"))
        except OSError:
            continue
    try:
        data = tomllib.loads((repo / "pyproject.toml").read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError):
        return "\n".join(parts)
    parts.append(str(data.get("tool", {}).get("tox", {}).get("legacy_tox_ini", "")))
    parts.append(json.dumps(data.get("dependency-groups", {})))
    parts.append(json.dumps(data.get("project", {}).get("optional-dependencies", {})))
    return "\n".join(parts)


def _pytest_plugins(repo: Path) -> list[str]:
    return sorted(set(_PLUGIN.findall(_dependency_text(repo))))


_REQUIREMENTS = ("requirements.txt", "requirements-dev.txt", "requirements-test.txt")
_UV_PIP_INSTALL = ("uv", "pip", "install", "--python", ".venv", "--quiet")

_VCS_VERSIONING = re.compile(
    r"setuptools[-_]scm|hatch-vcs|versioningit|setuptools-git-versioning|"
    r"poetry-dynamic-versioning|dunamai",
    re.IGNORECASE,
)


def versions_from_git(repo: Path) -> bool:
    """Whether the package takes its version from git tags (setuptools-scm and kin).

    A shallow clone has no tags, so such a package installs as 0.1.dev0 and any
    test that checks the version fails for a reason that is not in the repository.
    """
    text = "\n".join(_read(repo / name) for name in ("pyproject.toml", "setup.cfg", "setup.py"))
    return bool(_VCS_VERSIONING.search(text))


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return ""


def _uses_pytest(repo: Path) -> bool:
    """Whether the project runs its tests with pytest, from its own files."""
    if (repo / "pytest.ini").is_file() or any(
        (repo / folder / "conftest.py").is_file() for folder in (".", "tests", "test")
    ):
        return True
    config = "\n".join(_read(repo / name) for name in ("pyproject.toml", "setup.cfg", "tox.ini"))
    if re.search(r"^\[(?:tool\.pytest\.ini_options|tool:pytest|pytest)\]", config, re.MULTILINE):
        return True
    declared = _dependency_text(repo) + "\n".join(
        _read(repo / name)
        for name in (
            "requirements.txt",
            "requirements-dev.txt",
            "requirements-test.txt",
            "noxfile.py",
        )
    )
    return re.search(r"\bpytest\b", declared) is not None


def _python_plan(repo: Path) -> ProjectPlan:
    install: list[str] = list(_UV_PIP_INSTALL)
    pyproject = repo / "pyproject.toml"
    if pyproject.is_file() or (repo / "setup.py").is_file():
        install += ["-e", "."]
    for group in _python_groups(pyproject):
        install += ["--group", group]
    for req in _REQUIREMENTS:
        if (repo / req).is_file():
            install += ["-r", req]
    has_dependencies = len(install) > len(_UV_PIP_INSTALL)
    # --allow-existing: a second install (after a fix to the dependency config)
    # updates the venv instead of failing because it exists.
    venv = ("uv", "venv", ".venv", "--quiet", "--allow-existing", "--python", _PYTHON)
    if _uses_pytest(repo):
        # pytest is the runner, so it is always installed; plugins only when
        # the project's dependency config names them.
        install += ["pytest", *_pytest_plugins(repo)]
        return ProjectPlan(
            language="python",
            runner="pytest",
            install_steps=(venv, tuple(install)),
            test_args=(".venv/bin/python", "-m", "pytest", *_PYTEST_ARGS),
        )
    # A project with nothing to install still needs its venv to run unittest.
    steps = (venv, tuple(install)) if has_dependencies else (venv,)
    return ProjectPlan(
        language="python",
        runner="unittest",
        install_steps=steps,
        test_args=(".venv/bin/python", "-m", "unittest", "discover", "-v"),
    )


# A script npm writes into a new package.json; it is not a test suite.
_PLACEHOLDER_TEST = re.compile(r"no test specified")


def _node_manager(repo: Path, manifest: dict[str, object]) -> str:
    declared = manifest.get("packageManager")
    if isinstance(declared, str) and declared.split("@", 1)[0] in ("pnpm", "yarn", "bun", "npm"):
        return declared.split("@", 1)[0]
    for lockfile, manager in (
        ("pnpm-lock.yaml", "pnpm"),
        ("bun.lock", "bun"),
        ("bun.lockb", "bun"),
        ("yarn.lock", "yarn"),
    ):
        if (repo / lockfile).is_file():
            return manager
    return "npm"


def _node_plan(repo: Path) -> ProjectPlan:
    try:
        manifest = json.loads((repo / "package.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise UnsupportedProjectError(f"package.json could not be read: {exc}") from exc
    script = manifest.get("scripts", {}).get("test")
    if not isinstance(script, str) or _PLACEHOLDER_TEST.search(script):
        raise UnsupportedProjectError("package.json has no `test` script.")
    manager = _node_manager(repo, manifest)
    install: tuple[str, ...]
    if manager == "pnpm":
        locked = (repo / "pnpm-lock.yaml").is_file()
        install = ("pnpm", "install", *(["--frozen-lockfile"] if locked else []))
        test: tuple[str, ...] = ("pnpm", "test")
    elif manager == "yarn":
        berry = (repo / ".yarnrc.yml").is_file()
        install = ("yarn", "install", "--immutable" if berry else "--frozen-lockfile")
        test = ("yarn", "test")
    elif manager == "bun":
        install, test = ("bun", "install", "--frozen-lockfile"), ("bun", "run", "test")
    elif (repo / "package-lock.json").is_file() or (repo / "npm-shrinkwrap.json").is_file():
        install, test = ("npm", "ci"), ("npm", "test")
    else:
        install, test = ("npm", "install"), ("npm", "test")
    return ProjectPlan(language="node", runner="script", install_steps=(install,), test_args=test)


def _go_plan() -> ProjectPlan:
    return ProjectPlan(
        language="go",
        runner="go",
        install_steps=(("go", "mod", "download"),),
        test_args=("go", "test", "./..."),
    )


def _rust_plan() -> ProjectPlan:
    return ProjectPlan(
        language="rust",
        runner="cargo",
        install_steps=(("cargo", "fetch"),),
        test_args=("cargo", "test"),
    )


def detect(repo: Path) -> ProjectPlan:
    """The first ecosystem whose manifest is at the repository root."""
    if any((repo / f).is_file() for f in ("pyproject.toml", "setup.py", "requirements.txt")):
        return _python_plan(repo)
    if (repo / "package.json").is_file():
        return _node_plan(repo)
    if (repo / "go.mod").is_file():
        return _go_plan()
    if (repo / "Cargo.toml").is_file():
        return _rust_plan()
    raise UnsupportedProjectError(
        "No supported project at the repository root: looked for pyproject.toml, setup.py, "
        "requirements.txt, package.json, go.mod and Cargo.toml."
    )
