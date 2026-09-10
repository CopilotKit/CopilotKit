"""MCP Apps middleware with native authenticated Streamable HTTP sessions."""

import asyncio
import hashlib
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import timedelta
from urllib.parse import urlsplit
from uuid import uuid4

from mcp import ClientSession, types
from mcp.client.streamable_http import streamablehttp_client
from mcp.shared.message import SessionMessage

from .models import Json


@dataclass(frozen=True)
class MCPServer:
    """Server-owned endpoint/authentication. Browser input cannot alter this configuration."""

    url: str
    server_id: str | None = None
    agent_id: str | None = None
    headers: dict[str, str] = field(default_factory=dict, repr=False)

    def __post_init__(self) -> None:
        """Reject non-HTTP endpoints and credentials embedded in URLs."""
        parsed = urlsplit(self.url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username:
            raise ValueError("MCP server requires an HTTP URL without embedded credentials")

    @property
    def server_hash(self) -> str:
        """Match the opaque reference used by the TypeScript MCP Apps renderer."""
        serialized = json.dumps({"type": "http", "url": self.url}, separators=(",", ":"))
        return hashlib.md5(serialized.encode(), usedforsecurity=False).hexdigest()


@dataclass(frozen=True)
class MCPAppsConfig:
    """Bound MCP request duration, discovery pages, and buffered arguments."""

    servers: tuple[MCPServer, ...] = ()
    timeout: float = 30
    max_tool_pages: int = 20
    max_argument_bytes: int = 2 * 1024 * 1024


class MCPAppsMiddleware:
    """Expose UI-enabled tools and execute iframe requests against configured servers."""

    def __init__(self, config: MCPAppsConfig) -> None:
        self.config = config

    def _servers(self, agent_id: str) -> tuple[MCPServer, ...]:
        """Select the allowed MCP servers for one agent."""
        return tuple(
            server for server in self.config.servers if server.agent_id in (None, agent_id)
        )

    async def _request(self, server: MCPServer, method: str, params: Json | None = None) -> Json:
        """Negotiate an MCP session and close its transport after one bounded operation."""
        async with asyncio.timeout(self.config.timeout):
            async with streamablehttp_client(
                server.url,
                headers=dict(server.headers),
                timeout=self.config.timeout,
                sse_read_timeout=self.config.timeout,
            ) as (read, write, _):
                async with ClientSession(
                    read, write, read_timeout_seconds=timedelta(seconds=self.config.timeout)
                ) as session:
                    # Public protocol calls allow the UI extension without an SDK subclass.
                    initialized = await session.send_request(
                        types.ClientRequest(
                            types.InitializeRequest(
                                params=types.InitializeRequestParams(
                                    protocolVersion="2025-06-18",
                                    capabilities=types.ClientCapabilities.model_validate(
                                        {
                                            "extensions": {
                                                "io.modelcontextprotocol/ui": {
                                                    "mimeTypes": ["text/html+mcp"]
                                                }
                                            }
                                        }
                                    ),
                                    clientInfo=types.Implementation(
                                        name="copilotkit-runtime-python", version="0.1.0"
                                    ),
                                )
                            )
                        ),
                        types.InitializeResult,
                    )
                    if initialized.protocolVersion not in (
                        "2024-11-05",
                        "2025-03-26",
                        "2025-06-18",
                        "2025-11-25",
                    ):
                        raise ValueError("Unsupported MCP protocol version")
                    await session.send_notification(
                        types.ClientNotification(types.InitializedNotification())
                    )
                    if method == "tools/list":
                        tools: list[Json] = []
                        cursor = None
                        cursors: set[str] = set()
                        for _page in range(self.config.max_tool_pages):
                            page = await session.list_tools(cursor=cursor)
                            tools.extend(
                                tool.model_dump(mode="json", by_alias=True, exclude_none=True)
                                for tool in page.tools
                            )
                            cursor = page.nextCursor
                            if not cursor:
                                return {"tools": tools}
                            if cursor in cursors:
                                raise ValueError("MCP discovery repeated its cursor")
                            cursors.add(cursor)
                        raise ValueError("MCP discovery page limit exceeded")
                    if method == "tools/call":
                        result = await session.send_request(
                            types.ClientRequest(
                                types.CallToolRequest(
                                    params=types.CallToolRequestParams.model_validate(params or {})
                                )
                            ),
                            types.CallToolResult,
                        )
                        return result.model_dump(mode="json", by_alias=True, exclude_none=True)
                    if method == "resources/read":
                        resource = await session.read_resource((params or {})["uri"])
                        return resource.model_dump(mode="json", by_alias=True, exclude_none=True)
                    if method == "ping":
                        pong = await session.send_ping()
                        return pong.model_dump(mode="json", by_alias=True, exclude_none=True)
                    if method == "notifications/message":
                        await write.send(
                            SessionMessage(
                                types.JSONRPCMessage(
                                    types.JSONRPCNotification(
                                        jsonrpc="2.0", method=method, params=params
                                    )
                                )
                            )
                        )
                        return {"success": True}
                    raise ValueError("MCP method not allowed")

    async def discover(
        self, input: Json, agent_id: str
    ) -> tuple[Json, dict[str, tuple[MCPServer, str]]]:
        """Inject tools with UI resources and reject ambiguous server tool names."""
        tools = list(input.get("tools", []))
        by_name: dict[str, tuple[MCPServer, str]] = {}
        existing = {tool.get("name") for tool in tools}
        for server in self._servers(agent_id):
            result = await self._request(server, "tools/list")
            for tool in result["tools"]:
                meta = tool.get("_meta")
                meta = meta if isinstance(meta, dict) else {}
                ui = meta.get("ui")
                if isinstance(ui, dict) and "visibility" in ui:
                    visibility = ui["visibility"]
                    if not isinstance(visibility, list) or "model" not in visibility:
                        continue
                uri = ui.get("resourceUri") if isinstance(ui, dict) else None
                if not isinstance(uri, str):
                    uri = meta.get("ui/resourceUri")
                if not isinstance(uri, str):
                    continue
                name = tool["name"]
                if name in existing:
                    raise ValueError("MCP tool name collision")
                existing.add(name)
                by_name[name] = (server, uri)
                tools.append(
                    {
                        "name": name,
                        "description": tool.get("description", "") + f"\n[UI Resource: {uri}]",
                        "parameters": tool.get("inputSchema", {"type": "object", "properties": {}}),
                    }
                )
        return {**input, "tools": tools}, by_name

    async def proxy(self, request: Json, agent_id: str) -> AsyncIterator[Json]:
        """Bypass the agent for allowlisted browser iframe requests."""
        yield {"type": "RUN_STARTED"}
        servers = self._servers(agent_id)
        server_id = request.get("serverId")
        matches = [
            item
            for item in servers
            if (
                item.server_id == server_id
                if server_id
                else item.server_hash == request.get("serverHash")
            )
        ]
        server = matches[0] if len(matches) == 1 else None
        if server is None:
            result: Json = {"error": "Unknown MCP server"}
        elif request.get("method") not in (
            "tools/call",
            "resources/read",
            "notifications/message",
            "ping",
        ):
            result = {"error": "MCP method not allowed for UI proxy"}
        elif "params" in request and not isinstance(request["params"], dict):
            result = {"error": "Invalid MCP params"}
        else:
            try:
                result = await self._request(server, request["method"], request.get("params"))
            except Exception:
                result = {"error": "MCP request failed"}
        yield {"type": "RUN_FINISHED", "result": result}

    async def transform(
        self, source: AsyncIterator[Json], input: Json, tools: dict[str, tuple[MCPServer, str]]
    ) -> AsyncIterator[Json]:
        """Execute unresolved UI calls before the final run event and emit their activities."""
        calls: dict[str, Json] = {}
        resolved: set[str] = set()
        for message in input.get("messages", []):
            if message.get("role") == "assistant":
                for call in message.get("toolCalls", []):
                    calls[call["id"]] = {
                        "name": call["function"]["name"],
                        "args": call["function"].get("arguments", ""),
                    }
            elif message.get("role") == "tool":
                resolved.add(message["toolCallId"])
        terminal = None
        async for event in source:
            kind, call_id = event.get("type"), event.get("toolCallId", "")
            if kind == "TOOL_CALL_START":
                calls[call_id] = {"name": event["toolCallName"], "args": ""}
            elif kind == "TOOL_CALL_ARGS" and call_id in calls:
                calls[call_id]["args"] += event.get("delta", "")
                if len(calls[call_id]["args"].encode()) > self.config.max_argument_bytes:
                    raise ValueError("MCP arguments exceed configured limit")
            elif kind == "TOOL_CALL_RESULT":
                resolved.add(call_id)
            if kind == "RUN_FINISHED":
                terminal = event
            else:
                yield event
        if terminal:
            for call_id, call in calls.items():
                if call_id in resolved or call["name"] not in tools:
                    continue
                server, resource_uri = tools[call["name"]]
                try:
                    arguments = json.loads(call["args"] or "{}")
                    if not isinstance(arguments, dict):
                        raise ValueError("MCP tool arguments must be an object")
                    result = await self._request(
                        server, "tools/call", {"name": call["name"], "arguments": arguments}
                    )
                    content = result.get("content", [])
                    text = "\n".join(
                        item["text"]
                        for item in content
                        if item.get("type") == "text" and isinstance(item.get("text"), str)
                    )
                    yield {
                        "type": "TOOL_CALL_RESULT",
                        "toolCallId": call_id,
                        "messageId": str(uuid4()),
                        "content": text or json.dumps(content),
                    }
                    activity: Json = {
                        "result": result,
                        "resourceUri": resource_uri,
                        "serverHash": server.server_hash,
                        "toolInput": arguments,
                    }
                    if server.server_id:
                        activity["serverId"] = server.server_id
                    yield {
                        "type": "ACTIVITY_SNAPSHOT",
                        "messageId": str(uuid4()),
                        "activityType": "mcp-apps",
                        "content": activity,
                        "replace": True,
                    }
                except Exception:
                    yield {
                        "type": "TOOL_CALL_RESULT",
                        "toolCallId": call_id,
                        "messageId": str(uuid4()),
                        "content": json.dumps({"error": "MCP tool execution failed"}),
                    }
            yield terminal
