"""Claude Agent SDK (Python) backend for the CopilotKit MCP Apps demo.

This agent has no bespoke tools — the CopilotKit runtime is wired with
``mcpApps: { servers: [...] }`` pointing at the public Excalidraw MCP
server (see ``src/app/api/copilotkit-mcp-apps/route.ts``). The runtime
auto-applies the MCP Apps middleware, which appends the remote MCP
server's tools to the AG-UI tool list forwarded to this agent on every
request and emits the activity events that CopilotKit's built-in
``MCPAppsActivityRenderer`` renders in the chat as a sandboxed iframe.

Implementation note:
    The shared ``run_agent`` in ``src/agents/agent.py`` ships a fixed
    sales-assistant tool registry (``TOOLS``) and ignores
    ``input_data.tools``. For MCP Apps we want the OPPOSITE — no
    bespoke tools, only the MCP-injected tools forwarded by the
    runtime. So this module owns its own streaming loop that:

    1. Builds the Anthropic ``tools`` list directly from
       ``input_data.tools`` (the MCP middleware injects them there).
    2. Streams Anthropic SSE through to AG-UI events.
    3. Pass-through: when Claude emits ``tool_use``, we emit
       ``TOOL_CALL_*`` events and stop. The MCP Apps middleware on the
       runtime layer intercepts the call, fetches the UI resource,
       emits the activity event, and re-invokes us with the tool
       result. No server-side tool execution loop here.

Reference:
https://docs.copilotkit.ai/integrations/claude-agent-sdk-python/generative-ui/mcp-apps
"""

from __future__ import annotations

import json
import os
import traceback
from collections.abc import AsyncIterator
from textwrap import dedent
from typing import Any

import anthropic
from ag_ui.core import (
    EventType,
    RunAgentInput,
    RunFinishedEvent,
    RunStartedEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallStartEvent,
)
from ag_ui.encoder import EventEncoder

from agents.claude_agent_sdk_adapter import normalize_claude_model


SYSTEM_PROMPT = dedent(
    """
    You draw simple diagrams in Excalidraw via the MCP tool.

    SPEED MATTERS. Produce a correct-enough diagram fast; do not optimize
    for polish. Target: one tool call, done in seconds.

    When the user asks for a diagram:
    1. Call `create_view` ONCE with 3-5 elements total: shapes + arrows +
       an optional title text.
    2. Use straightforward shapes (rectangle, ellipse, diamond) with plain
       `label` fields (`{"text": "...", "fontSize": 18}`) on them.
    3. Connect with arrows. Endpoints can be element centers or simple
       coordinates — you don't need edge anchors / fixedPoint bindings.
    4. Include ONE `cameraUpdate` at the END of the elements array that
       frames the whole diagram. Use an approved 4:3 size (600x450 or
       800x600). No opening camera needed.
    5. Reply with ONE short sentence describing what you drew.

    Every element needs a unique string `id` (e.g. `"b1"`, `"a1"`,
    `"title"`). Standard sizes: rectangles 160x70, ellipses/diamonds
    120x80, 40-80px gap between shapes.

    Do NOT:
    - Call `read_me`. You already know the basic shape API.
    - Make multiple `create_view` calls.
    - Iterate or refine. Ship on the first shot.
    - Add decorative colors / fills / zone backgrounds unless the user
      explicitly asks for them.
    - Add labels on arrows unless crucial.

    If the user asks for something specific (colors, more elements,
    particular layout), follow their lead — but still in ONE call.
    """
).strip()


