from __future__ import annotations

import pytest
from google.adk.tools.base_toolset import BaseToolset

from conftest import CONTAINER_ID, FakeSkillsClient, client, skill_set


@pytest.mark.asyncio
async def test_native_toolset_loads_registry_and_preserves_order(tmp_path) -> None:
    from copilotkit_intelligence_adk import SkillRegistry, SkillToolset

    skills = FakeSkillsClient()
    skills.get_outcomes.append(skill_set(tmp_path, texts=("# First\n", "# Second\n")))
    registry = SkillRegistry(client(skills), CONTAINER_ID)
    toolset = SkillToolset(registry)

    assert isinstance(toolset, BaseToolset)
    tools = await toolset.get_tools()
    assert [tool.record.position for tool in tools] == [0, 1]
    assert [tool.record.text for tool in tools] == ["# First\n", "# Second\n"]
    assert len(skills.get_calls) == 1


@pytest.mark.asyncio
async def test_toolset_captures_one_immutable_snapshot_per_invocation(tmp_path) -> None:
    from copilotkit_intelligence_adk import SkillRegistry, SkillToolset

    skills = FakeSkillsClient()
    skills.get_outcomes.extend(
        [
            skill_set(tmp_path / "one", texts=("# One\n",)),
            skill_set(
                tmp_path / "two", texts=("# Two\n",), registry_revision="revision-2"
            ),
        ]
    )
    registry = SkillRegistry(client(skills), CONTAINER_ID, refresh_interval=0)
    toolset = SkillToolset(registry)
    first_tools = await toolset.get_tools()
    await registry.load()

    assert first_tools[0].record.text == "# One\n"
    assert registry.snapshot.skills[0].text == "# Two\n"


@pytest.mark.asyncio
async def test_toolset_returns_authorized_empty_native_value(tmp_path) -> None:
    from copilotkit_intelligence_adk import SkillRegistry, SkillToolset

    for revoked in (False, True):
        skills = FakeSkillsClient()
        skills.get_outcomes.append(
            skill_set(tmp_path / str(revoked), texts=(), revoked=revoked)
        )
        toolset = SkillToolset(SkillRegistry(client(skills), CONTAINER_ID))
        assert await toolset.get_tools() == []


def test_toolset_source_has_no_transport_or_process_ownership() -> None:
    import inspect
    import copilotkit_intelligence_adk.toolset as module

    source = inspect.getsource(module)
    assert "subprocess" not in source
    assert "urllib" not in source
    assert "httpx" not in source
    assert "requests" not in source
