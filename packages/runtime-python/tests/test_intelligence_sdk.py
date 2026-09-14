import importlib
import json
import subprocess
import sys

import httpx
import pytest


def sdk(handler):
    module = importlib.import_module("copilotkit_intelligence")
    transport = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return module.Intelligence(api_key="secret", api_url="https://platform", http_client=transport)


def test_sdk_import_does_not_load_runtime_or_asgi():
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import copilotkit_intelligence; import sys; "
            "assert 'copilotkit_runtime' not in sys.modules; assert 'starlette' not in sys.modules",
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr


async def test_sdk_creates_thread_with_learning_container_without_server():
    requests = []

    def platform(request):
        requests.append(request)
        return httpx.Response(200, json={"thread": {"id": "canonical", "name": "Support"}})

    client = sdk(platform)
    thread = await client.create_thread(
        thread_id="thread",
        user_id="customer",
        agent_id="support",
        name="Support",
        learning_container_id="support-quality",
    )

    assert thread["id"] == "canonical"
    assert json.loads(requests[0].content) == {
        "threadId": "thread",
        "userId": "customer",
        "agentId": "support",
        "name": "Support",
        "learningContainerId": "support-quality",
    }
    assert requests[0].headers["authorization"] == "Bearer secret"
    await client.http_client.aclose()


async def test_sdk_memory_operations_keep_identity_and_grants_explicit():
    requests = []

    def platform(request):
        requests.append(request)
        return httpx.Response(200, json={"memories": [], "id": "memory"})

    client = sdk(platform)
    grant = importlib.import_module("copilotkit_intelligence").MemoryGrant(
        user="read-write",
        project="read",
    )
    await client.list_memories(user_id="customer", memory_grant=grant, include_invalidated=True)
    await client.create_memory(user_id="customer", content="Prefers Python", kind="topical")
    await client.update_memory(
        user_id="customer", memory_id="id/with slash", content="Go", kind="topical"
    )
    await client.recall_memories(user_id="customer", query="language", limit=4, scope="user")
    await client.remove_memory(user_id="customer", memory_id="id/with slash")

    assert [request.method for request in requests] == ["GET", "POST", "PATCH", "POST", "DELETE"]
    assert all(request.headers["x-cpki-user-id"] == "customer" for request in requests)
    assert json.loads(requests[0].headers["x-cpki-memory-grant"]) == {
        "user": "read-write",
        "project": "read",
    }
    assert "x-cpki-memory-grant" not in requests[1].headers
    assert requests[0].content == b""
    assert requests[4].content == b""
    assert requests[2].url.raw_path == b"/api/memories/id%2Fwith%20slash"
    assert json.loads(requests[3].content) == {"query": "language", "limit": 4, "scope": "user"}
    await client.http_client.aclose()


async def test_sdk_get_or_create_resolves_conflict_with_scoped_read():
    requests = []

    def platform(request):
        requests.append(request)
        status = [404, 409, 200][len(requests) - 1]
        return httpx.Response(status, json={"thread": {"id": "existing"}})

    client = sdk(platform)
    result = await client.get_or_create_thread(
        thread_id="thread", user_id="customer", agent_id="agent"
    )

    assert result == {"thread": {"id": "existing"}, "created": False}
    assert [request.method for request in requests] == ["GET", "POST", "GET"]
    assert requests[2].url.params["userId"] == "customer"
    await client.http_client.aclose()


@pytest.mark.parametrize("status", [401, 403, 404, 429, 500, 503])
async def test_sdk_errors_preserve_status_without_private_response(status):
    client = sdk(lambda request: httpx.Response(status, text="private credential"))
    error_type = importlib.import_module("copilotkit_intelligence").IntelligenceError

    with pytest.raises(error_type) as error:
        await client.list_memories(user_id="customer")

    assert error.value.status == status
    assert "private credential" not in str(error.value)
    await client.http_client.aclose()


async def test_sdk_context_does_not_close_borrowed_http_client():
    client = sdk(lambda request: httpx.Response(200, json={"memories": []}))

    async with client:
        await client.list_memories(user_id="customer")

    assert not client.http_client.is_closed
    await client.http_client.aclose()


