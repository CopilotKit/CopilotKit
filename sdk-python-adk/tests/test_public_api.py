from __future__ import annotations

from pathlib import Path


def test_readme_and_public_api_contract() -> None:
    import copilotkit_intelligence_adk as package
    from google.adk.agents import LlmAgent
    from google.adk.tools.base_toolset import BaseToolset

    readme = (Path(__file__).resolve().parents[1] / "README.md").read_text(
        encoding="utf-8"
    )
    headings = (
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
    )
    assert package.__all__ == ["SkillRegistry", "SkillToolset"]
    assert [line for line in readme.splitlines() if line.startswith("## ")] == list(
        headings
    )
    for required in (
        "copilotkit-intelligence-adk",
        "google-adk>=2.0.0,<3.0.0",
        "copilotkit>=0.1.95,<1.0.0",
        "SkillRegistry",
        "SkillToolset",
        "preload_cached",
        "LEARNING_REGISTRY_CLOSED",
        "128",
        "262144",
        "1048576",
    ):
        assert required in readme

    class Skills:
        async def get(self, learning_container_id):  # pragma: no cover - smoke only
            del learning_container_id

        async def get_cached(self, learning_container_id):  # pragma: no cover
            del learning_container_id

    client = type("Client", (), {"skills": Skills()})()
    registry = package.SkillRegistry(client, "container-id")
    toolset = package.SkillToolset(registry)
    agent = LlmAgent(name="skill_agent", tools=[toolset])
    assert isinstance(toolset, BaseToolset)
    assert agent.tools == [toolset]
