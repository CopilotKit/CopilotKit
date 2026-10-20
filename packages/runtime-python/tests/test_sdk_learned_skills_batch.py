import base64
import json

import httpx
import pytest

from copilotkit_intelligence import Intelligence, LearnedSkillsError

ETAG = '"' + "a" * 64 + '"'


def entry(identifier="a", **changes):
    return dict(
        containerId=identifier,
        status="snapshot",
        revision="r1",
        etag=ETAG,
        contentType="application/zip",
        bytesBase64=base64.b64encode(b"zip").decode(),
        **changes,
    )


async def test_batch_posts_once_and_decodes_each_result():
    requests = []

    def serve(request):
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "containers": [
                    entry(),
                    {
                        "containerId": "b",
                        "status": "error",
                        "error": {"code": "REVISION_REVOKED", "retryable": False},
                    },
                ]
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(serve)) as http:
        sdk = Intelligence(api_key="key", api_url="https://example.test/base", http_client=http)
        assert hasattr(sdk, "get_learned_skills_snapshots")
        result = await sdk.get_learned_skills_snapshots(
            containers=[
                {"containerId": "a"},
                {"containerId": "b", "revision": "r1", "ifNoneMatch": ETAG},
            ]
        )
        assert result["a"]["bytes"] == b"zip"
        assert result["b"].code == "REVISION_REVOKED"
        await sdk.aclose()
        assert not http.is_closed
    assert len(requests) == 1
    request = requests[0]
    assert request.method == "POST"
    assert request.url.path == "/base/api/v1/learning/skills/batch"
    assert request.headers["authorization"] == "Bearer key"
    assert json.loads(request.content)["containers"][1]["ifNoneMatch"] == ETAG


@pytest.mark.parametrize(
    "entries",
    [
        [],
        [entry(), entry()],
        [entry("unknown")],
        [dict(entry(), bytesBase64="%%%")],
        [dict(entry(), bytesBase64="emlw=")],
        [dict(entry(), etag="bad")],
        [dict(entry(), revision=" ")],
        [dict(entry(), status="unchanged")],
        [dict(entry(), status="error", error={"code": "SECRET", "retryable": False})],
    ],
)
async def test_malformed_batch_fails_closed(entries):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"containers": entries}))
    ) as http:
        sdk = Intelligence(api_key="key", http_client=http)
        assert hasattr(sdk, "get_learned_skills_snapshots")
        with pytest.raises(LearnedSkillsError) as caught:
            await sdk.get_learned_skills_snapshots(containers=[{"containerId": "a"}])
        assert caught.value.code == "INVALID_SNAPSHOT"


@pytest.mark.parametrize(
    "containers",
    [
        [],
        [{"containerId": str(i)} for i in range(51)],
        [{"containerId": "a"}, {"containerId": "a"}],
        [{"containerId": " "}],
        [{"containerId": "a", "revision": " "}],
        [{"containerId": "a", "ifNoneMatch": "bad"}],
        [{"containerId": "\ud800"}],
    ],
)
async def test_invalid_batch_request_never_sends(containers):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: pytest.fail("request sent"))
    ) as http:
        sdk = Intelligence(api_key="key", http_client=http)
        assert hasattr(sdk, "get_learned_skills_snapshots")
        with pytest.raises(LearnedSkillsError) as caught:
            await sdk.get_learned_skills_snapshots(containers=containers)
        assert caught.value.code == "INVALID_CONFIG"


async def test_valid_denial_dominates_malformed_sibling():
    entries = [
        dict(entry(), bytesBase64="invalid!"),
        {
            "containerId": "b",
            "status": "error",
            "error": {"code": "REVISION_REVOKED", "retryable": False},
        },
    ]
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"containers": entries}))
    ) as http:
        with pytest.raises(LearnedSkillsError) as caught:
            await Intelligence(api_key="key", http_client=http).get_learned_skills_snapshots(
                containers=[{"containerId": "a"}, {"containerId": "b"}]
            )
        assert caught.value.code == "REVISION_REVOKED"


@pytest.mark.parametrize(
    "status,cancel,code",
    [
        (200, False, "TIMEOUT"),
        (403, False, "AUTHORIZATION_FAILED"),
        (403, True, "AUTHORIZATION_FAILED"),
        (200, True, None),
    ],
)
async def test_batch_deadline_cancellation_cleanup_and_denial(status, cancel, code):
    import asyncio

    entered, closed = asyncio.Event(), asyncio.Event()

    class Body(httpx.AsyncByteStream):
        async def __aiter__(self):
            entered.set()
            await asyncio.Event().wait()
            yield b""

        async def aclose(self):
            closed.set()

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(status, stream=Body()))
    ) as http:
        sdk = Intelligence(api_key="key", http_client=http)
        task = asyncio.create_task(
            sdk.get_learned_skills_snapshots(
                containers=[{"containerId": "a"}], request_timeout=0.02
            )
        )
        await entered.wait()
        if cancel:
            task.cancel()
        if code is None:
            with pytest.raises(asyncio.CancelledError):
                await task
        else:
            with pytest.raises(LearnedSkillsError) as caught:
                await task
            assert caught.value.code == code
        await sdk.aclose()
        assert closed.is_set()
