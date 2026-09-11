import json

import httpx
import pytest

from copilotkit_intelligence import Intelligence, IntelligenceError
from copilotkit_runtime import IntelligenceRuntime, User


async def test_sdk_notifies_successful_mutations_and_unsubscribes():
    seen = []

    def platform(request):
        if request.method == "DELETE":
            return httpx.Response(204)
        return httpx.Response(200, json={"thread": {"id": "canonical", "name": "Title"}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(platform)) as http:
        client = Intelligence(api_key="key", http_client=http)

        def created(thread):
            seen.append(("created", thread["id"]))

        off = client.on_thread_created(created)
        client.on_thread_created(created)
        client.on_thread_updated(lambda thread: seen.append(("updated", thread["id"])))
        client.on_thread_deleted(lambda event: seen.append(("deleted", event)))

        await client.create_thread(thread_id="thread", user_id="user", agent_id="agent")
        await client.update_thread(
            thread_id="thread", user_id="user", agent_id="agent", updates={"name": "New"}
        )
        await client.archive_thread(thread_id="thread", user_id="user", agent_id="agent")
        await client.delete_thread(thread_id="thread/id", user_id="user", agent_id="agent")
        off()
        off()
        await client.create_thread(thread_id="other", user_id="user", agent_id="agent")

        assert seen == [
            ("created", "canonical"),
            ("updated", "canonical"),
            ("updated", "canonical"),
            ("deleted", {"threadId": "thread/id", "userId": "user", "agentId": "agent"}),
        ]


async def test_listener_failure_does_not_replace_success_or_skip_other_listeners(caplog):
    seen = []

    def fail(thread):
        raise ValueError("application callback failed")

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(200, json={"thread": {"id": "created"}})
        )
    ) as http:
        client = Intelligence(api_key="key", http_client=http)
        client.on_thread_created(fail)
        client.on_thread_created(seen.append)

        result = await client.create_thread(thread_id="thread", user_id="user", agent_id="agent")

        assert result == {"id": "created"}
        assert seen == [result]
        assert "listener failed" in caplog.text


@pytest.mark.parametrize("statuses,expected", [([200], 0), ([404, 200], 1), ([404, 409, 200], 0)])
async def test_get_or_create_only_notifies_an_actual_creation(statuses, expected):
    replies = iter(statuses)
    seen = []
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(next(replies), json={"thread": {"id": "thread"}})
        )
    ) as http:
        client = Intelligence(api_key="key", http_client=http)
        client.on_thread_created(seen.append)

        await client.get_or_create_thread(thread_id="thread", user_id="user", agent_id="agent")

        assert len(seen) == expected


@pytest.mark.parametrize("status", [403, 409, 503])
async def test_failed_mutations_do_not_notify(status):
    seen = []
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(status))
    ) as http:
        client = Intelligence(api_key="key", http_client=http)
        client.on_thread_created(seen.append)
        client.on_thread_updated(seen.append)
        client.on_thread_deleted(seen.append)

        for operation in (
            client.create_thread(thread_id="thread", user_id="user", agent_id="agent"),
            client.update_thread(thread_id="thread", user_id="user", agent_id="agent", updates={}),
            client.delete_thread(thread_id="thread", user_id="user", agent_id="agent"),
        ):
            with pytest.raises(IntelligenceError):
                await operation

        assert seen == []


async def test_runtime_mutations_notify_the_same_sdk_with_trusted_identity():
    seen = []
    bodies = []

    async def identify(request):
        return User(id="trusted", name="Customer")

    def platform(request):
        bodies.append(json.loads(request.content))
        return httpx.Response(200, json={"thread": {"id": "canonical"}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(platform)) as http:
        sdk = Intelligence(api_key="key", http_client=http)
        sdk.on_thread_updated(lambda thread: seen.append(("updated", thread["id"])))
        sdk.on_thread_deleted(lambda event: seen.append(("deleted", event)))
        runtime = IntelligenceRuntime(intelligence=sdk, agents={}, identify_user=identify)
        try:
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=runtime), base_url="http://runtime"
            ) as browser:
                update = await browser.patch(
                    "/copilotkit/threads/thread",
                    json={"agentId": "agent", "userId": "spoof", "name": "Title"},
                )
                archive = await browser.post(
                    "/copilotkit/threads/thread/archive", json={"agentId": "agent"}
                )
                delete = await browser.request(
                    "DELETE", "/copilotkit/threads/thread", json={"agentId": "agent"}
                )
            assert [update.status_code, archive.status_code, delete.status_code] == [200, 200, 200]
            assert seen == [
                ("updated", "canonical"),
                ("updated", "canonical"),
                ("deleted", {"threadId": "thread", "userId": "trusted", "agentId": "agent"}),
            ]
            assert all(body["userId"] == "trusted" for body in bodies)
        finally:
            await runtime.aclose()


async def test_locks_subscriptions_memory_and_reads_do_not_emit_thread_events():
    seen = []
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(200, json={"thread": {"id": "thread"}})
        )
    ) as http:
        client = Intelligence(api_key="key", http_client=http)
        client.on_thread_created(seen.append)
        client.on_thread_updated(seen.append)
        client.on_thread_deleted(seen.append)

        for method, path in (
            ("POST", "/api/threads/subscribe"),
            ("PATCH", "/api/threads/thread/lock"),
            ("DELETE", "/api/threads/thread/lock"),
            ("POST", "/api/memories"),
            ("PATCH", "/api/memories/memory"),
            ("GET", "/api/threads/thread"),
        ):
            await client._request(method, path, {"userId": "user", "agentId": "agent"})

        assert seen == []


@pytest.mark.parametrize("response", [None, [], {}, {"thread": {}}, {"thread": {"id": 3}}])
async def test_malformed_mutation_response_emits_no_success_event(response):
    seen = []
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json=response))
    ) as http:
        client = Intelligence(api_key="key", http_client=http)
        client.on_thread_created(seen.append)

        with pytest.raises(IntelligenceError):
            await client.create_thread(thread_id="thread", user_id="user", agent_id="agent")

        assert seen == []


async def test_runtime_run_notifies_persisted_creation_even_if_the_later_lock_fails():
    seen = []
    created = []

    async def identify(request):
        return User(id="trusted", name="Customer")

    class UnusedAgent:
        description = "Must not run without a lock"

        async def run(self, input):
            pytest.fail("Agent started without a lock")
            yield {}

    def platform(request):
        if request.method == "GET":
            return httpx.Response(404)
        if request.url.path == "/api/threads":
            created.append(json.loads(request.content))
            return httpx.Response(200, json={"thread": {"id": "canonical"}})
        return httpx.Response(409)

    async with httpx.AsyncClient(transport=httpx.MockTransport(platform)) as http:
        sdk = Intelligence(api_key="key", http_client=http)
        sdk.on_thread_created(seen.append)
        runtime = IntelligenceRuntime(
            intelligence=sdk,
            agents={"default": UnusedAgent()},
            identify_user=identify,
            learning_container=lambda user, agent_id, input: "existing-container",
        )
        try:
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=runtime), base_url="http://runtime"
            ) as browser:
                result = await browser.post(
                    "/copilotkit/agent/default/run",
                    json={
                        "threadId": "thread",
                        "runId": "run",
                        "messages": [],
                        "tools": [],
                        "context": [],
                        "state": {},
                    },
                )

            assert result.status_code == 409
            assert seen == [{"id": "canonical"}]
            assert created == [
                {
                    "threadId": "thread",
                    "userId": "trusted",
                    "agentId": "default",
                    "learningContainerId": "existing-container",
                }
            ]
        finally:
            await runtime.aclose()
