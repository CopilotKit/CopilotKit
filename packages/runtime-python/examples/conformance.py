"""Test harness configuration only; all behavior lives in the installed library."""

import asyncio
import json
import os
import socket

import httpx
import uvicorn

from copilotkit_runtime import HttpAgent, IntelligenceRuntime, RuntimeConfig, Telemetry, User


async def main():
    config = json.loads(os.environ["CPK_CONFIG"])

    async def identify(request):
        return User(
            request.headers.get("x-test-user-id", "test-user"),
            request.headers.get("x-test-user-name", "Test User"),
        )

    async def export(event):
        if config.get("telemetryUrl"):
            async with httpx.AsyncClient() as client:
                await client.post(config["telemetryUrl"], json=event, timeout=2)

    runtime = IntelligenceRuntime(
        RuntimeConfig(
            api_key=config["apiKey"],
            api_url=config["apiUrl"],
            runner_url=config["runnerUrl"],
            client_url=config["clientUrl"],
        ),
        agents={"default": HttpAgent(config["agentUrl"])},
        identify_user=identify,
        telemetry=Telemetry(sink=export),
    )
    sock = socket.socket()
    sock.bind(("127.0.0.1", config.get("port", 0)))
    sock.listen(128)
    print(json.dumps({"port": sock.getsockname()[1]}), flush=True)
    server = uvicorn.Server(uvicorn.Config(runtime, log_level="warning", lifespan="on"))
    await server.serve(sockets=[sock])


if __name__ == "__main__":
    asyncio.run(main())
