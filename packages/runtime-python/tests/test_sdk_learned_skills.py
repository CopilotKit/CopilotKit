import asyncio

import httpx
import pytest

from copilotkit_intelligence import Intelligence

ETAG = '"' + "a" * 64 + '"'
REVISION = "opaque revision/+?"
HEADERS = {
    "content-type": "application/zip",
    "x-copilotkit-skills-revision": REVISION,
    "etag": ETAG,
}


async def test_raw_snapshot_uses_canonical_transport_and_opaque_identifiers():
    requests = []

    def platform(request):
        requests.append(request)
        return httpx.Response(200, content=b"PK\x00\xff", headers=HEADERS)

    async with httpx.AsyncClient(transport=httpx.MockTransport(platform)) as http:
        sdk = Intelligence(api_key="secret", api_url="https://platform.test/base", http_client=http)
        for _ in range(2):
            result = await sdk.get_learned_skills_snapshot(
                container_id="folder/id", revision=REVISION, if_none_match=ETAG
            )
            assert result == {
                "status": "snapshot",
                "bytes": b"PK\x00\xff",
                "revision": REVISION,
                "etag": ETAG,
                "contentType": "application/zip",
            }
        await sdk.aclose()
        assert not http.is_closed
    assert len(requests) == 2
    request = requests[0]
    assert request.url.raw_path.startswith(b"/base/api/v1/learning/containers/folder%2Fid/skills?")
    assert request.url.params["revision"] == REVISION
    assert request.headers["authorization"] == "Bearer secret"
    assert request.headers["accept"] == "application/zip"
    assert request.headers["if-none-match"] == ETAG
    assert request.method == "GET" and request.content == b""


async def test_unchanged_never_reads_body():
    class Body(httpx.AsyncByteStream):
        async def __aiter__(self):
            pytest.fail("304 body read")
            yield b""

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(304, headers=HEADERS, stream=Body()))
    ) as http:
        result = await Intelligence(api_key="key", http_client=http).get_learned_skills_snapshot(
            container_id="c", if_none_match=ETAG
        )
    assert result == {"status": "unchanged", "revision": REVISION, "etag": ETAG}


@pytest.mark.parametrize(
    "status,body,code",
    [
        (401, b"<html>secret</html>", "AUTHENTICATION_FAILED"),
        (403, b"<html>secret</html>", "AUTHORIZATION_FAILED"),
        (401, b"{}", "AUTHENTICATION_FAILED"),
        (403, b"{}", "AUTHORIZATION_FAILED"),
        (404, b"<html>secret</html>", "UNSUPPORTED_SERVER"),
        (302, b"", "UNSUPPORTED_SERVER"),
    ],
)
async def test_safe_error_status_without_retry(status, body, code, caplog):
    requests = []

    def platform(request):
        requests.append(request)
        return httpx.Response(status, content=body, headers={"location": "https://other.test"})

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(platform), follow_redirects=True
    ) as http:
        with pytest.raises(Exception) as caught:
            await Intelligence(api_key="secret", http_client=http).get_learned_skills_snapshot(
                container_id="c"
            )
    assert caught.value.code == code
    assert caught.value.retryable is False
    assert caught.value.message == str(caught.value)
    assert "secret" not in str(caught.value)
    assert caught.value.cause is None
    assert len(requests) == 1
    assert not caplog.records


@pytest.mark.parametrize(
    "code",
    [
        "AUTHENTICATION_FAILED",
        "AUTHORIZATION_FAILED",
        "ENTITLEMENT_REQUIRED",
        "DELIVERY_DISABLED",
        "CONTAINER_NOT_FOUND",
        "REVISION_NOT_FOUND",
        "REVISION_REVOKED",
    ],
)
async def test_recognized_denial_envelope(code):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                403,
                json={
                    "error": {
                        "code": code,
                        "message": "secret",
                        "category": "permanent",
                        "retryable": False,
                    },
                    "requestId": "r",
                    "traceId": "t",
                },
            )
        )
    ) as http:
        with pytest.raises(Exception) as caught:
            await Intelligence(api_key="key", http_client=http).get_learned_skills_snapshot(
                container_id="c"
            )
    assert caught.value.code == code
    assert caught.value.cause is None


