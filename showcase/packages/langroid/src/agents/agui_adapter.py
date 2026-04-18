"""
AG-UI SSE Adapter for Langroid

Implements the AG-UI protocol over SSE, translating between
Langroid's ChatAgent and the AG-UI event stream that CopilotKit expects.

AG-UI event types used:
  - RUN_STARTED / RUN_FINISHED
  - TEXT_MESSAGE_START / TEXT_MESSAGE_CONTENT / TEXT_MESSAGE_END
  - TOOL_CALL_START / TOOL_CALL_ARGS / TOOL_CALL_END
  - STATE_SNAPSHOT
"""

from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any, AsyncGenerator

from ag_ui.core import (
    EventType,
    RunStartedEvent,
    RunFinishedEvent,
    TextMessageStartEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    ToolCallStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    StateSnapshotEvent,
    RunAgentInput,
)
from fastapi import Request
from fastapi.responses import StreamingResponse

from agents.agent import (
    create_agent,
    ALL_TOOLS,
    BACKEND_TOOLS,
    FRONTEND_TOOL_NAMES,
)

import langroid as lr
from langroid.agent.tool_message import ToolMessage


def _sse_line(event: Any) -> str:
    """Format an AG-UI event as an SSE data line (camelCase keys per AG-UI protocol)."""
    if hasattr(event, "model_dump"):
        data = event.model_dump(by_alias=True, exclude_none=True)
    else:
        data = dict(event)
    return f"data: {json.dumps(data)}\n\n"


