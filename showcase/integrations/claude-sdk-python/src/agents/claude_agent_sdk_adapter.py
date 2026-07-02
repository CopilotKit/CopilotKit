"""Official Claude Agent SDK adapter wiring for the showcase agents."""

from __future__ import annotations

import os
from collections.abc import AsyncIterator, Callable
from typing import Any

from ag_ui.core import EventType, RunAgentInput, StateSnapshotEvent
from ag_ui.encoder import EventEncoder
from ag_ui_claude_sdk import ClaudeAgentAdapter
from claude_agent_sdk import create_sdk_mcp_server, tool as sdk_tool

COPILOTKIT_MCP_SERVER_NAME = "copilotkit"
COPILOTKIT_TOOL_PREFIX = f"mcp__{COPILOTKIT_MCP_SERVER_NAME}__"

ExecuteTool = Callable[
    [str, dict[str, Any], Any, list[dict[str, Any]] | None],
    tuple[str, Any | None],
]


def should_use_claude_agent_sdk(
    *,
    input_data: RunAgentInput,
    backend_tools: list[dict[str, Any]],
    frontend_tool_names: set[str],
    preprocess_user_parts: Any = None,
) -> bool:
    """Return whether this request can safely run through the official adapter."""

    base_url = os.getenv("ANTHROPIC_BASE_URL", "")
    if "aimock" in base_url:
        return False

    # The official adapter uses the Claude Agent SDK process transport, which
    # has no supported per-request HTTP header hook for x-aimock-context today.
    if preprocess_user_parts is not None:
        return False

    # The official Claude Agent SDK path can execute backend MCP tools, but it
    # does not yet bridge CopilotKit frontend/runtime tools back through AG-UI.
    if frontend_tool_names:
        return False

    if _has_structured_user_content(input_data):
        return False

    return True


# @region[claude-agent-sdk-python-adapter]
async def run_with_claude_agent_sdk(
    input_data: RunAgentInput,
    *,
    system_prompt: str,
    tools: list[dict[str, Any]],
    state: Any,
    model: str,
    execute_tool: ExecuteTool,
    max_turns: int = 10,
) -> AsyncIterator[str]:
    """Run through the official AG-UI Claude adapter and emit SSE chunks."""

    # @region[claude-agent-sdk-agent-setup]
    encoder = EventEncoder()
    state_box = {"state": state}
    pending_state_snapshots: list[Any] = []
    sdk_tools = _build_sdk_tools(
        tools,
        execute_tool=execute_tool,
        get_state=lambda: state_box["state"],
        set_state=lambda next_state: _set_state(
            next_state,
            state_box,
            pending_state_snapshots,
        ),
    )

    options: dict[str, Any] = {
        "model": _normalize_claude_agent_sdk_model(model),
        "system_prompt": system_prompt,
        "tools": [],
        "permission_mode": "dontAsk",
        "max_turns": max_turns,
    }

    if sdk_tools:
        options["mcp_servers"] = {
            COPILOTKIT_MCP_SERVER_NAME: create_sdk_mcp_server(
                COPILOTKIT_MCP_SERVER_NAME,
                "1.0.0",
                tools=sdk_tools,
            )
        }
        options["allowed_tools"] = [
            f"{COPILOTKIT_TOOL_PREFIX}{schema['name']}" for schema in tools
        ]

    adapter = ClaudeAgentAdapter(
        name="claude-sdk-python",
        options=options,
    )
    run_input = _with_initial_state(input_data, state)

    async for event in adapter.run(run_input):
        if event.type == EventType.TOOL_CALL_RESULT and pending_state_snapshots:
            yield encoder.encode(
                StateSnapshotEvent(
                    type=EventType.STATE_SNAPSHOT,
                    snapshot=pending_state_snapshots.pop(0),
                )
            )
        yield encoder.encode(event)
    # @endregion[claude-agent-sdk-agent-setup]


def _build_sdk_tools(
    tool_schemas: list[dict[str, Any]],
    *,
    execute_tool: ExecuteTool,
    get_state: Callable[[], Any],
    set_state: Callable[[Any], None],
) -> list[Any]:
    return [
        _make_sdk_tool(
            schema,
            execute_tool=execute_tool,
            get_state=get_state,
            set_state=set_state,
        )
        for schema in tool_schemas
    ]


def _make_sdk_tool(
    schema: dict[str, Any],
    *,
    execute_tool: ExecuteTool,
    get_state: Callable[[], Any],
    set_state: Callable[[Any], None],
) -> Any:
    name = schema["name"]
    description = schema.get("description", "")
    input_schema = schema.get("input_schema", {"type": "object", "properties": {}})

    @sdk_tool(name, description, input_schema)
    async def sdk_tool_handler(args: dict[str, Any]):
        try:
            result_text, next_state = execute_tool(
                name,
                dict(args or {}),
                get_state(),
                None,
            )
            if next_state is not None:
                set_state(next_state)
            return {"content": [{"type": "text", "text": result_text}]}
        except Exception as exc:
            return {
                "content": [{"type": "text", "text": str(exc)}],
                "is_error": True,
            }

    return sdk_tool_handler


def _set_state(
    next_state: Any,
    state_box: dict[str, Any],
    pending_state_snapshots: list[Any],
) -> None:
    state_box["state"] = next_state
    pending_state_snapshots.append(_snapshot_from_state(next_state))


def _snapshot_from_state(state: Any) -> Any:
    if hasattr(state, "model_dump"):
        return state.model_dump()
    return state


def _with_initial_state(input_data: RunAgentInput, state: Any) -> RunAgentInput:
    if getattr(input_data, "state", None) is not None or state is None:
        return input_data
    if hasattr(input_data, "model_copy"):
        return input_data.model_copy(update={"state": state})
    if hasattr(input_data, "copy"):
        return input_data.copy(update={"state": state})
    return input_data


def _has_structured_user_content(input_data: RunAgentInput) -> bool:
    for msg in input_data.messages or []:
        role = msg.role.value if hasattr(msg.role, "value") else str(msg.role)
        raw_content = getattr(msg, "content", None)
        if role == "user" and isinstance(raw_content, list):
            for part in raw_content:
                part_type = getattr(part, "type", None) or (
                    part.get("type") if isinstance(part, dict) else None
                )
                if part_type and part_type != "text":
                    return True
    return False


def _normalize_claude_agent_sdk_model(model: str) -> str:
    return "claude-sonnet-4-6" if model == "claude-sonnet-4.6" else model


# @endregion[claude-agent-sdk-python-adapter]
