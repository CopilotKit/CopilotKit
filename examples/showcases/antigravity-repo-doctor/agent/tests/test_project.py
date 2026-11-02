import json
import sys
from pathlib import Path

import pytest

from repo_doctor.project import UnsupportedProjectError, detect, versions_from_git

PY = f"{sys.version_info.major}.{sys.version_info.minor}"


def test_python_project_with_test_groups(tmp_path: Path) -> None:
    (tmp_path / "pyproject.toml").write_text(
        '[project]\nname = "x"\n[dependency-groups]\ntest = ["pytest"]\nlint = ["ruff"]\ndev = []\n'
    )

    plan = detect(tmp_path)

    assert plan.runner == "pytest"
    assert plan.install_command == (
        f"uv venv .venv --quiet --allow-existing --python {PY} && "
        "uv pip install --python .venv --quiet -e . --group test --group dev pytest"
    )
    assert plan.test_command == "pytest"
    assert any(arg.startswith("--junitxml=.git/") for arg in plan.test_args)


def test_pytest_plugins_named_in_tox_config_are_installed(tmp_path: Path) -> None:
    (tmp_path / "pyproject.toml").write_text(
        '[project]\nname = "x"\n[tool.tox]\nlegacy_tox_ini = """\n'
        "[core]\ndeps=\n    pytest\n    pytest-timeout\n    pytest-asyncio\n"
        '"""\n'
    )

    plan = detect(tmp_path)

    assert plan.install_command.endswith("pytest pytest-asyncio pytest-timeout")


def test_requirements_only_project_without_pytest_uses_unittest(tmp_path: Path) -> None:
    (tmp_path / "requirements.txt").write_text("requests\n")

    plan = detect(tmp_path)

    assert plan.runner == "unittest"
    assert "-r requirements.txt" in plan.install_command
    assert "-e ." not in plan.install_command
    assert "pytest" not in plan.install_command
    assert plan.test_command == "python -m unittest discover -v"


def test_a_conftest_means_pytest(tmp_path: Path) -> None:
    (tmp_path / "setup.py").write_text("")
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "conftest.py").write_text("")

    assert detect(tmp_path).runner == "pytest"


def test_pytest_config_section_means_pytest(tmp_path: Path) -> None:
    (tmp_path / "pyproject.toml").write_text('[project]\nname = "x"\n[tool.pytest.ini_options]\n')

    plan = detect(tmp_path)

    assert plan.runner == "pytest"
    assert plan.install_command.endswith("-e . pytest")


@pytest.mark.parametrize(
    ("lockfile", "install", "test"),
    [
        ("pnpm-lock.yaml", "pnpm install --frozen-lockfile", "pnpm test"),
        ("package-lock.json", "npm ci", "npm test"),
        ("yarn.lock", "yarn install --frozen-lockfile", "yarn test"),
        ("bun.lock", "bun install --frozen-lockfile", "bun run test"),
        (None, "npm install", "npm test"),
    ],
)
def test_node_project(tmp_path: Path, lockfile: str | None, install: str, test: str) -> None:
    (tmp_path / "package.json").write_text(json.dumps({"scripts": {"test": "vitest run"}}))
    if lockfile:
        (tmp_path / lockfile).write_text("")

    plan = detect(tmp_path)

    assert (plan.install_command, plan.test_command) == (install, test)


def test_package_manager_field_wins_over_lockfiles(tmp_path: Path) -> None:
    (tmp_path / "package.json").write_text(
        json.dumps({"packageManager": "pnpm@10.0.0", "scripts": {"test": "node --test"}})
    )
    (tmp_path / "package-lock.json").write_text("")

    plan = detect(tmp_path)

    assert (plan.install_command, plan.test_command) == ("pnpm install", "pnpm test")


@pytest.mark.parametrize("scripts", [{}, {"test": 'echo "Error: no test specified" && exit 1'}])
def test_node_project_without_a_real_test_script(tmp_path: Path, scripts: dict[str, str]) -> None:
    (tmp_path / "package.json").write_text(json.dumps({"scripts": scripts}))

    with pytest.raises(UnsupportedProjectError, match="no `test` script"):
        detect(tmp_path)


def test_go_module(tmp_path: Path) -> None:
    (tmp_path / "go.mod").write_text("module example.com/x\n")

    plan = detect(tmp_path)

    assert (plan.install_command, plan.test_command) == ("go mod download", "go test ./...")


def test_rust_crate(tmp_path: Path) -> None:
    (tmp_path / "Cargo.toml").write_text('[package]\nname = "x"\n')

    plan = detect(tmp_path)

    assert (plan.install_command, plan.test_command) == ("cargo fetch", "cargo test")


def test_unknown_project(tmp_path: Path) -> None:
    with pytest.raises(UnsupportedProjectError):
        detect(tmp_path)


def test_versions_from_git(tmp_path: Path) -> None:
    (tmp_path / "pyproject.toml").write_text(
        '[build-system]\nrequires = ["setuptools>=42", "setuptools-scm[toml]>=3.4"]\n'
    )
    assert versions_from_git(tmp_path)
    (tmp_path / "pyproject.toml").write_text('[build-system]\nrequires = ["hatchling"]\n')
    assert not versions_from_git(tmp_path)
