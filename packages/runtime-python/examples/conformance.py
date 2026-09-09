"""Test harness configuration only; all behavior lives in the installed library."""

import asyncio
import json
import os
import socket

import uvicorn

from copilotkit_runtime import (
    A2UIConfig,
    HttpAgent,
    IntelligenceRuntime,
    MCPAppsConfig,
    MCPServer,
    RuntimeConfig,
    Telemetry,
    User,
)


async def main():
    config = json.loads(os.environ["CPK_CONFIG"])

    async def identify(request):
        return User(
            request.headers.get("x-test-user-id", "test-user"),
            request.headers.get("x-test-user-name", "Test User"),
        )

    runtime = IntelligenceRuntime(
        RuntimeConfig(
            api_key=config["apiKey"],
            api_url=config["apiUrl"],
            runner_url=config["runnerUrl"],
            client_url=config["clientUrl"],
        ),
        agents={"default": HttpAgent(config["agentUrl"], description="Conformance agent")},
        memory_policy=None
        if config.get("omitMemoryPolicy")
        else lambda *_: config.get("memoryGrant", {"user": "read-write", "project": "read-write"}),
        identify_user=identify,
        telemetry=Telemetry(
            enabled=not config.get("telemetryDisabled", False),
            sample_rate=config.get("telemetrySampleRate", 0.05),
            telemetry_id=config.get("telemetryId"),
            license_token=config.get("licenseToken"),
            url=config.get("telemetryUrl", "https://telemetry.copilotkit.ai/ingest"),
        ),
        a2ui=A2UIConfig(
            enabled=config["a2ui"].get("enabled", True),
            agents=tuple(config["a2ui"]["agents"]) if "agents" in config["a2ui"] else None,
            schema=config["a2ui"].get("schema"),
            inject_tool=config["a2ui"].get("injectA2UITool", False),
            tool_names=tuple(config["a2ui"].get("a2uiToolNames", ["render_a2ui"])),
            default_catalog_id=config["a2ui"].get("defaultCatalogId"),
            max_attempts=config["a2ui"].get("recovery", {}).get("maxAttempts", 3),
            show_progress_tokens=config["a2ui"].get("recovery", {}).get("showProgressTokens", True),
            debug_exposure=config["a2ui"].get("recovery", {}).get("debugExposure"),
        )
        if config.get("a2ui") is not None
        else None,
        mcp_apps=MCPAppsConfig(
            servers=tuple(
                MCPServer(
                    url=server["url"],
                    server_id=server.get("serverId"),
                    agent_id=server.get("agentId"),
                    headers=server.get("headers", {}),
                )
                for server in config["mcpApps"].get("servers", [])
            )
        )
        if config.get("mcpApps")
        else None,
    )
    sock = socket.socket()
    sock.bind(("127.0.0.1", config.get("port", 0)))
    sock.listen(128)
    print(json.dumps({"port": sock.getsockname()[1]}), flush=True)
    server = uvicorn.Server(uvicorn.Config(runtime, log_level="warning", lifespan="on"))
    await server.serve(sockets=[sock])


if __name__ == "__main__":
    asyncio.run(main())