@pytest.mark.parametrize(
    "status,code",
    [(401, "AUTHENTICATION_FAILED"), (403, "AUTHORIZATION_FAILED"), (503, "NETWORK_ERROR")],
)
async def test_error_body_read_failure_preserves_denial_and_cause(status, code):
    cause = httpx.ReadError("socket closed")

    class Body(httpx.AsyncByteStream):
        async def __aiter__(self):
            raise cause
            yield b""

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(status, stream=Body()))
    ) as http:
        with pytest.raises(Exception) as caught:
            await Intelligence(api_key="key", http_client=http).get_learned_skills_snapshot(
                container_id="c"
            )
    assert caught.value.code == code
    assert caught.value.cause is (None if status == 401 else cause)
    assert caught.value.retryable is (status == 503)


@pytest.mark.parametrize(
    "headers,revision,conditional,status",
    [
        ({**HEADERS, "etag": "unquoted"}, None, None, 200),
        ({**HEADERS, "etag": "W/" + ETAG}, None, None, 200),
        ({**HEADERS, "etag": '"abc"'}, None, None, 200),
        ({**HEADERS, "x-copilotkit-skills-revision": ""}, None, None, 200),
        ({**HEADERS, "content-type": "application/json"}, None, None, 200),
        (HEADERS, "different", None, 200),
        (HEADERS, None, None, 304),
        (HEADERS, "different", ETAG, 304),
    ],
)
async def test_invalid_metadata(headers, revision, conditional, status):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(status, headers=headers))
    ) as http:
        with pytest.raises(Exception) as caught:
            await Intelligence(api_key="key", http_client=http).get_learned_skills_snapshot(
                container_id="c", revision=revision, if_none_match=conditional
            )
    assert caught.value.code == "INVALID_SNAPSHOT"


@pytest.mark.parametrize(
    "options",
    [
        {"container_id": ""},
        {"container_id": " "},
        {"container_id": "c", "revision": ""},
        {"container_id": "c", "if_none_match": ""},
        {"container_id": "c", "if_none_match": "bad\r\nheader"},
    ],
)
async def test_invalid_configuration_before_network(options):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: pytest.fail("network called"))
    ) as http:
        with pytest.raises(Exception) as caught:
            await Intelligence(api_key="key", http_client=http).get_learned_skills_snapshot(
                **options
            )
    assert caught.value.code == "INVALID_CONFIG"


@pytest.mark.parametrize("cancel", [False, True])
async def test_body_deadline_and_native_cancellation_close_stream(cancel):
    started, closed = asyncio.Event(), asyncio.Event()

    class Body(httpx.AsyncByteStream):
        async def __aiter__(self):
            started.set()
            await asyncio.Event().wait()
            yield b""

        async def aclose(self):
            closed.set()

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, headers=HEADERS, stream=Body()))
    ) as http:
        sdk = Intelligence(api_key="key", http_client=http, request_timeout=0.02)
        task = asyncio.create_task(sdk.get_learned_skills_snapshot(container_id="c"))
        await asyncio.wait_for(started.wait(), 0.5)
        if cancel:
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
        else:
            with pytest.raises(Exception) as caught:
                await asyncio.wait_for(task, 0.5)
            assert caught.value.code == "TIMEOUT"
            assert caught.value.retryable is True
        assert closed.is_set()


