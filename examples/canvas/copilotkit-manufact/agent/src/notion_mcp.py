"""MCP-Use client wrapper around the official Notion MCP server.

Replaces the previous Composio HTTP backend. Spawns
`npx -y @notionhq/notion-mcp-server` over stdio for the duration of each
call and exposes a tiny synchronous facade so `notion_integration.py`
doesn't have to learn asyncio.

Auth: Notion integration token via `NOTION_TOKEN`. Get one at
https://notion.so/my-integrations and SHARE the leads database with
that integration (Notion's per-database access model — a fresh token
sees zero databases until shared).

Tool mapping (Notion MCP server uses the new "data source" data model):
- `API-retrieve-a-database`  → fetch DB metadata + the `data_sources` list
- `API-retrieve-a-data-source` → fetch a data-source's property schema
- `API-query-data-source`    → paginated row query (replaces old query)
- `API-patch-page`           → update a page's properties (lead edit)
- `API-post-page`            → create a page in a database (lead add)

The "data source" hop is new in Notion's 2025-09 API: a database may
contain multiple data sources, but for the lead-form usecase the first
data source is the only one we need.
"""

from __future__ import annotations

import asyncio
import json
import os
import threading
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv

load_dotenv()


# --- mcp-use lazy import -------------------------------------------------

def _client_config() -> Dict[str, Any]:
    """Build the mcp-use client config for the Notion MCP server.

    Token is read from `NOTION_TOKEN` (or empty string — the server will
    return 401 on first call, which we surface to the caller). Pinned to
    `npx -y` so the kit stays self-contained — no global install needed.
    """
    token = os.getenv("NOTION_TOKEN", "") or ""
    return {
        "mcpServers": {
            "notion": {
                "command": "npx",
                "args": ["-y", "@notionhq/notion-mcp-server"],
                "env": {"NOTION_TOKEN": token},
            }
        }
    }


# --- async core ----------------------------------------------------------

async def _call_tool_async(name: str, arguments: Dict[str, Any]) -> Any:
    """Open a fresh mcp-use session, call one tool, close it.

    Per-call sessions keep this stateless and avoid leaking subprocesses
    when the agent's event loop dies between turns. Notion MCP's stdio
    server boots in well under 1s on a warm npx cache, so the overhead is
    acceptable for the kit's 50-row demo workload.
    """
    from mcp_use import MCPClient  # type: ignore

    client = MCPClient.from_dict(_client_config())
    try:
        session = await client.create_session("notion")
        if session is None:
            raise RuntimeError(
                "Failed to create MCP session for Notion. "
                "Is `npx` on PATH? Is NOTION_TOKEN set?"
            )
        return await session.call_tool(name, arguments)
    finally:
        try:
            await client.close_all_sessions()
        except Exception:  # noqa: BLE001 - cleanup is best-effort
            pass


def _run_sync(coro) -> Any:
    """Run an async coroutine to completion from sync code, even when
    a parent event loop is already running.

    `langgraph dev`'s tool-execution path is sync-on-async — `asyncio.run`
    would error with "asyncio.run() cannot be called from a running event
    loop". Detect that case and dispatch to a worker thread with its own
    fresh loop.
    """
    try:
        asyncio.get_running_loop()
        running = True
    except RuntimeError:
        running = False

    if not running:
        return asyncio.run(coro)

    result_holder: Dict[str, Any] = {}

    def _runner() -> None:
        loop = asyncio.new_event_loop()
        try:
            asyncio.set_event_loop(loop)
            result_holder["value"] = loop.run_until_complete(coro)
        except Exception as e:  # noqa: BLE001
            result_holder["error"] = e
        finally:
            loop.close()

    t = threading.Thread(target=_runner, daemon=True)
    t.start()
    t.join()
    if "error" in result_holder:
        raise result_holder["error"]  # type: ignore[misc]
    return result_holder.get("value")


# --- response normalization ---------------------------------------------

