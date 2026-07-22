from __future__ import annotations

from pathlib import Path

import toml


def test_package_metadata_and_boundaries() -> None:
    root = Path(__file__).resolve().parents[1]
    metadata = toml.loads((root / "pyproject.toml").read_text(encoding="utf-8"))
    poetry = metadata["tool"]["poetry"]
    dependencies = poetry["dependencies"]

    assert poetry["name"] == "copilotkit-intelligence-agent-framework"
    assert poetry["version"] == "0.1.0"
    assert dependencies["python"] == ">=3.10"
    assert dependencies["copilotkit"] == ">=0.1.95,<1.0.0"
    assert dependencies["agent-framework-core"] == ">=1.11.0,<2.0.0"
    assert (root / "README.md").is_file()
    assert (root / "LICENSE").is_file()
    assert (root / "src/copilotkit_intelligence_agent_framework/py.typed").is_file()


def test_runtime_owns_no_transport_process_or_agent_wrapper() -> None:
    root = Path(__file__).resolve().parents[1] / "src"
    source = "\n".join(path.read_text(encoding="utf-8") for path in root.rglob("*.py"))
    for forbidden in ("subprocess", "urllib", "httpx", "requests", "class Agent"):
        assert forbidden not in source
