import asyncio
from unittest.mock import AsyncMock

import pytest
from conftest import response
from copilotkit_intelligence import Intelligence, LearnedSkillsError

from _delivery.registry import Registry


async def test_qualified_union_ignores_legacy_environment_and_copies_sources(monkeypatch):
    monkeypatch.setenv("CPK_INTELLIGENCE_LEARNING_CONTAINER_ID", "ignored")
    monkeypatch.setenv("CPK_INTELLIGENCE_SKILLS_REVISION", "ignored")
    client = AsyncMock(spec=Intelligence)
    client.get_learned_skills_snapshot.return_value = response()
    sources = [{"id": "support/é %", "revision": "r1"}, {"id": "company"}]
    registry = Registry(client=client, containers=sources)
    sources[0]["id"] = "changed"
    sources.append({"id": "extra"})
    snapshot = await registry.acquire_snapshot()
    assert [skill.name for skill in snapshot.skills] == [
        "company/refund-policy",
        "support%2F%C3%A9%20%25/refund-policy",
    ]
    calls = client.get_learned_skills_snapshot.call_args_list
    assert [(call.kwargs["container_id"], call.kwargs["revision"]) for call in calls] == [
        ("support/é %", "r1"),
        ("company", None),
    ]
    assert registry.status.mode == "latest"
    assert [item.id for item in registry.status.containers] == ["support/é %", "company"]
    await registry.aclose()
    client.aclose.assert_not_awaited()


@pytest.mark.parametrize(
    "options",
    [
        {"containers": []},
        {"containers": [{"id": " "}]},
        {"containers": [{"id": "a"}, {"id": "a"}]},
        {"containers": [{"id": "a", "revision": ""}]},
        {"containers": [{"id": "a"}], "container_id": "legacy"},
        {"containers": [{"id": "a"}], "revision": "r1"},
    ],
)
def test_invalid_multi_config(options):
    with pytest.raises(LearnedSkillsError) as error:
        Registry(client=AsyncMock(spec=Intelligence), **options)
    assert error.value.code == "INVALID_CONFIG"


async def test_per_container_etags_warm_fallback_and_denial():
    client = AsyncMock(spec=Intelligence)
    replies = {"a": response(), "b": response()}

    async def fetch(**kwargs):
        reply = replies[kwargs["container_id"]]
        if isinstance(reply, Exception):
            raise reply
        return reply

    client.get_learned_skills_snapshot.side_effect = fetch
    registry = Registry(client=client, containers=[{"id": "a"}, {"id": "b"}], freshness_window=0)
    original = await registry.acquire_snapshot()
    replies["a"] = response("empty-r2")
    replies["b"] = LearnedSkillsError("NETWORK_ERROR", True)
    updated = await registry.acquire_snapshot()
    assert [s.name for s in updated.skills] == ["b/refund-policy"]
    assert len(original.skills) == 2
    assert registry.status.stale
    assert all(
        call.kwargs["if_none_match"] == response()["etag"]
        for call in client.get_learned_skills_snapshot.call_args_list[2:]
    )
    replies["b"] = LearnedSkillsError("AUTHORIZATION_FAILED", False)
    with pytest.raises(LearnedSkillsError):
        await registry.acquire_snapshot()
    replies["b"] = LearnedSkillsError("NETWORK_ERROR", True)
    with pytest.raises(LearnedSkillsError) as error:
        await registry.acquire_snapshot()
    assert error.value.code == "AUTHORIZATION_FAILED"


async def test_cold_member_failure_never_returns_partial_snapshot():
    client = AsyncMock(spec=Intelligence)
    client.get_learned_skills_snapshot.side_effect = [
        response(),
        LearnedSkillsError("NETWORK_ERROR", True),
    ]
    registry = Registry(client=client, containers=[{"id": "a"}, {"id": "b"}])
    with pytest.raises(LearnedSkillsError):
        await registry.acquire_snapshot()
    assert not registry.status.initialized


async def test_cancelled_waiter_does_not_cancel_shared_children():
    client = AsyncMock(spec=Intelligence)
    entered, release = asyncio.Event(), asyncio.Event()

    async def fetch(**kwargs):
        entered.set()
        await release.wait()
        return response()

    client.get_learned_skills_snapshot.side_effect = fetch
    registry = Registry(client=client, containers=[{"id": "a", "revision": "r1"}])
    first = asyncio.create_task(registry.acquire_snapshot())
    second = asyncio.create_task(registry.acquire_snapshot())
    await entered.wait()
    first.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first
    release.set()
    assert (await second).skills[0].name == "a/refund-policy"
    assert registry.status.mode == "pinned"
    assert client.get_learned_skills_snapshot.await_count == 1


async def test_multi_status_is_flat_and_does_not_expose_composite_as_server_revision():
    client = AsyncMock(spec=Intelligence)
    client.get_learned_skills_snapshot.return_value = response()
    registry = Registry(client=client, containers=[{"id": "one", "revision": "r1"}])
    snapshot = await registry.acquire_snapshot()
    status = registry.status
    assert status.revision is None
    assert status.containers[0].revision == "r1"
    assert status.containers[0].initialized
    assert snapshot.revision.startswith("composite:")


@pytest.mark.parametrize("source", [{"id": "a", "revision": "   "}, {"id": "bad\ud800"}])
def test_multi_rejects_blank_pin_and_malformed_unicode_before_client_creation(source, monkeypatch):
    from unittest.mock import Mock

    from _delivery import config

    create = Mock()
    monkeypatch.setattr(config, "Intelligence", create)
    with pytest.raises(LearnedSkillsError) as error:
        Registry(api_key="test", containers=[source])
    assert error.value.code == "INVALID_CONFIG"
    create.assert_not_called()
