from __future__ import annotations

from typing import Any


def sanitize_unresolved_tool_uses(
    messages: list[dict[str, Any]],
    tool_names: set[str] | None = None,
) -> list[dict[str, Any]]:
    """Drop unresolved assistant tool_use blocks before nested Claude calls."""

    resolved_tool_ids: set[str] = set()
    for msg in messages:
        content = msg.get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_result":
                tool_use_id = block.get("tool_use_id")
                if isinstance(tool_use_id, str) and tool_use_id:
                    resolved_tool_ids.add(tool_use_id)

    sanitized: list[dict[str, Any]] = []
    for msg in messages:
        content = msg.get("content")
        if msg.get("role") != "assistant" or not isinstance(content, list):
            sanitized.append(msg)
            continue

        filtered_content: list[Any] = []
        for block in content:
            if (
                isinstance(block, dict)
                and block.get("type") == "tool_use"
                and (tool_names is None or block.get("name") in tool_names)
                and block.get("id") not in resolved_tool_ids
            ):
                continue
            filtered_content.append(block)

        if filtered_content:
            sanitized.append({**msg, "content": filtered_content})

    return sanitized
