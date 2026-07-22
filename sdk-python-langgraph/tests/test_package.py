from __future__ import annotations

import ast
import importlib.metadata
import json
from pathlib import Path

import toml

from conftest import declared_contract_fields


ROOT = Path(__file__).resolve().parents[1]
CORPUS_PATH = (
    ROOT.parent / "packages/intelligence/conformance/registry-adapters-v1.json"
)


def _runner_consumed_contract_fields(source: str) -> set[str]:
    tree = ast.parse(source)
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        if any(
            isinstance(target, ast.Name) and target.id == "CONSUMED_CONTRACT_FIELDS"
            for target in node.targets
        ):
            return set(ast.literal_eval(node.value))
    return set()


def test_package_metadata_and_contents() -> None:
    metadata = toml.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    poetry = metadata["tool"]["poetry"]
    dependencies = poetry["dependencies"]
    assert poetry["name"] == "copilotkit-intelligence-langgraph"
    assert poetry["version"] == "0.1.0"
    assert poetry["license"] == "MIT"
    assert poetry["packages"] == [
        {"include": "copilotkit_intelligence_langgraph", "from": "src"}
    ]
    assert dependencies == {
        "python": ">=3.10",
        "copilotkit": ">=0.1.95,<1.0.0",
        "langgraph": ">=1.2.2,<2.0.0",
        "langchain": ">=1.3.2,<2.0.0",
    }
    assert (ROOT / "README.md").is_file()
    assert (ROOT / "LICENSE").is_file()
    assert (ROOT / "src/copilotkit_intelligence_langgraph/py.typed").is_file()


def test_runtime_owns_no_transport_archive_process_or_agent_builder() -> None:
    forbidden = {"httpx", "requests", "urllib", "zipfile", "tarfile", "subprocess"}
    source_root = ROOT / "src/copilotkit_intelligence_langgraph"
    imported: set[str] = set()
    for path in source_root.glob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update(alias.name.split(".", 1)[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.add(node.module.split(".", 1)[0])
    assert imported.isdisjoint(forbidden)
    assert not any(
        path.name in {"agent.py", "builder.py"} for path in source_root.glob("*.py")
    )


def test_telemetry_version_resolves_distribution_and_source_fallback(
    monkeypatch,
) -> None:
    from copilotkit_intelligence_langgraph import _registry_state

    metadata = toml.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    package_version = metadata["tool"]["poetry"]["version"]

    monkeypatch.setattr(
        _registry_state.importlib.metadata,
        "version",
        lambda distribution: "9.8.7",
    )
    assert _registry_state._resolve_adapter_version() == "9.8.7"

    def missing(distribution: str) -> str:
        raise importlib.metadata.PackageNotFoundError(distribution)

    monkeypatch.setattr(_registry_state.importlib.metadata, "version", missing)
    assert _registry_state._resolve_adapter_version() == package_version


def test_conformance_runner_consumes_every_declared_contract_field() -> None:
    source = (ROOT / "tests/test_conformance.py").read_text(encoding="utf-8")
    corpus = json.loads(CORPUS_PATH.read_text(encoding="utf-8"))

    assert _runner_consumed_contract_fields(source) == declared_contract_fields(corpus)
