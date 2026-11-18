"""Test harness configuration only; all behavior lives in the installed library."""

import asyncio
import json
import os
import socket

import uvicorn

from copilotkit_runtime import (
    GenerativeUIConfig,
    HttpAgent,
    IntelligenceRuntime,
    MCPAppsConfig,
    MCPServer,
    RuntimeConfig,
    Telemetry,
    User,
)


def generative_ui(option):
    """Map the TypeScript `generativeUI` runtime option to the Python configuration."""
    if option is None or isinstance(option, bool):
        return option
    recovery = option.get("recovery", {})
    return GenerativeUIConfig(
        agents=tuple(option["agents"]) if "agents" in option else None,
        a2ui_version=option.get("a2uiVersion", "1.0"),
        schema=option.get("schema"),
        inject_a2ui_tool=option.get("injectA2UITool"),
        a2ui_tool_names=tuple(option.get("a2uiToolNames", ["render_a2ui"])),
        default_catalog_id=option.get("defaultCatalogId"),
        max_attempts=recovery.get("maxAttempts", 3),
        show_progress_tokens=recovery.get("showProgressTokens", True),
        debug_exposure=recovery.get("debugExposure"),
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
            sample_rate=config.get("telemetrySampleRate", 1),
            telemetry_id=config.get("telemetryId"),
            license_token=config.get("licenseToken"),
            url=config.get("telemetryUrl", "https://telemetry.copilotkit.ai/ingest"),
        ),
        generative_ui=generative_ui(config.get("generativeUI")),
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