@pytest.mark.parametrize(
    "status,code", [(401, "AUTHENTICATION_FAILED"), (403, "AUTHORIZATION_FAILED")]
)
async def test_denial_status_overrides_transient_envelope(status, code):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                status,
                json={
                    "error": {
                        "code": "NETWORK_ERROR",
                        "message": "secret",
                        "category": "transient",
                        "retryable": True,
                    }
                },
            )
        )
    ) as http:
        with pytest.raises(Exception) as caught:
            await Intelligence(api_key="key", http_client=http).get_learned_skills_snapshot(
                container_id="c"
            )
    assert caught.value.code == code
    assert caught.value.retryable is False


@pytest.mark.parametrize(
    "cause,code",
    [(httpx.ConnectError("secret"), "NETWORK_ERROR"), (httpx.ReadTimeout("secret"), "TIMEOUT")],
)
async def test_transport_failure_is_typed_and_not_retried(cause, code):
    requests = []

    def platform(request):
        requests.append(request)
        raise cause

    async with httpx.AsyncClient(transport=httpx.MockTransport(platform)) as http:
        with pytest.raises(Exception) as caught:
            await Intelligence(api_key="key", http_client=http).get_learned_skills_snapshot(
                container_id="c"
            )
    assert caught.value.code == code
    assert caught.value.retryable is True
    assert caught.value.cause is cause
    assert "secret" not in str(caught.value)
    assert len(requests) == 1


async def test_latest_request_omits_optional_values_and_accepts_zip_media_parameters():
    requests = []

    def platform(request):
        requests.append(request)
        return httpx.Response(
            200,
            headers={**HEADERS, "content-type": "application/zip; charset=binary"},
            content=b"raw",
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(platform)) as http:
        result = await Intelligence(api_key="key", http_client=http).get_learned_skills_snapshot(
            container_id="c"
        )
    assert not requests[0].url.query
    assert "if-none-match" not in requests[0].headers
    assert result["contentType"] == "application/zip; charset=binary"


@pytest.mark.parametrize(
    "status,code", [(401, "AUTHENTICATION_FAILED"), (403, "AUTHORIZATION_FAILED")]
)
async def test_denial_survives_a_stalled_error_body(status, code):
    class Body(httpx.AsyncByteStream):
        async def __aiter__(self):
            await asyncio.Event().wait()
            yield b""

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(status, stream=Body()))
    ) as http:
        with pytest.raises(Exception) as caught:
            await Intelligence(
                api_key="key", http_client=http, request_timeout=0.01
            ).get_learned_skills_snapshot(container_id="c")
    assert caught.value.code == code
    assert caught.value.retryable is False


async def test_caller_cancellation_after_403_keeps_confirmed_denial():
    started = asyncio.Event()

    class Body(httpx.AsyncByteStream):
        async def __aiter__(self):
            started.set()
            await asyncio.Event().wait()
            yield b""

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(403, stream=Body()))
    ) as http:
        task = asyncio.create_task(
            Intelligence(api_key="key", http_client=http).get_learned_skills_snapshot(
                container_id="c"
            )
        )
        await asyncio.wait_for(started.wait(), 0.5)
        task.cancel()
        with pytest.raises(Exception) as caught:
            await task
    assert caught.value.code == "AUTHORIZATION_FAILED"
    assert caught.value.retryable is False


async def test_401_never_reads_body():
    class Body(httpx.AsyncByteStream):
        async def __aiter__(self):
            pytest.fail("401 body read")
            yield b""

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(401, stream=Body()))
    ) as http:
        with pytest.raises(Exception) as caught:
            await Intelligence(api_key="key", http_client=http).get_learned_skills_snapshot(
                container_id="c"
            )
    assert caught.value.code == "AUTHENTICATION_FAILED"


async def test_caller_cancellation_before_headers_stays_native():
    started = asyncio.Event()

    async def platform(request):
        started.set()
        await asyncio.Event().wait()

    async with httpx.AsyncClient(transport=httpx.MockTransport(platform)) as http:
        task = asyncio.create_task(
            Intelligence(api_key="key", http_client=http).get_learned_skills_snapshot(
                container_id="c"
            )
        )
        await asyncio.wait_for(started.wait(), 0.5)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
