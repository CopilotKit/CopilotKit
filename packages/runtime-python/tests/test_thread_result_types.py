"""Public thread types retain the platform's JSON response shapes."""

from typing import TYPE_CHECKING, Any, assert_type, get_args, get_type_hints, is_typeddict

import httpx
import pytest

import copilotkit_intelligence as sdk

if TYPE_CHECKING:

    async def thread_result_type_contract(client: sdk.Intelligence) -> None:
        """Verify inferred resource types and state narrowing at SDK call sites."""
        listed = await client.list_threads(user_id="u1", agent_id="a1")
        assert_type(listed, sdk.ListThreadsResponse)
        assert_type(listed.get("nextCursor"), str | None)
        thread = await client.get_thread(thread_id="t1", user_id="u1")
        assert_type(thread, sdk.ThreadSummary)
        assert_type(thread["name"], str | None)
        created = await client.create_thread(thread_id="t1", user_id="u1", agent_id="a1")
        assert_type(created, sdk.ThreadSummary)
        updated = await client.update_thread(
            thread_id="t1", user_id="u1", agent_id="a1", updates={"name": "New name"}
        )
        assert_type(updated, sdk.ThreadSummary)
        resolved = await client.get_or_create_thread(thread_id="t1", user_id="u1", agent_id="a1")
        assert_type(resolved, sdk.ThreadResolution)
        assert_type(resolved["created"], bool)
        messages = await client.get_thread_messages(thread_id="t1", user_id="u1")
        assert_type(messages["messages"][0], sdk.ThreadMessage)
        assert_type(messages["messages"][0].get("content"), object)
        events = await client.get_thread_events(thread_id="t1")
        assert_type(events, sdk.ThreadEventsResponse)
        assert_type(events["events"][0]["type"], str)
        state = await client.get_thread_state(thread_id="t1")
        if state["kind"] == "snapshot":
            assert_type(state, sdk.ThreadSnapshot)
            assert_type(state["state"], object)
            assert_type(state["skippedDeltas"], int)
        elif state["kind"] == "no-snapshot":
            assert_type(state, sdk.ThreadNoSnapshot)
        else:
            assert_type(state, sdk.ThreadSnapshotDecodeError)
        annotation = await client.annotate(thread_id="t1", user_id="u1", annotation_type="feedback")
        assert_type(annotation, sdk.AnnotateResponse)
        assert_type(annotation["id"], str)
        assert_type(annotation["duplicate"], bool)


@pytest.mark.parametrize(
    ("method", "name"),
    [
        ("list_threads", "ListThreadsResponse"),
        ("get_thread", "ThreadSummary"),
        ("create_thread", "ThreadSummary"),
        ("update_thread", "ThreadSummary"),
        ("get_or_create_thread", "ThreadResolution"),
        ("get_thread_messages", "ThreadMessagesResponse"),
        ("get_thread_events", "ThreadEventsResponse"),
        ("annotate", "AnnotateResponse"),
    ],
)
def test_thread_methods_expose_public_result_types(method: str, name: str) -> None:
    result = get_type_hints(getattr(sdk.Intelligence, method))["return"]

    assert is_typeddict(result), "Resource results must expose field types"
    assert result is getattr(sdk, name)
    assert name in sdk.__all__


def test_thread_state_exposes_three_discriminated_results() -> None:
    result = get_type_hints(sdk.Intelligence.get_thread_state)["return"]
    variants = get_args(result)

    assert len(variants) == 3, "State needs separate absent, invalid, and snapshot types"
    assert result is sdk.ThreadStateResponse
    kinds = {get_args(get_type_hints(variant)["kind"])[0]: variant for variant in variants}
    assert kinds["no-snapshot"].__required_keys__ == {"kind"}
    assert kinds["snapshot-decode-error"].__required_keys__ == {"kind"}
    assert kinds["snapshot"].__required_keys__ == {"kind", "state", "skippedDeltas"}


@pytest.mark.parametrize(
    ("method", "arguments", "response"),
    [
        (
            "get_thread",
            {"thread_id": "t1", "user_id": "u1"},
            {"thread": {"id": "t1", "name": None, "extension": {"kept": True}}},
        ),
        (
            "get_thread_messages",
            {"thread_id": "t1", "user_id": "u1"},
            {
                "messages": [
                    {
                        "id": "m1",
                        "role": "activity",
                        "activityType": "a2ui-surface",
                        "content": {"surfaceId": "s1"},
                        "extension": [1, None],
                    }
                ]
            },
        ),
        (
            "get_thread_events",
            {"thread_id": "t1"},
            {
                "events": [{"type": "CUSTOM", "name": "extension", "value": {"x": 1}}],
                "decodeErrorRowIds": ["row-1"],
                "truncated": True,
            },
        ),
        (
            "get_thread_state",
            {"thread_id": "t1"},
            {"kind": "snapshot", "state": [None, {"nested": True}], "skippedDeltas": 2},
        ),
        ("get_thread_state", {"thread_id": "t1"}, {"kind": "no-snapshot"}),
        ("get_thread_state", {"thread_id": "t1"}, {"kind": "snapshot-decode-error"}),
        (
            "annotate",
            {"thread_id": "t1", "user_id": "u1", "annotation_type": "feedback"},
            {"id": "9223372036854775807", "duplicate": True, "extension": {"kept": True}},
        ),
    ],
)
async def test_resource_types_preserve_json_values(
    method: str, arguments: dict[str, Any], response: dict[str, Any]
) -> None:
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=response))
    async with httpx.AsyncClient(transport=transport) as http:
        async with sdk.Intelligence(api_key="test-key", http_client=http) as client:
            result = await getattr(client, method)(**arguments)

    assert type(result) is dict
    assert result == (response["thread"] if method == "get_thread" else response)