async def handle_run(request: Request) -> StreamingResponse:
    """Handle an AG-UI /run endpoint — parse input, run agent, stream events."""
    body = await request.json()
    run_input = RunAgentInput(**body)

    agent = create_agent()

    # Build conversation history from all messages so multi-turn works
    conversation_parts: list[str] = []
    if run_input.messages:
        for msg in run_input.messages:
            if hasattr(msg, "role") and hasattr(msg, "content"):
                conversation_parts.append(f"{msg.role}: {msg.content}")
            elif isinstance(msg, dict):
                role = msg.get("role", "user")
                content = msg.get("content", "")
                conversation_parts.append(f"{role}: {content}")
    user_message = "\n".join(conversation_parts) if conversation_parts else ""

    async def event_stream() -> AsyncGenerator[str, None]:
        run_id = str(uuid.uuid4())
        message_id = str(uuid.uuid4())

        # RUN_STARTED
        yield _sse_line(RunStartedEvent(
            type=EventType.RUN_STARTED,
            thread_id=run_input.thread_id or str(uuid.uuid4()),
            run_id=run_id,
        ))

        # Run the Langroid agent
        response = await agent.llm_response_async(user_message)

        if response is None:
            # Empty response — just finish
            yield _sse_line(RunFinishedEvent(
                type=EventType.RUN_FINISHED,
                thread_id=run_input.thread_id or "",
                run_id=run_id,
            ))
            return

        content = response.content if hasattr(response, "content") else str(response)

        # Langroid's OpenAI-backed LLM emits tool calls on
        # `response.oai_tool_calls` (OpenAI tools API) or `response.function_call`
        # (legacy function-calling API) with empty `content`. We must synthesize
        # AG-UI TOOL_CALL_* events from those so CopilotKit's frontend can
        # render the tool card (weather, haiku, etc.).
        oai_tool_calls = getattr(response, "oai_tool_calls", None) or []
        function_call = getattr(response, "function_call", None)

        if oai_tool_calls or function_call:
            # Emit synthesized tool-call events for each OAI tool call.
            calls_to_emit = []
            if oai_tool_calls:
                for tc in oai_tool_calls:
                    fn = getattr(tc, "function", None)
                    name = getattr(fn, "name", None) if fn is not None else None
                    raw_args = getattr(fn, "arguments", {}) if fn is not None else {}
                    if isinstance(raw_args, str):
                        try:
                            args_dict = json.loads(raw_args) if raw_args else {}
                        except json.JSONDecodeError:
                            args_dict = {}
                    elif isinstance(raw_args, dict):
                        args_dict = raw_args
                    else:
                        args_dict = {}
                    call_id = getattr(tc, "id", None) or str(uuid.uuid4())
                    if name:
                        calls_to_emit.append((call_id, name, args_dict))
            elif function_call is not None:
                # Legacy function_call shape: single call.
                name = getattr(function_call, "name", None)
                raw_args = getattr(function_call, "arguments", {}) or {}
                if isinstance(raw_args, str):
                    try:
                        args_dict = json.loads(raw_args) if raw_args else {}
                    except json.JSONDecodeError:
                        args_dict = {}
                elif isinstance(raw_args, dict):
                    args_dict = raw_args
                else:
                    args_dict = {}
                if name:
                    calls_to_emit.append((str(uuid.uuid4()), name, args_dict))

            # Map tool name -> ToolMessage class for backend execution.
            tool_by_name = {
                cls.default_value("request"): cls for cls in ALL_TOOLS
            }

            for call_id, tool_name, tool_args in calls_to_emit:
                # TOOL_CALL_START
                yield _sse_line(ToolCallStartEvent(
                    type=EventType.TOOL_CALL_START,
                    tool_call_id=call_id,
                    tool_call_name=tool_name,
                ))

                # TOOL_CALL_ARGS
                yield _sse_line(ToolCallArgsEvent(
                    type=EventType.TOOL_CALL_ARGS,
                    tool_call_id=call_id,
                    delta=json.dumps(tool_args),
                ))

                # TOOL_CALL_END
                yield _sse_line(ToolCallEndEvent(
                    type=EventType.TOOL_CALL_END,
                    tool_call_id=call_id,
                ))

                # For backend tools, execute and stream the result as text.
                if tool_name not in FRONTEND_TOOL_NAMES:
                    tool_cls = tool_by_name.get(tool_name)
                    result: str | None = None
                    if tool_cls is not None:
                        try:
                            tool_instance = tool_cls(**tool_args)
                            result = await asyncio.to_thread(tool_instance.handle)
                        except Exception as exc:  # pragma: no cover - defensive
                            result = json.dumps({"error": str(exc)})

                    if result:
                        msg_id = str(uuid.uuid4())
                        yield _sse_line(TextMessageStartEvent(
                            type=EventType.TEXT_MESSAGE_START,
                            message_id=msg_id,
                        ))
                        yield _sse_line(TextMessageContentEvent(
                            type=EventType.TEXT_MESSAGE_CONTENT,
                            message_id=msg_id,
                            delta=result,
                        ))
                        yield _sse_line(TextMessageEndEvent(
                            type=EventType.TEXT_MESSAGE_END,
                            message_id=msg_id,
                        ))

            # RUN_FINISHED
            yield _sse_line(RunFinishedEvent(
                type=EventType.RUN_FINISHED,
                thread_id=run_input.thread_id or "",
                run_id=run_id,
            ))
            return

        # Check if the response contains a tool call parsed from content
        tool_msg = _try_parse_tool(content, agent)

        if tool_msg is not None:
            tool_name = tool_msg.default_value("request") if hasattr(tool_msg, "default_value") else getattr(tool_msg, "request", "unknown")
            tool_call_id = str(uuid.uuid4())

            # Build tool arguments (exclude metadata fields)
            tool_args = {}
            for field_name, field_info in tool_msg.model_fields.items():
                if field_name in ("request", "purpose", "result"):
                    continue
                tool_args[field_name] = getattr(tool_msg, field_name)

            # TOOL_CALL_START
            yield _sse_line(ToolCallStartEvent(
                type=EventType.TOOL_CALL_START,
                tool_call_id=tool_call_id,
                tool_call_name=tool_name,
            ))

            # TOOL_CALL_ARGS
            yield _sse_line(ToolCallArgsEvent(
                type=EventType.TOOL_CALL_ARGS,
                tool_call_id=tool_call_id,
                delta=json.dumps(tool_args),
            ))

            # TOOL_CALL_END
            yield _sse_line(ToolCallEndEvent(
                type=EventType.TOOL_CALL_END,
                tool_call_id=tool_call_id,
            ))

            # If it's a backend tool, execute it and stream the result as text
            if tool_name not in FRONTEND_TOOL_NAMES:
                result = await asyncio.to_thread(tool_msg.handle)

                # AG-UI protocol requires TextMessageContentEvent.delta to be
                # non-empty; skip the whole text-message block if the tool
                # handler returned nothing.
                if result:
                    yield _sse_line(TextMessageStartEvent(
                        type=EventType.TEXT_MESSAGE_START,
                        message_id=message_id,
                    ))
                    yield _sse_line(TextMessageContentEvent(
                        type=EventType.TEXT_MESSAGE_CONTENT,
                        message_id=message_id,
                        delta=result,
                    ))
                    yield _sse_line(TextMessageEndEvent(
                        type=EventType.TEXT_MESSAGE_END,
                        message_id=message_id,
                    ))
        else:
            # Plain text response — stream it. AG-UI requires a non-empty
            # delta, so skip emission when the LLM returned no text (e.g.
            # a pure tool-call turn where content was stripped to "").
            if content:
                yield _sse_line(TextMessageStartEvent(
                    type=EventType.TEXT_MESSAGE_START,
                    message_id=message_id,
                ))
                yield _sse_line(TextMessageContentEvent(
                    type=EventType.TEXT_MESSAGE_CONTENT,
                    message_id=message_id,
                    delta=content,
                ))
                yield _sse_line(TextMessageEndEvent(
                    type=EventType.TEXT_MESSAGE_END,
                    message_id=message_id,
                ))

        # RUN_FINISHED
        yield _sse_line(RunFinishedEvent(
            type=EventType.RUN_FINISHED,
            thread_id=run_input.thread_id or "",
            run_id=run_id,
        ))

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def _try_parse_tool(content: str, agent: lr.ChatAgent) -> ToolMessage | None:
    """Try to parse a Langroid ToolMessage from the LLM response content."""
    try:
        msg = agent.agent_response(content)
        if msg is not None and isinstance(msg, ToolMessage):
            return msg
    except Exception:
        pass

    # Try JSON-based parsing as fallback
    try:
        data = json.loads(content)
        request = data.get("request")
        if request:
            for tool_cls in ALL_TOOLS:
                if tool_cls.default_value("request") == request:
                    return tool_cls(**data)
        # Check for OpenAI function_call style
        name = data.get("name") or data.get("function", {}).get("name")
        args = data.get("arguments") or data.get("function", {}).get("arguments", {})
        if name:
            if isinstance(args, str):
                args = json.loads(args)
            for tool_cls in ALL_TOOLS:
                if tool_cls.default_value("request") == name:
                    return tool_cls(**args)
    except (json.JSONDecodeError, Exception):
        pass

    return None