def _build_anthropic_tools(input_tools: list[Any] | None) -> list[dict[str, Any]]:
    """Map AG-UI ``input_data.tools`` into Anthropic ``tools`` schemas.

    The MCP Apps middleware appends MCP server tools to ``input_data.tools``
    on every request. We forward them to Anthropic verbatim so Claude
    can pick the right MCP tool to call.
    """
    if not input_tools:
        return []

    out: list[dict[str, Any]] = []
    for tool in input_tools:
        name = getattr(tool, "name", None) or (
            tool.get("name") if isinstance(tool, dict) else None
        )
        if not name:
            continue
        description = getattr(tool, "description", None) or (
            tool.get("description") if isinstance(tool, dict) else ""
        )
        parameters = getattr(tool, "parameters", None)
        if parameters is None and isinstance(tool, dict):
            parameters = tool.get("parameters")

        # ``parameters`` is a JSON schema (or a JSON-encoded string).
        if isinstance(parameters, str):
            try:
                parameters = json.loads(parameters)
            except json.JSONDecodeError:
                parameters = {"type": "object", "properties": {}}
        if not isinstance(parameters, dict):
            parameters = {"type": "object", "properties": {}}

        out.append(
            {
                "name": name,
                "description": description or "",
                "input_schema": parameters,
            }
        )
    return out


def _convert_messages(input_data: RunAgentInput) -> list[dict[str, Any]]:
    """Flatten AG-UI messages into Anthropic ``messages`` shape.

    Preserve frontend/MCP tool continuations: after the runtime resolves a
    tool call it re-invokes this agent with the original assistant tool_use
    plus a tool result message. Anthropic needs those as structured
    assistant/user blocks, not flattened text, or the model never sees the MCP
    result and can repeat the same call.
    """
    messages: list[dict[str, Any]] = []
    for msg in input_data.messages or []:
        role = msg.role.value if hasattr(msg.role, "value") else str(msg.role)
        if role == "tool":
            tool_call_id = getattr(msg, "tool_call_id", None) or (
                getattr(msg, "toolCallId", None)
            )
            raw_content = getattr(msg, "content", None)
            result_text = _text_from_content(raw_content)
            if tool_call_id:
                messages.append(
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "tool_result",
                                "tool_use_id": tool_call_id,
                                "content": result_text,
                            }
                        ],
                    }
                )
            continue

        if role not in ("user", "assistant"):
            continue
        raw_content = getattr(msg, "content", None)
        content = _text_from_content(raw_content)

        if role == "assistant":
            tool_calls = getattr(msg, "tool_calls", None) or getattr(
                msg, "toolCalls", None
            )
            if tool_calls:
                content_blocks: list[dict[str, Any]] = []
                if content:
                    content_blocks.append({"type": "text", "text": content})
                for tool_call in tool_calls:
                    tool_call_id = getattr(tool_call, "id", None) or (
                        tool_call.get("id") if isinstance(tool_call, dict) else None
                    )
                    function = getattr(tool_call, "function", None) or (
                        tool_call.get("function")
                        if isinstance(tool_call, dict)
                        else None
                    )
                    tool_name = "unknown"
                    args_raw: Any = "{}"
                    if function:
                        tool_name = getattr(function, "name", None) or (
                            function.get("name")
                            if isinstance(function, dict)
                            else "unknown"
                        )
                        args_raw = getattr(function, "arguments", None) or (
                            function.get("arguments", "{}")
                            if isinstance(function, dict)
                            else "{}"
                        )
                    try:
                        tool_args = (
                            json.loads(args_raw)
                            if isinstance(args_raw, str)
                            else args_raw
                        )
                    except json.JSONDecodeError:
                        tool_args = {}
                    content_blocks.append(
                        {
                            "type": "tool_use",
                            "id": tool_call_id or "unknown",
                            "name": tool_name,
                            "input": tool_args,
                        }
                    )
                messages.append({"role": "assistant", "content": content_blocks})
                continue

        if content:
            messages.append({"role": role, "content": content})
    return messages


def _text_from_content(raw_content: Any) -> str:
    if isinstance(raw_content, str):
        return raw_content
    if isinstance(raw_content, list):
        parts: list[str] = []
        for part in raw_content:
            if hasattr(part, "text"):
                parts.append(part.text)
            elif isinstance(part, dict) and "text" in part:
                parts.append(part["text"])
        parts_text = "".join(parts)
        return parts_text if parts_text else json.dumps(raw_content)
    return ""


