"""Memory results expose native annotations without changing wire values."""

from typing import TYPE_CHECKING, assert_type, get_type_hints, is_typeddict

import httpx
import pytest

import copilotkit_intelligence as sdk

if TYPE_CHECKING:

    async def memory_result_type_contract(client: sdk.Intelligence) -> None:
        """Make mypy verify inferred result fields at SDK call sites."""
        listed = await client.list_memories(user_id="user-1")
        assert_type(listed, sdk.ListMemoriesResponse)
        assert_type(listed["memories"][0], sdk.MemorySummary)
        assert_type(listed["memories"][0]["content"], str)
        recalled = await client.recall_memories(user_id="user-1", query="language")
        assert_type(recalled, sdk.RecallMemoriesResponse)
        assert_type(recalled["memories"][0].get("score"), float | None)
        created = await client.create_memory(user_id="user-1", content="Python", kind="topical")
        assert_type(created, sdk.SaveMemoryResponse)
        assert_type(created.get("absorbed"), bool | None)
        updated = await client.update_memory(
            user_id="user-1", memory_id="memory-1", content="Python", kind="topical"
        )
        assert_type(updated, sdk.SaveMemoryResponse)
        assert_type(updated.get("retiredId"), str | None)
        assert_type(updated["invalidatedAt"], str | None)


@pytest.mark.parametrize(
    ("method", "result_name"),
    [
        ("list_memories", "ListMemoriesResponse"),
        ("recall_memories", "RecallMemoriesResponse"),
        ("create_memory", "SaveMemoryResponse"),
        ("update_memory", "SaveMemoryResponse"),
    ],
)
def test_memory_methods_expose_public_result_types(method: str, result_name: str) -> None:
    result_type = get_type_hints(getattr(sdk.Intelligence, method))["return"]

    assert is_typeddict(result_type), "Memory results must expose their fields to type checkers"
    assert result_type is getattr(sdk, result_name)
    assert result_name in sdk.__all__


def test_memory_summary_distinguishes_optional_and_nullable_fields() -> None:
    summary = getattr(sdk, "MemorySummary", None)

    assert summary is not None
    assert is_typeddict(summary), "The SDK must export MemorySummary"
    assert summary.__required_keys__ == {
        "id",
        "kind",
        "scope",
        "content",
        "sourceThreadIds",
        "invalidatedAt",
    }
    assert summary.__optional_keys__ == {"score"}
    assert get_type_hints(summary)["invalidatedAt"] == str | None
    saved = sdk.SaveMemoryResponse
    assert saved.__optional_keys__ == {"score", "absorbed", "retiredId"}


@pytest.mark.parametrize(
    "method", ["list_memories", "recall_memories", "create_memory", "update_memory"]
)
async def test_memory_results_preserve_dictionary_fields(method: str) -> None:
    memory = {
        "id": "memory-1",
        "kind": "topical",
        "scope": "user",
        "content": "Use Python",
        "sourceThreadIds": ["thread-1"],
        "invalidatedAt": None,
        "score": 0.8,
        "absorbed": False,
        "retiredId": "memory-0",
        "extension": {"retained": True},
    }
    expected = (
        {"memories": [memory], "extension": True}
        if method in ("list_memories", "recall_memories")
        else memory
    )
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=expected))
    async with httpx.AsyncClient(transport=transport) as http:
        async with sdk.Intelligence(api_key="test-key", http_client=http) as client:
            arguments = {"user_id": "user-1"}
            if method == "recall_memories":
                arguments["query"] = "language"
            if method in ("create_memory", "update_memory"):
                arguments.update(content="Use Python", kind="topical")
            if method == "update_memory":
                arguments["memory_id"] = "memory-0"
            result = await getattr(client, method)(**arguments)

    assert type(result) is dict
    assert result == expected
