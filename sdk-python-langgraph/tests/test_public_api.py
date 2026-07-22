from __future__ import annotations

from pathlib import Path

from langchain.agents import create_agent
from langchain.agents.middleware import AgentMiddleware
from langchain_core.language_models.fake_chat_models import FakeListChatModel


ROOT = Path(__file__).resolve().parents[1]


def test_camel_and_snake_case_exports_are_identical() -> None:
    import copilotkit_intelligence_langgraph as package

    assert (
        package.createSkillRegistryMiddleware
        is package.create_skill_registry_middleware
    )
    assert package.__all__ == [
        "createSkillRegistryMiddleware",
        "create_skill_registry_middleware",
    ]


def test_readme_and_public_api_contract() -> None:
    import copilotkit_intelligence_langgraph as package

    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    headings = (
        "Installation",
        "Native registration",
        "Lifecycle and preload",
        "Fresh and cached data",
        "Limits and scripts",
        "Telemetry",
        "Errors",
        "Closing",
        "Compatibility",
        "Ownership and release",
    )
    assert all(f"## {heading}" in readme for heading in headings)
    normative = (
        "create_skill_registry_middleware is the Python spelling of the "
        "normative createSkillRegistryMiddleware API."
    )
    assert normative in readme
    module_text = (
        ROOT / "src/copilotkit_intelligence_langgraph/__init__.py"
    ).read_text(encoding="utf-8")
    assert normative in module_text

    middleware = package.createSkillRegistryMiddleware(object(), "container")
    assert isinstance(middleware, AgentMiddleware)
    agent = create_agent(
        FakeListChatModel(responses=["ok"]),
        middleware=[middleware],
    )
    assert agent is not None
