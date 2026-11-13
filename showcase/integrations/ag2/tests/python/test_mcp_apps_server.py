"""The AG2 MCP App server behind the mcp-apps demo.

Drives the real ``MCPServer`` over streamable HTTP (in-process ASGI) the way the
CopilotKit runtime's MCP Apps middleware does: list tools, call ``create_view``,
read the ``ui://`` document.
"""

from __future__ import annotations

import asyncio
import json

import httpx

from agents.mcp_apps_server import DIAGRAM_URI, mcp_apps_server

HEADERS = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
}
ELEMENTS = [{"id": "a", "type": "rectangle", "x": 0, "y": 0, "width": 100, "height": 50}]


def _body(response: httpx.Response) -> dict:
    text = response.text
    if "data:" in text:
        text = [ln[5:] for ln in text.splitlines() if ln.startswith("data:")][-1]
    return json.loads(text)


async def _session(*requests: tuple[str, dict]) -> list[dict]:
    http = mcp_apps_server._http
    transport = httpx.ASGITransport(app=http)
    async with http.router.lifespan_context(http):
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
            init = await c.post(
                "/mcp/",
                headers=HEADERS,
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "protocolVersion": "2025-06-18",
                        "capabilities": {
                            "extensions": {
                                "io.modelcontextprotocol/ui": {"mimeTypes": ["text/html;profile=mcp-app"]}
                            }
                        },
                        "clientInfo": {"name": "t", "version": "1"},
                    },
                },
            )
            headers = dict(HEADERS)
            if sid := init.headers.get("mcp-session-id"):
                headers["Mcp-Session-Id"] = sid
            await c.post("/mcp/", headers=headers, json={"jsonrpc": "2.0", "method": "notifications/initialized"})
            results = []
            for i, (method, params) in enumerate(requests, start=2):
                r = await c.post(
                    "/mcp/", headers=headers, json={"jsonrpc": "2.0", "id": i, "method": method, "params": params}
                )
                results.append(_body(r)["result"])
            return results


def test_mcp_app_round_trip():
    # One session for all three calls: the server's session manager can only be
    # entered once per process.
    listing, called, read = asyncio.run(
        _session(
            ("tools/list", {}),
            ("tools/call", {"name": "create_view", "arguments": {"elements": ELEMENTS}}),
            ("resources/read", {"uri": DIAGRAM_URI}),
        )
    )

    # create_view is bound to the ui:// document.
    tools = {t["name"]: t for t in listing["tools"]}
    assert tools["create_view"]["_meta"]["ui"]["resourceUri"] == DIAGRAM_URI

    # The per-call data travels as structuredContent for the document to draw.
    assert called["isError"] is False
    assert called["structuredContent"] == {"elements": ELEMENTS}

    # The document is served as an MCP App with the host-handshake runtime.
    (content,) = read["contents"]
    assert content["mimeType"] == "text/html;profile=mcp-app"
    assert "ag2ui.onToolResult" in content["text"]
