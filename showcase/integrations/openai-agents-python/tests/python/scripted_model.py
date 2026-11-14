"""A scripted Responses-API model and request builders for the tests.

``ScriptedModel`` replays one list of output items per model call as a
Responses stream (``output_item.added``, argument / text deltas,
``output_item.done``, ``response.completed``), so the SDK and the adapter
see the same event shapes the Responses API sends.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

from ag_ui.core import BaseEvent, RunAgentInput
from ag_ui_openai_agents import OpenAIAgentsAgent
from agents.models.interface import Model
from openai.types.responses import (
    Response,
    ResponseCompletedEvent,
    ResponseFunctionCallArgumentsDeltaEvent,
    ResponseFunctionToolCall,
    ResponseOutputItemAddedEvent,
    ResponseOutputItemDoneEvent,
    ResponseOutputMessage,
    ResponseOutputText,
    ResponseTextDeltaEvent,
)


def call(
    name: str, arguments: dict[str, Any], call_id: str
) -> ResponseFunctionToolCall:
    return ResponseFunctionToolCall(
        id=f"fc_{call_id}",
        call_id=call_id,
        name=name,
        arguments=json.dumps(arguments),
        type="function_call",
        status="completed",
    )


def text(content: str, item_id: str = "msg_1") -> ResponseOutputMessage:
    return ResponseOutputMessage(
        id=item_id,
        role="assistant",
        status="completed",
        type="message",
        content=[ResponseOutputText(type="output_text", text=content, annotations=[])],
    )


class ScriptedModel(Model):
    """Answers each model call with the next scripted list of output items."""

    def __init__(self, *turns: list[Any], chunk: int = 0) -> None:
        self.turns = list(turns)
        self.chunk = chunk  # split function arguments into deltas of this size
        self.calls: list[dict[str, Any]] = []

    async def get_response(self, *args, **kwargs):  # pragma: no cover - unused
        raise NotImplementedError

    async def stream_response(
        self,
        system_instructions,
        input,
        model_settings,
        tools,
        output_schema,
        handoffs,
        tracing,
        *,
        previous_response_id=None,
        conversation_id=None,
        prompt=None,
    ) -> AsyncIterator[Any]:
        self.calls.append(
            {
                "instructions": system_instructions,
                "input": input,
                "tools": [t.name for t in tools],
            }
        )
        output = self.turns.pop(0)
        seq = 0

        def nxt() -> int:
            nonlocal seq
            seq += 1
            return seq

        for index, item in enumerate(output):
            if isinstance(item, ResponseFunctionToolCall):
                added = item.model_copy(
                    update={"arguments": "", "status": "in_progress"}
                )
                yield ResponseOutputItemAddedEvent(
                    type="response.output_item.added",
                    item=added,
                    output_index=index,
                    sequence_number=nxt(),
                )
                args = item.arguments
                size = self.chunk or len(args) or 1
                for start in range(0, len(args), size):
                    yield ResponseFunctionCallArgumentsDeltaEvent(
                        type="response.function_call_arguments.delta",
                        delta=args[start : start + size],
                        item_id=item.id,
                        output_index=index,
                        sequence_number=nxt(),
                    )
            else:
                yield ResponseOutputItemAddedEvent(
                    type="response.output_item.added",
                    item=item.model_copy(
                        update={"content": [], "status": "in_progress"}
                    ),
                    output_index=index,
                    sequence_number=nxt(),
                )
                yield ResponseTextDeltaEvent(
                    type="response.output_text.delta",
                    delta=item.content[0].text,
                    item_id=item.id,
                    output_index=index,
                    content_index=0,
                    logprobs=[],
                    sequence_number=nxt(),
                )
            yield ResponseOutputItemDoneEvent(
                type="response.output_item.done",
                item=item,
                output_index=index,
                sequence_number=nxt(),
            )
        yield ResponseCompletedEvent(
            type="response.completed",
            sequence_number=nxt(),
            response=Response(
                id=f"resp_{len(self.calls)}",
                created_at=0,
                model="scripted",
                object="response",
                output=output,
                parallel_tool_calls=True,
                tool_choice="auto",
                tools=[],
            ),
        )


def run_input(messages, *, tools=(), state=None, context=()) -> RunAgentInput:
    return RunAgentInput(
        thread_id="thread-1",
        run_id="run-1",
        state=state or {},
        messages=list(messages),
        tools=list(tools),
        context=list(context),
        forwarded_props={},
    )


async def collect(agent: OpenAIAgentsAgent, run: RunAgentInput) -> list[BaseEvent]:
    return [event async for event in agent.run_streamed(run)]
