from __future__ import annotations

import ast
import importlib.metadata
from pathlib import Path

import toml


ROOT = Path(__file__).resolve().parents[1]


def test_package_metadata_and_contents() -> None:
    metadata = toml.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    poetry = metadata["tool"]["poetry"]
    dependencies = poetry["dependencies"]
    assert poetry["name"] == "copilotkit-intelligence-adk"
    assert poetry["version"] == "0.1.0"
    assert poetry["license"] == "MIT"
    assert poetry["packages"] == [
        {"include": "copilotkit_intelligence_adk", "from": "src"}
    ]
    assert dependencies == {
        "python": ">=3.10",
        "copilotkit": ">=0.1.95,<1.0.0",
        "google-adk": ">=2.0.0,<3.0.0",
    }
    assert (ROOT / "README.md").is_file()
    assert (ROOT / "LICENSE").is_file()
    assert (ROOT / "src/copilotkit_intelligence_adk/py.typed").is_file()


def test_runtime_owns_no_transport_archive_or_process() -> None:
    forbidden = {"httpx", "requests", "urllib", "zipfile", "tarfile", "subprocess"}
    source_root = ROOT / "src/copilotkit_intelligence_adk"
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
    from copilotkit_intelligence_adk import registry

    metadata = toml.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    package_version = metadata["tool"]["poetry"]["version"]

    monkeypatch.setattr(
        registry.importlib.metadata,
        "version",
        lambda distribution: "9.8.7",
    )
    assert registry._resolve_adapter_version() == "9.8.7"

    def missing(distribution: str) -> str:
        raise importlib.metadata.PackageNotFoundError(distribution)

    monkeypatch.setattr(registry.importlib.metadata, "version", missing)
    assert registry._resolve_adapter_version() == package_version
