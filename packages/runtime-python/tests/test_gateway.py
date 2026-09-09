import json

import pytest
from websockets.asyncio.server import serve

from copilotkit_runtime import RuntimeConfig, Telemetry
from copilotkit_runtime.gateway import Gateway


async def test_permanent_rejection_is_not_retried():
    attempts = []

    async def server(socket):
        async for raw in socket:
            frame = json.loads(raw)
            join_ref, ref, topic, event, payload = frame
            if event == "event":
                attempts.append(payload)
            reply = (
                {"status": "ok"}
                if event == "phx_join"
                else {
                    "status": "error",
                    "response": {"retryable": False, "reason": "invalid_scope"},
                }
            )
            await socket.send(json.dumps([join_ref, ref, topic, "phx_reply", reply]))

    async with serve(server, "127.0.0.1", 0) as host:
        port = host.sockets[0].getsockname()[1]
        gateway = Gateway(
            RuntimeConfig(api_key="fixture", runner_url=f"ws://127.0.0.1:{port}/runner"),
            "thread",
            "run",
            Telemetry(enabled=False),
        )
        await gateway.join()
        with pytest.raises(ConnectionError):
            await gateway.send({"type": "RUN_STARTED"})
        await gateway.aclose()
    assert len(attempts) == 1


async def test_lost_ack_replays_identical_event_before_later_sequence():
    attempts = []

    async def server(socket):
        async for raw in socket:
            join_ref, ref, topic, event, payload = json.loads(raw)
            if event == "event":
                attempts.append(payload)
                if len(attempts) == 1:
                    continue
            await socket.send(json.dumps([join_ref, ref, topic, "phx_reply", {"status": "ok"}]))

    async with serve(server, "127.0.0.1", 0) as host:
        port = host.sockets[0].getsockname()[1]
        gateway = Gateway(
            RuntimeConfig(
                api_key="fixture", runner_url=f"ws://127.0.0.1:{port}/runner", ack_timeout=0.03
            ),
            "canonical-thread",
            "canonical-run",
            Telemetry(enabled=False),
        )
        await gateway.join()
        await gateway.send({"type": "RUN_STARTED", "threadId": "spoof", "runId": "spoof"})
        await gateway.send({"type": "RUN_FINISHED"})
        await gateway.aclose()
    assert attempts[0] == attempts[1]
    assert attempts[0]["threadId"] == "canonical-thread"
    assert attempts[0]["runId"] == "canonical-run"
    assert attempts[0]["metadata"]["cpki_event_seq"] == 1
    assert attempts[2]["metadata"]["cpki_event_seq"] == 2
