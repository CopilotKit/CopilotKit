"""Count actual HTTP requests through the canonical client and registry."""

import asyncio
import base64
import json
from contextlib import asynccontextmanager

import pytest
from conftest import response
from copilotkit_intelligence import Intelligence, LearnedSkillsError

from _delivery.registry import Registry


@asynccontextmanager
async def platform():
    requests = []
    state = {"mode": "snapshot"}

    async def serve(reader, writer):
        try:
            headers = (await reader.readuntil(b"\r\n\r\n")).decode().split("\r\n")
            size = next(
                int(line.split(":", 1)[1])
                for line in headers
                if line.lower().startswith("content-length:")
            )
            body = json.loads(await reader.readexactly(size))
            requests.append((headers[0], body))
            entries = []
            for source in body["containers"]:
                identifier = source["containerId"]
                if state["mode"] == "denial" and identifier == "b":
                    entries.append(
                        {
                            "containerId": identifier,
                            "status": "error",
                            "error": {"code": "REVISION_REVOKED", "retryable": False},
                        }
                    )
                elif state["mode"] == "outage":
                    entries.append(
                        {
                            "containerId": identifier,
                            "status": "error",
                            "error": {"code": "NETWORK_ERROR", "retryable": True},
                        }
                    )
                elif state["mode"] == "unchanged":
                    entries.append(
                        {
                            "containerId": identifier,
                            "status": "unchanged",
                            "revision": response()["revision"],
                            "etag": source["ifNoneMatch"],
                        }
                    )
                else:
                    raw = response()
                    entries.append(
                        {
                            "containerId": identifier,
                            **{key: value for key, value in raw.items() if key != "bytes"},
                            "bytesBase64": base64.b64encode(raw["bytes"]).decode(),
                        }
                    )
            data = json.dumps({"containers": entries}).encode()
            writer.write(
                b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: "
                + str(len(data)).encode()
                + b"\r\n\r\n"
                + data
            )
            await writer.drain()
        finally:
            writer.close()
            await writer.wait_closed()

    server = await asyncio.start_server(serve, "127.0.0.1", 0)
    async with server:
        async with Intelligence(
            api_key="test", api_url=f"http://127.0.0.1:{server.sockets[0].getsockname()[1]}"
        ) as client:
            yield client, requests, state


@pytest.mark.parametrize("count", [1, 2])
async def test_explicit_containers_use_one_http_post_and_reuse_fresh_cache(count):
    async with platform() as (client, requests, state):
        registry = Registry(
            client=client, containers=[{"id": identifier} for identifier in ["a", "b"][:count]]
        )
        first, second = await asyncio.gather(
            registry.acquire_snapshot(), registry.acquire_snapshot()
        )
        assert first is second
        assert await registry.acquire_snapshot() is first
        assert len(requests) == 1
        assert requests[0][0] == "POST /api/v1/learning/skills/batch HTTP/1.1"
        assert len(requests[0][1]["containers"]) == count
        await registry.aclose()


async def test_http_conditional_batch_and_denial_remains_blocking_during_outage():
    async with platform() as (client, requests, state):
        registry = Registry(
            client=client, containers=[{"id": "a"}, {"id": "b"}], freshness_window=0
        )
        original = await registry.acquire_snapshot()
        state["mode"] = "unchanged"
        assert await registry.acquire_snapshot() is original
        assert len(requests) == 2
        assert all(
            source["ifNoneMatch"] == response()["etag"] for source in requests[1][1]["containers"]
        )
        state["mode"] = "denial"
        with pytest.raises(LearnedSkillsError) as caught:
            await registry.acquire_snapshot()
        assert caught.value.code == "REVISION_REVOKED"
        state["mode"] = "outage"
        with pytest.raises(LearnedSkillsError) as caught:
            await registry.acquire_snapshot()
        assert caught.value.code == "REVISION_REVOKED"
        assert len(requests) == 4
        assert len(original.skills) == 2
        await registry.aclose()


async def test_only_expired_source_is_in_next_http_batch():
    async with platform() as (client, requests, state):
        registry = Registry(client=client, containers=[{"id": "a"}, {"id": "b"}])
        await registry.acquire_snapshot()
        registry._children[1][1]._checked -= 10
        state["mode"] = "unchanged"
        await registry.acquire_snapshot()
        assert len(requests) == 2
        assert [item["containerId"] for item in requests[1][1]["containers"]] == ["b"]
        await registry.aclose()
