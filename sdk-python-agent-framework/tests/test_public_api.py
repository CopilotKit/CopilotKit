from __future__ import annotations

import importlib.metadata
from pathlib import Path
from types import SimpleNamespace

import toml
from agent_framework import BaseAgent, ContextProvider


def test_readme_and_public_api_contract() -> None:
    import copilotkit_intelligence_agent_framework as package

    root = Path(__file__).resolve().parents[1]
    readme = (root / "README.md").read_text(encoding="utf-8")
    headings = [
        "## Installation",
        "## Native registration",
        "## Lifecycle and preload",
        "## Fresh and cached data",
        "## Limits and scripts",
        "## Telemetry",
        "## Errors",
        "## Closing",
        "## Compatibility",
        "## Ownership and release",
    ]
    assert [line for line in readme.splitlines() if line.startswith("## ")] == headings
    assert package.__all__ == ["SkillRegistryContextProvider"]
    exported: dict[str, object] = {}
    exec("from copilotkit_intelligence_agent_framework import *", {}, exported)
    assert set(exported) == {"SkillRegistryContextProvider"}

    client = SimpleNamespace(skills=SimpleNamespace())
    provider = package.SkillRegistryContextProvider(client, "container")
    agent = BaseAgent(name="smoke", context_providers=[provider])
    assert isinstance(provider, ContextProvider)
    assert agent.context_providers == [provider]
    assert "context_providers=[provider]" in readme


def test_adapter_version_matches_distribution_metadata() -> None:
    from copilotkit_intelligence_agent_framework._registry_state import _ADAPTER_VERSION

    try:
        expected = importlib.metadata.version("copilotkit-intelligence-agent-framework")
    except importlib.metadata.PackageNotFoundError:
        root = Path(__file__).resolve().parents[1]
        expected = toml.loads((root / "pyproject.toml").read_text(encoding="utf-8"))[
            "tool"
        ]["poetry"]["version"]
    assert _ADAPTER_VERSION == expected
