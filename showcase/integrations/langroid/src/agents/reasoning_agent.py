"""Reasoning demos use Responses summaries; ordinary chat uses the chat adapter.

The provider's public reasoning summaries become AG-UI REASONING_MESSAGE_*
events. Each response is buffered before its message frames are emitted.
The tool-chain endpoint reuses Langroid ToolMessage schemas and handlers.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import traceback
import uuid
from typing import AsyncIterator

import openai
from ag_ui.core import (
    BaseEvent,
    EventType,
    ReasoningMessageContentEvent,
    ReasoningMessageEndEvent,
    ReasoningMessageStartEvent,
    ReasoningEncryptedValueEvent,
    RunAgentInput,
    RunErrorEvent,
    RunFinishedEvent,
    RunStartedEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
    ToolCallStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallResultEvent,
)
from ag_ui.encoder import EventEncoder
from fastapi import FastAPI
from starlette.endpoints import HTTPEndpoint
from starlette.requests import Request
from starlette.responses import StreamingResponse

SYSTEM_PROMPT = (
    "You are a helpful assistant. For each user question, first think "
    "step-by-step about the approach, then give a concise answer."
)

MODEL = "gpt-6-luna"


def _coerce_content(content) -> str:
    """Coerce an AG-UI message's content into a plain string.

    Handles the multimodal list shape (join the text parts) and the
    None/non-string fallbacks — the same coercion the previous
    single-turn `_extract_user_input` applied to the last user message.
    """
    content = content or ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        # Multimodal content: join the text parts. Coerce each part's text to
        # a string — a None or non-str `text` (e.g. an image part) would make
        # str.join raise TypeError, so fall back to "" for any non-str value.
        def _part_text(part) -> str:
            text = (
                part.get("text", "")
                if isinstance(part, dict)
                else getattr(part, "text", "")
            )
            return text if isinstance(text, str) else ""

        return "".join(_part_text(part) for part in content)
    return str(content)


def _to_responses_input(messages: list) -> list:
    """Keep conversation turns, tool calls and exact results across follow-ups."""
    items: list = [{"role": "system", "content": SYSTEM_PROMPT}]
    replayed_reasoning_ids: set[str] = set()
    for message in messages or []:
        msg = message.model_dump() if hasattr(message, "model_dump") else message
        role = msg.get("role")
        if role in ("user", "assistant"):
            content = _coerce_content(msg.get("content"))
            if content or role == "user":
                items.append({"role": role, "content": content})
            for call in msg.get("tool_calls", msg.get("toolCalls")) or []:
                # Our encrypted-value event carries the complete provider
                # reasoning item, including its identity, for stateless replay.
                encrypted = call.get("encrypted_value", call.get("encryptedValue"))
                if encrypted:
                    try:
                        reasoning = json.loads(encrypted).get("reasoning", [])
                    except (ValueError, AttributeError):
                        reasoning = []
                    for item in reasoning:
                        if (
                            isinstance(item, dict)
                            and item.get("type") == "reasoning"
                            and item.get("id")
                            and item["id"] not in replayed_reasoning_ids
                        ):
                            items.append(item)
                            replayed_reasoning_ids.add(item["id"])
                items.append(
                    {
                        "type": "function_call",
                        "call_id": call["id"],
                        "name": call["function"]["name"],
                        "arguments": call["function"]["arguments"],
                    }
                )
        elif role == "tool":
            items.append(
                {
                    "type": "function_call_output",
                    "call_id": msg.get("tool_call_id", msg.get("toolCallId")),
                    "output": _coerce_content(msg.get("content")),
                }
            )
    if len(items) == 1:
        items.append({"role": "user", "content": ""})
    return items


async def _run_reasoning_agent(
    run_input: RunAgentInput,
    *,
    with_tools: bool = False,
) -> AsyncIterator[BaseEvent]:
    """Map public summaries, answers and optional backend tools to AG-UI."""
    run_id = run_input.run_id or str(uuid.uuid4())
    thread_id = run_input.thread_id

    # Track the in-flight message frame so a mid-stream failure can close it
    # with the matching *_END before RUN_ERROR. @ag-ui/client's verifyEvents
    # rejects a RUN_FINISHED while a text/tool frame is open, and the apply
    # layer otherwise leaves a half-built message in client state.
    reasoning_msg_id: str | None = None
    text_msg_id: str | None = None

    try:
        model = os.getenv("OPENAI_REASONING_MODEL", MODEL)
        # The dedicated Luna tool-chain demo needs a larger reasoning budget:
        # medium can complete the tools without returning a public summary.
        reasoning_effort = "max" if with_tools and model == "gpt-6-luna" else "medium"
        chat_messages = _to_responses_input(run_input.messages or [])

        yield RunStartedEvent(
            type=EventType.RUN_STARTED, thread_id=thread_id, run_id=run_id
        )

        tools = []
        if with_tools:
            # Reuse the same Langroid tool schemas and execution boundary as
            # ordinary chat. Frontend tools remain on the ordinary chat route.
            from agents.agui_adapter import _run_backend_tool
            from agents._reasoning_tools import CHAIN_TOOLS

            tool_by_name = {tool.default_value("request"): tool for tool in CHAIN_TOOLS}

            tools = [
                {
                    "type": "function",
                    **tool.llm_function_schema().model_dump(),
                    "strict": False,
                }
                for tool in CHAIN_TOOLS
            ]
            chat_messages[0]["content"] += (
                " Use the available mock tools for weather, flights, stocks, and dice."
                " When asked to compare stocks or dice, call each tool in succession."
                " For flights and weather, search flights then check the destination weather."
                " After the tools complete, give a concise answer using their results."
            )

        async with openai.AsyncOpenAI() as client:
            for _ in range(8):
                response = await client.responses.create(
                    model=model,
                    input=chat_messages,
                    reasoning={"effort": reasoning_effort, "summary": "detailed"},
                    tools=tools or openai.NOT_GIVEN,
                    store=False,
                    include=["reasoning.encrypted_content"],
                )
                if response.status != "completed":
                    raise RuntimeError("Reasoning response did not complete")

                # Summaries are a public provider output, not private model
                # reasoning or prompt-generated <reasoning> tags.
                for item in response.output:
                    if item.type == "reasoning":
                        summary = "\n".join(
                            part.text for part in item.summary if part.text
                        )
                        if summary:
                            reasoning_msg_id = str(uuid.uuid4())
                            yield ReasoningMessageStartEvent(
                                message_id=reasoning_msg_id, role="reasoning"
                            )
                            yield ReasoningMessageContentEvent(
                                message_id=reasoning_msg_id, delta=summary
                            )
                            yield ReasoningMessageEndEvent(message_id=reasoning_msg_id)
                            reasoning_msg_id = None
                    elif item.type == "message":
                        text = "".join(
                            part.text
                            for part in item.content
                            if part.type == "output_text"
                        )
                        if text:
                            text_msg_id = str(uuid.uuid4())
                            yield TextMessageStartEvent(
                                message_id=text_msg_id, role="assistant"
                            )
                            yield TextMessageContentEvent(
                                message_id=text_msg_id, delta=text
                            )
                            yield TextMessageEndEvent(message_id=text_msg_id)
                            text_msg_id = None

                calls = [
                    item for item in response.output if item.type == "function_call"
                ]
                if not calls:
                    break
                # Stateless replay must retain the provider's reasoning item
                # (including encrypted_content) beside each tool call.
                chat_messages.extend(
                    item.model_dump(exclude_none=True) for item in response.output
                )
                reasoning_items = [
                    item.model_dump(exclude_none=True)
                    for item in response.output
                    if item.type == "reasoning"
                ]
                for call in calls:
                    if not with_tools or call.name not in tool_by_name:
                        raise ValueError("Unknown reasoning-chain tool")
                    args = json.loads(call.arguments)
                    if not isinstance(args, dict):
                        raise ValueError("Invalid reasoning-chain arguments")
                    text_msg_id = str(uuid.uuid4())
                    yield TextMessageStartEvent(
                        message_id=text_msg_id, role="assistant"
                    )
                    yield ToolCallStartEvent(
                        tool_call_id=call.call_id,
                        tool_call_name=call.name,
                        parent_message_id=text_msg_id,
                    )
                    yield ToolCallArgsEvent(
                        tool_call_id=call.call_id, delta=call.arguments
                    )
                    yield ToolCallEndEvent(tool_call_id=call.call_id)
                    if reasoning_items:
                        yield ReasoningEncryptedValueEvent(
                            subtype="tool-call",
                            entity_id=call.call_id,
                            encrypted_value=json.dumps({"reasoning": reasoning_items}),
                        )
                    result = await _run_backend_tool(
                        tool_by_name[call.name], call.name, args
                    )
                    result = result or ""
                    yield ToolCallResultEvent(
                        tool_call_id=call.call_id,
                        message_id=str(uuid.uuid4()),
                        content=result,
                    )
                    yield TextMessageEndEvent(message_id=text_msg_id)
                    text_msg_id = None
                    chat_messages.append(
                        {
                            "type": "function_call_output",
                            "call_id": call.call_id,
                            "output": result,
                        }
                    )
            else:
                raise RuntimeError("Reasoning tool-chain limit exceeded")

        yield RunFinishedEvent(
            type=EventType.RUN_FINISHED, thread_id=thread_id, run_id=run_id
        )

    except asyncio.CancelledError:  # noqa: TRY302 — propagate cancellation
        raise
    except Exception as exc:  # noqa: BLE001
        # Log the full failure server-side (never sent to the browser).
        print(f"[reasoning] run failed: {exc!r}", file=sys.stderr, flush=True)
        traceback.print_exc(file=sys.stderr)
        # Close any message frame opened before the failure so the terminal
        # RUN_ERROR is protocol-clean (no dangling *_START in client state).
        if text_msg_id is not None:
            yield TextMessageEndEvent(
                type=EventType.TEXT_MESSAGE_END,
                message_id=text_msg_id,
            )
        if reasoning_msg_id is not None:
            yield ReasoningMessageEndEvent(
                type=EventType.REASONING_MESSAGE_END,
                message_id=reasoning_msg_id,
            )
        # Generic client-facing message — no raw exception text (which can
        # carry provider URLs / request details) reaches the SSE stream.
        # RUN_ERROR is terminal: @ag-ui/client's verifyEvents rejects ANY
        # event after it, so we do NOT emit RUN_FINISHED here.
        yield RunErrorEvent(
            type=EventType.RUN_ERROR,
            message=f"agent run failed: {type(exc).__name__} (see server logs)",
        )


class ReasoningEndpoint(HTTPEndpoint):
    """Starlette HTTPEndpoint that emits REASONING_MESSAGE_* + TEXT_MESSAGE_*.

    Mounted at the sub-app root (``reasoning_app.mount("/", ...)``). The
    agent_server mounts this sub-app at ``/reasoning``; the HttpAgent posts to
    ``/reasoning/`` (route.ts ``createAgent("/reasoning/")``), so the outer
    Mount strips ``/reasoning`` and the inner Mount at ``/`` resolves here.
    """

    with_tools = False

    async def post(self, request: Request) -> StreamingResponse:
        encoder = EventEncoder()
        run_input = RunAgentInput.model_validate_json(await request.body())

        async def _gen() -> AsyncIterator[str]:
            async for event in _run_reasoning_agent(
                run_input, with_tools=self.with_tools
            ):
                yield encoder.encode(event)

        return StreamingResponse(
            _gen(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
                "Access-Control-Allow-Headers": "*",
            },
        )


# FastAPI sub-app so agent_server.py can mount at /reasoning. Mounting the
# HTTPEndpoint at "/" — the HttpAgent posts to ``/reasoning/`` so the outer
# Mount strips ``/reasoning`` and this inner Mount at ``/`` resolves the
# endpoint. NEVER use Route("", ...) — an empty-path Route crashes Starlette
# at import time.
reasoning_app = FastAPI(title="Langroid Reasoning Agent")


class ReasoningChainEndpoint(ReasoningEndpoint):
    with_tools = True


reasoning_app.mount("/tools", ReasoningChainEndpoint)
reasoning_app.mount("/", ReasoningEndpoint)
