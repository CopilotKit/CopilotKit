import asyncio
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


async def test_idle_channel_receives_authoritative_stop():
    async def server(socket):
        frame = json.loads(await socket.recv())
        await socket.send(json.dumps([*frame[:3], "phx_reply", {"status": "ok"}]))
        await socket.send(
            json.dumps([frame[0], None, frame[2], "ag-ui", {"type": "CUSTOM", "name": "stop"}])
        )
        await socket.wait_closed()

    async with serve(server, "127.0.0.1", 0) as host:
        gateway = Gateway(
            RuntimeConfig(
                api_key="fixture",
                runner_url=f"ws://127.0.0.1:{host.sockets[0].getsockname()[1]}/runner",
            ),
            "thread",
            "run",
            Telemetry(enabled=False),
        )
        await gateway.join()
        try:
            await asyncio.wait_for(gateway.stop_requested.wait(), 0.2)
        finally:
            await gateway.aclose()


async def test_gateway_draining_retries_initial_join():
    joins = []

    async def server(socket):
        frame = json.loads(await socket.recv())
        joins.append(frame)
        reply = (
            {"status": "error", "response": {"reason": "gateway_draining", "retryable": True}}
            if len(joins) == 1
            else {"status": "ok"}
        )
        await socket.send(json.dumps([*frame[:3], "phx_reply", reply]))
        await socket.wait_closed()

    async with serve(server, "127.0.0.1", 0) as host:
        gateway = Gateway(
            RuntimeConfig(
                api_key="fixture",
                runner_url=f"ws://127.0.0.1:{host.sockets[0].getsockname()[1]}/runner",
            ),
            "thread",
            "run",
            Telemetry(enabled=False),
        )
        await gateway.join()
        await gateway.aclose()
    assert len(joins) == 2


@pytest.mark.parametrize("cancellations", [1, 3])
async def test_batch_replay_is_immutable_and_final_send_waits_for_ack(cancellations):
    batches = []
    release = asyncio.Event()
    received = asyncio.Event()

    async def server(socket):
        async for raw in socket:
            frame = json.loads(raw)
            if frame[3] == "phx_join":
                reply = {"status": "ok", "response": {"capabilities": ["runner_event_batch_v1"]}}
            else:
                assert frame[3] == "events"
                batches.append(frame[4]["events"])
                if len(batches) == 1:
                    await socket.close(code=1012, reason="planned restart")
                    return
                received.set()
                await release.wait()
                reply = {"status": "ok"}
            await socket.send(json.dumps([*frame[:3], "phx_reply", reply]))

    async with serve(server, "127.0.0.1", 0) as host:
        gateway = Gateway(
            RuntimeConfig(
                api_key="fixture",
                runner_url=f"ws://127.0.0.1:{host.sockets[0].getsockname()[1]}/runner",
            ),
            "thread",
            "run",
            Telemetry(enabled=False),
        )
        await gateway.join()
        original = [{"type": "RUN_STARTED", "input": {"messages": []}}, {"type": "RUN_FINISHED"}]
        pending = asyncio.create_task(gateway.send_many(original))
        await asyncio.wait_for(received.wait(), 1)
        assert not pending.done()
        original[0]["input"]["messages"].append({"private": "mutation"})
        for _ in range(cancellations):
            pending.cancel()
            await asyncio.sleep(0.01)
        try:
            assert not pending.done(), "Cancellation must not abandon an unacknowledged batch"
        except AssertionError:
            await gateway.aclose()
            raise
        finally:
            release.set()
        with pytest.raises(asyncio.CancelledError):
            await pending
        await gateway.aclose()
    assert batches[0] == batches[1]
    assert batches[0][0]["metadata"]["cpki_event_seq"] == 1
    assert batches[0][1]["metadata"]["cpki_event_seq"] == 2
