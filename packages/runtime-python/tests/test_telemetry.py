from copilotkit_runtime import Telemetry


async def test_opt_out_is_authoritative(monkeypatch):
    events = []
    monkeypatch.setenv("DO_NOT_TRACK", "1")
    telemetry = Telemetry(sink=events.append)
    await telemetry.emit("runtime.request", status=200)
    assert events == []


async def test_telemetry_drops_private_attributes_and_survives_sink_error():
    events = []
    telemetry = Telemetry(sink=events.append)
    await telemetry.emit("runtime.request", status=200, api_key="secret", message="private")
    assert events[0]["properties"] == {"status": 200}

    async def broken_sink(event):
        raise ValueError("private exporter error")

    telemetry.sink = broken_sink
    await telemetry.emit("runtime.request", status=502)