async def test_runtime_accepts_sdk_without_duplicated_credentials_and_does_not_own_it():
    from copilotkit_runtime import IntelligenceRuntime, User

    client = sdk(lambda request: httpx.Response(200, json={"memories": []}))
    runtime = IntelligenceRuntime(
        intelligence=client, agents={}, identify_user=lambda request: User("customer")
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=runtime), base_url="http://runtime"
    ) as browser:
        response = await browser.get("/copilotkit/memories")
    await runtime.aclose()

    assert response.status_code == 200
    assert not client.http_client.is_closed
    assert await client.list_memories(user_id="customer") == {"memories": []}
    await client.http_client.aclose()


@pytest.mark.parametrize(
    ("operation", "arguments", "method", "path"),
    [
        (
            "list_threads",
            {"user_id": "user", "agent_id": "agent", "cursor": "opaque", "limit": 7},
            "GET",
            "/api/threads",
        ),
        ("get_thread", {"user_id": "user", "thread_id": "thread"}, "GET", "/api/threads/thread"),
        (
            "update_thread",
            {
                "user_id": "user",
                "agent_id": "agent",
                "thread_id": "thread",
                "updates": {"name": "Name", "userId": "spoofed"},
            },
            "PATCH",
            "/api/threads/thread",
        ),
        (
            "archive_thread",
            {"user_id": "user", "agent_id": "agent", "thread_id": "thread"},
            "PATCH",
            "/api/threads/thread",
        ),
        (
            "delete_thread",
            {"user_id": "user", "agent_id": "agent", "thread_id": "thread"},
            "DELETE",
            "/api/threads/thread",
        ),
        (
            "get_thread_messages",
            {"user_id": "user", "thread_id": "thread"},
            "GET",
            "/api/threads/thread/messages",
        ),
        (
            "get_thread_events",
            {"thread_id": "thread"},
            "GET",
            "/api/_inspect/threads/thread/events",
        ),
        ("get_thread_state", {"thread_id": "thread"}, "GET", "/api/_inspect/threads/thread/state"),
        (
            "annotate",
            {
                "user_id": "user",
                "thread_id": "thread",
                "annotation_type": "user_action",
                "client_event_id": "event",
                "payload": {"action": "save"},
            },
            "PUT",
            "/connector/annotate/event",
        ),
    ],
)
async def test_sdk_resource_methods_use_platform_routes(operation, arguments, method, path):
    requests = []

    def platform(request):
        requests.append(request)
        return httpx.Response(200, json={"thread": {"id": "thread"}})

    client = sdk(platform)
    await getattr(client, operation)(**arguments)

    assert requests[0].method == method
    assert requests[0].url.path == path
    if method == "GET":
        assert requests[0].content == b""
    else:
        assert json.loads(requests[0].content)["userId"] == "user"
    if operation == "list_threads":
        assert dict(requests[0].url.params) == {
            "userId": "user",
            "agentId": "agent",
            "cursor": "opaque",
            "limit": "7",
        }
    if operation == "archive_thread":
        assert json.loads(requests[0].content)["archived"] is True
    await client.http_client.aclose()


@pytest.mark.parametrize("body", [None, [], "not an object"])
async def test_sdk_rejects_invalid_annotation_response(body):
    client = sdk(lambda request: httpx.Response(200, json=body))
    error_type = importlib.import_module("copilotkit_intelligence").IntelligenceError

    with pytest.raises(error_type) as error:
        await client.annotate(user_id="user", thread_id="thread", annotation_type="user_action")

    assert error.value.status == 502
    await client.http_client.aclose()


async def test_sdk_does_not_retry_mutations_or_follow_redirects():
    requests = []

    def platform(request):
        requests.append(request)
        return httpx.Response(307, headers={"location": "https://untrusted.example"})

    client = sdk(platform)
    error_type = importlib.import_module("copilotkit_intelligence").IntelligenceError
    with pytest.raises(error_type) as error:
        await client.create_memory(user_id="user", content="Fact", kind="topical")

    assert error.value.status == 307
    assert len(requests) == 1
    await client.http_client.aclose()


async def test_sdk_owned_pool_closes_and_invalid_grants_fail_before_io():
    module = importlib.import_module("copilotkit_intelligence")
    async with module.Intelligence(api_key="secret") as client:
        assert not client.http_client.is_closed
        with pytest.raises(ValueError, match="Invalid memory grant"):
            module.MemoryGrant(user="admin", project="read")
    assert client.http_client.is_closed
