import asyncio
import json
import time

import httpx
import pytest

from copilotkit_runtime import Telemetry

STARTED = "oss.runtime.agent_execution_stream_started"


async def test_canonical_envelope_identity_header_and_seconds():
    requests = []

    async def transport(request):
        requests.append(request)
        return httpx.Response(202)

    client = httpx.AsyncClient(transport=httpx.MockTransport(transport))
    telemetry = Telemetry(sample_rate=1, telemetry_id=" \tteam-123\t ", http_client=client)
    await telemetry.emit(STARTED, api_key="secret", message="private")
    await telemetry.flush()
    body = json.loads(requests[0].content)
    assert abs(body["ts"] - int(time.time())) < 2
    assert body["properties"] == {}
    assert body["global_properties"] == {
        "sampleRate": 1,
        "sampleRateAdjustmentFactor": 0,
        "sampleWeight": 1,
        "telemetry_identified": False,
        "telemetry_emitter": "native-python",
        "telemetry_transport": "lambda",
    }
    assert requests[0].headers["x-copilotkit-telemetry-id"] == "team-123"
    assert "team-123" not in requests[0].content.decode()
    assert str(requests[0].url) == "https://telemetry.copilotkit.ai/ingest"
    await telemetry.aclose()
    await client.aclose()


async def test_standalone_identity_does_not_bypass_zero_sampling(monkeypatch):
    monkeypatch.setenv("COPILOTKIT_TELEMETRY_SAMPLE_RATE", "0")
    telemetry = Telemetry(sample_rate=1, telemetry_id="team")
    await telemetry.emit(STARTED)
    await telemetry.flush()
    assert telemetry.stats.sent == 0
    assert telemetry.stats.sampled_out == 1
    await telemetry.aclose()


async def test_opt_out_is_authoritative(monkeypatch):
    monkeypatch.setenv("DO_NOT_TRACK", "1")
    telemetry = Telemetry(sample_rate=1)
    await telemetry.emit(STARTED)
    assert telemetry.stats.queued == 0
    await telemetry.aclose()


@pytest.mark.parametrize("rate", [float("nan"), float("inf"), -0.1, 1.01])
def test_invalid_sampling_rejected(rate):
    with pytest.raises(ValueError):
        Telemetry(sample_rate=rate)


async def test_queue_is_bounded_and_flush_is_time_bounded():
    async def blocked(event):
        await asyncio.Event().wait()

    telemetry = Telemetry(sample_rate=1, sink=blocked, queue_capacity=2, timeout=0.02)
    for _ in range(10):
        await telemetry.emit(STARTED)
    assert telemetry.stats.dropped == 8
    await telemetry.aclose(timeout=0.1)
    assert telemetry.stats.failed == 2


async def test_redirect_does_not_forward_identity():
    requests = []

    async def transport(request):
        requests.append(request)
        return httpx.Response(302, headers={"Location": "http://elsewhere.test"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(transport), follow_redirects=True)
    telemetry = Telemetry(sample_rate=1, http_client=client, telemetry_id="team")
    await telemetry.emit(STARTED)
    await telemetry.flush()
    assert len(requests) == 1
    assert telemetry.stats.failed == 1
    await telemetry.aclose()
    await client.aclose()


async def test_environment_endpoint_and_valid_identity_fallback(monkeypatch):
    monkeypatch.setenv("COPILOTKIT_TELEMETRY_URL", "http://fixture.test/ingest")
    monkeypatch.setenv("CPK_TELEMETRY_ID", "env-team")
    telemetry = Telemetry(url="http://other.test", telemetry_id="\r\ninvalid")
    assert telemetry.url == "http://fixture.test/ingest"
    assert telemetry.telemetry_id == "env-team"
    await telemetry.aclose()


def test_sync_sink_cannot_block_event_loop():
    with pytest.raises(ValueError, match="async"):
        Telemetry(sink=lambda event: None)


async def test_half_sampling_carries_weight_and_unknown_events_do_not_export(monkeypatch):
    events = []

    async def sink(event):
        events.append(event)

    monkeypatch.setattr("copilotkit_runtime.telemetry.random.random", lambda: 0.1)
    telemetry = Telemetry(sample_rate=0.5, sink=sink)
    await telemetry.emit(STARTED)
    await telemetry.emit("private-user-route", message="secret")
    await telemetry.flush()
    assert len(events) == 1
    assert events[0]["global_properties"]["sampleWeight"] == 2
    assert events[0]["global_properties"]["sampleRateAdjustmentFactor"] == 0.5
    await telemetry.aclose()
