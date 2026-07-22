from __future__ import annotations

import ast
from pathlib import Path

import toml


ROOT = Path(__file__).resolve().parents[1]


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