async def run_mcp_apps_agent(input_data: RunAgentInput) -> AsyncIterator[str]:
    """Pass-through Claude streaming loop for the MCP Apps demo.

    No bespoke tools. No server-side tool execution. Tools come in via
    the AG-UI request (injected by the MCP Apps middleware), and tool
    calls go back out as AG-UI events for the runtime middleware to
    intercept.
    """
    encoder = EventEncoder()
    client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))

    thread_id = input_data.thread_id or "default"
    run_id = input_data.run_id or "run-1"
    msg_id = f"msg-{run_id}"

    yield encoder.encode(
        RunStartedEvent(type=EventType.RUN_STARTED, thread_id=thread_id, run_id=run_id)
    )

    tools = _build_anthropic_tools(input_data.tools)
    messages = _convert_messages(input_data)

    yield encoder.encode(
        TextMessageStartEvent(
            type=EventType.TEXT_MESSAGE_START,
            message_id=msg_id,
            role="assistant",
        )
    )

    try:
        stream_kwargs: dict[str, Any] = {
            "model": normalize_claude_model(
                os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4.6")
            ),
            "max_tokens": 4096,
            "system": SYSTEM_PROMPT,
            "messages": messages,
        }
        if tools:
            stream_kwargs["tools"] = tools

        async with client.messages.stream(**stream_kwargs) as stream:
            current_tool_id: str | None = None
            current_tool_name: str | None = None

            async for event in stream:
                etype = type(event).__name__

                if etype == "RawContentBlockStartEvent":
                    block = event.content_block  # type: ignore[attr-defined]
                    if block.type == "tool_use":
                        current_tool_id = block.id
                        current_tool_name = block.name
                        yield encoder.encode(
                            ToolCallStartEvent(
                                type=EventType.TOOL_CALL_START,
                                tool_call_id=current_tool_id,
                                tool_call_name=current_tool_name,
                                parent_message_id=msg_id,
                            )
                        )
                elif etype == "RawContentBlockDeltaEvent":
                    delta = event.delta  # type: ignore[attr-defined]
                    if delta.type == "text_delta":
                        yield encoder.encode(
                            TextMessageContentEvent(
                                type=EventType.TEXT_MESSAGE_CONTENT,
                                message_id=msg_id,
                                delta=delta.text,
                            )
                        )
                    elif delta.type == "input_json_delta" and current_tool_id:
                        yield encoder.encode(
                            ToolCallArgsEvent(
                                type=EventType.TOOL_CALL_ARGS,
                                tool_call_id=current_tool_id,
                                delta=delta.partial_json,
                            )
                        )
                elif etype in (
                    "RawContentBlockStopEvent",
                    "ParsedContentBlockStopEvent",
                ):
                    if current_tool_id:
                        yield encoder.encode(
                            ToolCallEndEvent(
                                type=EventType.TOOL_CALL_END,
                                tool_call_id=current_tool_id,
                            )
                        )
                        current_tool_id = None
                        current_tool_name = None
    except Exception:
        # Surface error as visible chat text so probes catch it instead
        # of silently breaking the SSE stream. Mirrors the pattern in
        # ``agents.agent.run_agent``.
        err_text = f"Agent error: {traceback.format_exc()}"
        yield encoder.encode(
            TextMessageContentEvent(
                type=EventType.TEXT_MESSAGE_CONTENT,
                message_id=msg_id,
                delta=err_text,
            )
        )

    yield encoder.encode(
        TextMessageEndEvent(type=EventType.TEXT_MESSAGE_END, message_id=msg_id)
    )

    yield encoder.encode(
        RunFinishedEvent(
            type=EventType.RUN_FINISHED, thread_id=thread_id, run_id=run_id
        )
    )