def _extract_payload(result: Any) -> Dict[str, Any]:
    """Normalize an MCP tool-call result into a plain dict.

    The Notion MCP server returns the Notion REST response as JSON inside
    a `text` content block. Parse it back out so callers see the shape
    they'd get from a direct API hit.
    """
    if result is None:
        raise RuntimeError("Notion MCP returned no result")

    # `result` is a CallToolResult-like object. Prefer `.structuredContent`
    # if present (newer MCP SDKs), else parse the first text block.
    sc = getattr(result, "structuredContent", None)
    if isinstance(sc, dict) and sc:
        return sc

    content = getattr(result, "content", None)
    if not content:
        raise RuntimeError(
            f"Notion MCP returned empty content. is_error="
            f"{getattr(result, 'isError', None)} raw={result!r}"
        )

    for block in content:
        text = getattr(block, "text", None)
        if not text:
            continue
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            # Some error blocks come through as plain prose.
            raise RuntimeError(f"Notion MCP error: {text}")

    raise RuntimeError(f"Notion MCP returned no parseable text block: {result!r}")


# --- public sync facade -------------------------------------------------

def _has_token() -> bool:
    return bool(os.getenv("NOTION_TOKEN"))


def mcp_fetch_database_schema(database_id: str) -> Dict[str, Any]:
    """Return Notion's response from `databases.retrieve` (via MCP).

    Includes `title`, `data_sources[]`, etc. — but NOT the property
    schema itself, which now lives on each data source. Use
    `mcp_fetch_data_source` if you need the property list.
    """
    return _extract_payload(
        _run_sync(_call_tool_async(
            "API-retrieve-a-database",
            {"database_id": database_id},
        ))
    )


def mcp_fetch_data_source(data_source_id: str) -> Dict[str, Any]:
    """Return Notion's response from `dataSources.retrieve` (via MCP).

    Has `properties` (the column schema) and `title`.
    """
    return _extract_payload(
        _run_sync(_call_tool_async(
            "API-retrieve-a-data-source",
            {"data_source_id": data_source_id},
        ))
    )


def mcp_query_data_source(
    data_source_id: str,
    page_size: int = 100,
    start_cursor: Optional[str] = None,
) -> Dict[str, Any]:
    """Paginated row query against a Notion data source.

    Returns the raw `dataSources.query` response: `{results, has_more,
    next_cursor}`. Pagination is the caller's job — see
    `notion_integration.fetch_leads`.
    """
    args: Dict[str, Any] = {
        "data_source_id": data_source_id,
        "page_size": page_size,
    }
    if start_cursor:
        args["start_cursor"] = start_cursor
    return _extract_payload(
        _run_sync(_call_tool_async("API-query-data-source", args))
    )


# --- write paths -------------------------------------------------------
#
# Verified against `@notionhq/notion-mcp-server` v2.2.x: the update tool is
# `API-patch-page` and the create tool is `API-post-page` (run
# `await session.list_tools()` to confirm — every tool has an `API-` prefix).
# Both wrap Notion's REST endpoints and echo the resulting Page object so the
# caller can re-derive a Lead row from `page.properties` without a follow-up
# fetch.

def mcp_update_page(page_id: str, properties: Dict[str, Any]) -> Dict[str, Any]:
    """Update a Notion page's properties via `API-patch-page`.

    Returns the updated Page object (with the full properties echo) on
    success; raises on transport / 4xx errors. Used by
    `notion_integration.update_lead` for canvas-driven writes.
    """
    return _extract_payload(
        _run_sync(_call_tool_async(
            "API-patch-page",
            {"page_id": page_id, "properties": properties},
        ))
    )


def mcp_create_page(
    parent_database_id: str, properties: Dict[str, Any]
) -> Dict[str, Any]:
    """Create a Notion page in a database via `API-post-page`.

    Returns the new Page object (with id, url, and the full properties echo)
    on success; raises on transport / 4xx errors. Used by
    `notion_integration.insert_lead`.
    """
    return _extract_payload(
        _run_sync(_call_tool_async(
            "API-post-page",
            {
                "parent": {"type": "database_id", "database_id": parent_database_id},
                "properties": properties,
            },
        ))
    )


def has_notion_token() -> bool:
    """Sentinel for callers that want to short-circuit before spawning npx."""
    return _has_token()
