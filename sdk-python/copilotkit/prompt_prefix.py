"""Helpers that keep the start of a model request the same between turns.

Providers cache an unchanged request prefix (tools, system message, then
messages). A change near the start, such as new context in the system
message or a history window that moves by one message, makes every later
part of the request miss the cache. These helpers have no framework
imports, so each integration can use them.
"""

from typing import Any


def prepend_to_newest_user_message(messages: list[Any], note: str) -> list[Any] | None:
    """Returns a copy of ``messages`` (OpenAI-style dicts) with ``note`` at the
    start of the newest user message. Returns None when no user message has
    text content, so that the caller can keep the note in the system message.
    The given messages do not change."""
    for i in range(len(messages) - 1, -1, -1):
        message = messages[i]
        if not isinstance(message, dict) or message.get("role") != "user":
            continue
        content = message.get("content")
        if isinstance(content, str):
            new_content: Any = f"{note}\n\n{content}"
        elif isinstance(content, list):
            new_content = [{"type": "text", "text": f"{note}\n\n"}, *content]
        else:
            return None
        return [*messages[:i], {**message, "content": new_content}, *messages[i + 1 :]]
    return None


def drop_in_blocks(messages: list[Any], limit: int) -> list[Any]:
    """Keeps at most ``limit`` of the newest messages. Old messages are dropped
    in blocks of half the limit, not one per turn: the first kept message then
    stays the same until the next block drop, and the cache covers the
    history between drops.

    If the cut lands on a tool result, it moves back to the assistant message
    with the tool call, so the result keeps its call. Providers reject a tool
    result whose call is not in the request. The kept list can then be a few
    messages longer than ``limit``."""
    excess = len(messages) - limit
    if excess <= 0:
        return messages
    block = max(1, limit // 2)
    dropped = -(-excess // block) * block
    while dropped > 0 and _is_tool_result(messages[dropped]):
        dropped -= 1
    return messages[dropped:]


def _is_tool_result(message: Any) -> bool:
    return isinstance(message, dict) and message.get("role") == "tool"
