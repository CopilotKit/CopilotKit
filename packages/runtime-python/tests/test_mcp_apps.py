import hashlib
import json

from copilotkit_runtime.mcp_apps import MCPAppsConfig, MCPAppsMiddleware, MCPServer


def test_server_hash_matches_browser_contract_without_credentials():
    server = MCPServer(
        url="http://localhost:8000/mcp", server_id="example", headers={"Authorization": "secret"}
    )
    expected = hashlib.md5(
        json.dumps({"type": "http", "url": server.url}, separators=(",", ":")).encode()
    ).hexdigest()
    assert server.server_hash == expected


async def test_proxy_allowlist_rejects_unknown_method_without_network():
    middleware = MCPAppsMiddleware(
        MCPAppsConfig(servers=(MCPServer(url="http://localhost:1/mcp", server_id="known"),))
    )
    events = [
        event
        async for event in middleware.proxy(
            {"serverId": "known", "method": "admin/delete"}, "default"
        )
    ]
    assert events[-1]["type"] == "RUN_FINISHED"
    assert "error" in events[-1]["result"]


async def test_proxy_does_not_cross_agent_scope():
    middleware = MCPAppsMiddleware(
        MCPAppsConfig(
            servers=(
                MCPServer(url="http://localhost:1/mcp", server_id="private", agent_id="other"),
            )
        )
    )
    events = [
        event
        async for event in middleware.proxy({"serverId": "private", "method": "ping"}, "default")
    ]
    assert events[-1]["result"] == {"error": "Unknown MCP server"}
