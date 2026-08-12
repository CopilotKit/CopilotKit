"""Reasoning-aware AG-UI workflow router for LlamaIndex.

Why this module exists
----------------------
The stock ``llama-index-protocols-ag-ui`` router
(``get_ag_ui_workflow_router``) cannot surface model reasoning to the
AG-UI ``REASONING_MESSAGE_*`` channel. Three independent reasons, all in
``llama-index-protocols-ag-ui==0.2.2``:

1. ``AGUIChatWorkflow.chat`` reads ONLY ``resp.delta`` (assistant text)
   from the LLM stream and emits ``TEXT_MESSAGE_CHUNK`` events. It never
   inspects reasoning content.
2. The package defines no reasoning workflow event at all — there is no
   ``ReasoningMessage*WorkflowEvent`` to emit.
3. ``AGUIWorkflowRouter.run`` only forwards events whose class is in the
   ``AG_UI_EVENTS`` allowlist to the SSE stream; that tuple contains no
   reasoning type, so a reasoning event would be filtered out even if a
   custom workflow emitted one.

Real OpenAI reasoning models (gpt-5, o3, o4-mini, …) stream the chain of
thought through the **Responses API** as
``response.reasoning_summary_text.delta`` events; aimock renders the
fixture's abstract ``reasoning`` field into that same Responses-API shape.
LlamaIndex's ``OpenAIResponses`` LLM does NOT surface those summary deltas
through its own stream processing (``process_response_event`` only captures
the terminal ``ResponseReasoningItem``), but it DOES attach the raw
``ResponseStreamEvent`` as ``ChatResponse.raw`` on every yielded chunk — so
the ``ResponseReasoningSummaryTextDeltaEvent`` still reaches us untouched on
``resp.raw``, where ``.delta`` carries the incremental summary text.

The older chat-completions convention (``delta.reasoning_content`` on the
wire — DeepSeek / vLLM) is also still handled for backward compatibility:
LlamaIndex's chat-completions ``OpenAI`` LLM does not lift
``reasoning_content`` into ``ChatResponse.additional_kwargs``, but it DOES
attach the raw ``ChatCompletionChunk`` as ``ChatResponse.raw``, where the
OpenAI SDK preserves ``reasoning_content`` in ``delta.model_extra``.

This module reuses the framework's workflow and router unchanged except
for the three gaps above:

* ``ReasoningMessage{Start,Content,End}WorkflowEvent`` wrap the real
  ``ag_ui.core`` reasoning events (``role="reasoning"``) so the encoder
  serializes them as ``REASONING_MESSAGE_*`` SSE frames.
* ``ReasoningAGUIChatWorkflow`` subclasses ``AGUIChatWorkflow`` and
  overrides ``chat`` to read the reasoning delta off each chunk's
  ``resp.raw`` (``_extract_reasoning_delta`` — Responses-API summary deltas
  first, chat-completions ``reasoning_content`` as a fallback) and emit a
  reasoning message (START → CONTENT… → END) ahead of the assistant text,
  then defer to the base behavior for text, tool calls, and looping.
* ``get_reasoning_ag_ui_workflow_router`` builds that workflow and a
  router whose SSE allowlist additionally passes the reasoning events.

No vendored package files are modified, and no demo behavior is weakened.
The agent endpoint still speaks the stock AG-UI protocol; it just no
longer drops the reasoning channel the model already produces.
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Dict, List, Optional, Union

from ag_ui.core import RunAgentInput
from ag_ui.core.events import (
    EventType,
    ReasoningMessageContentEvent,
    ReasoningMessageEndEvent,
    ReasoningMessageStartEvent,
)
from fastapi import APIRouter

from llama_index.core.llms import ChatMessage, ChatResponse
from llama_index.core.llms.function_calling import FunctionCallingLLM
from llama_index.core.workflow import Context, Event, StopEvent, step
from llama_index.protocols.ag_ui.agent import (
    AGUIChatWorkflow,
    InputEvent,
    LoopEvent,
    ToolCallEvent,
)
from llama_index.protocols.ag_ui.events import (
    TextMessageChunkWorkflowEvent,
)
from llama_index.protocols.ag_ui.router import AG_UI_EVENTS, AGUIWorkflowRouter
from llama_index.protocols.ag_ui.utils import timestamp


class ReasoningMessageStartWorkflowEvent(ReasoningMessageStartEvent, Event):
    type: EventType = EventType.REASONING_MESSAGE_START  # pyright: ignore[reportIncompatibleVariableOverride]


class ReasoningMessageContentWorkflowEvent(ReasoningMessageContentEvent, Event):
    type: EventType = EventType.REASONING_MESSAGE_CONTENT  # pyright: ignore[reportIncompatibleVariableOverride]


class ReasoningMessageEndWorkflowEvent(ReasoningMessageEndEvent, Event):
    type: EventType = EventType.REASONING_MESSAGE_END  # pyright: ignore[reportIncompatibleVariableOverride]


# Reasoning events the framework router's allowlist does not know about.
_REASONING_AG_UI_EVENTS = (
    ReasoningMessageStartWorkflowEvent,
    ReasoningMessageContentWorkflowEvent,
    ReasoningMessageEndWorkflowEvent,
)

# Extended allowlist used by the reasoning router's SSE forwarder.
REASONING_AG_UI_EVENTS = (*AG_UI_EVENTS, *_REASONING_AG_UI_EVENTS)


# OpenAI Responses-API event type that carries an incremental reasoning
# summary delta. Matched by string so we don't import the openai type (the
# module already follows a "handle the raw event without importing it"
# convention; the type name has also moved across openai-python releases).
_RESPONSES_REASONING_DELTA_TYPE = "response.reasoning_summary_text.delta"

logger = logging.getLogger(__name__)

# Prefix shared by every Responses-API reasoning event type string
# (e.g. ``response.reasoning_summary_text.delta``,
# ``response.reasoning_text.delta``). Used only to detect a reasoning-shaped
# event we could not parse, so an upstream SDK rename surfaces loudly instead
# of silently dropping all reasoning.
_RESPONSES_REASONING_TYPE_PREFIX = "response.reasoning"

# One-time-warning dedupe: distinct unmatched reasoning-shaped ``raw`` type
# strings already logged. Bounds log volume to one line per novel type so a
# rename warns once instead of spamming every chunk of a stream.
_warned_unmatched_reasoning_types: set[str] = set()


def _warn_unmatched_reasoning_once(raw_type: str) -> None:
    """Emit a one-time warning for a reasoning-shaped but unparsed raw type.

    Reasoning is strictly additive, so the caller still gets ``""`` and the
    stream is unaffected. This only makes an OpenAI-SDK event-type rename
    greppable instead of an invisible regression.
    """
    if raw_type in _warned_unmatched_reasoning_types:
        return
    _warned_unmatched_reasoning_types.add(raw_type)
    logger.warning(
        "Saw a reasoning-shaped stream event raw_type=%r that does not match "
        "the known delta type %r (and exposed no extractable delta); dropping "
        "reasoning for this chunk. The OpenAI SDK may have renamed the "
        "reasoning event type — update _RESPONSES_REASONING_DELTA_TYPE.",
        raw_type,
        _RESPONSES_REASONING_DELTA_TYPE,
    )


def _extract_reasoning_delta(resp: ChatResponse) -> str:
    """Pull an incremental reasoning delta off a streamed chat response.

    Handles both LLM transports this package can drive:

    * **Responses API** (``OpenAIResponses`` — the real-reasoning path used by
      ``reasoning_agent`` / ``tool_rendering_reasoning_chain_agent``). Each
      yielded ``ChatResponse`` carries the raw ``ResponseStreamEvent`` on
      ``resp.raw``; a ``response.reasoning_summary_text.delta`` event exposes
      the incremental summary text on ``.delta``.
    * **Chat Completions** (legacy ``OpenAI`` LLM, DeepSeek / vLLM
      ``reasoning_content`` convention). ``resp.raw`` is a
      ``ChatCompletionChunk`` whose ``delta`` carries ``reasoning_content`` in
      ``model_extra`` (pydantic) or directly.

    Returns ``""`` when the chunk carries no reasoning delta (or has an
    unexpected shape) so the caller can treat reasoning as strictly additive.
    """
    raw = getattr(resp, "raw", None)
    if raw is None:
        return ""

    # --- Responses API: response.reasoning_summary_text.delta -------------
    # ``raw`` is a single ResponseStreamEvent (pydantic) or a plain dict.
    raw_type = getattr(raw, "type", None)
    if raw_type is None and isinstance(raw, dict):
        raw_type = raw.get("type")
    if raw_type == _RESPONSES_REASONING_DELTA_TYPE:
        delta = getattr(raw, "delta", None)
        if delta is None and isinstance(raw, dict):
            delta = raw.get("delta")
        if delta:
            return str(delta)
        # Known reasoning type but no extractable delta: shape changed under us.
        _warn_unmatched_reasoning_once(str(raw_type))
        return ""

    # An unmatched event that still clearly looks like reasoning (the SDK
    # likely renamed the delta type) — warn once and drop, rather than
    # silently swallowing every reasoning chunk.
    if isinstance(raw_type, str) and raw_type.startswith(
        _RESPONSES_REASONING_TYPE_PREFIX
    ):
        _warn_unmatched_reasoning_once(raw_type)
        return ""

    # --- Chat Completions: delta.reasoning_content ------------------------
    # ``raw`` is a ChatCompletionChunk (pydantic) or a plain dict depending on
    # the OpenAI SDK version; handle both without importing the chunk type.
    choices = getattr(raw, "choices", None)
    if choices is None and isinstance(raw, dict):
        choices = raw.get("choices")
    if not choices:
        return ""
    first = choices[0]
    delta = getattr(first, "delta", None)
    if delta is None and isinstance(first, dict):
        delta = first.get("delta")
    if delta is None:
        return ""
    # Pydantic model: non-standard fields land in ``model_extra``.
    extra = getattr(delta, "model_extra", None)
    if isinstance(extra, dict) and extra.get("reasoning_content"):
        return str(extra["reasoning_content"])
    # Direct attribute (some SDK builds expose it) or plain dict.
    direct = getattr(delta, "reasoning_content", None)
    if direct:
        return str(direct)
    if isinstance(delta, dict) and delta.get("reasoning_content"):
        return str(delta["reasoning_content"])
    return ""


class ReasoningAGUIChatWorkflow(AGUIChatWorkflow):
    """``AGUIChatWorkflow`` that also surfaces ``reasoning_content``.

    Overrides the ``chat`` step so reasoning deltas streamed by the model
    are emitted as AG-UI ``REASONING_MESSAGE_*`` events ahead of the
    assistant text. Everything else (tool-call dispatch, message
    snapshots, looping) is inherited from the base class unchanged.
    """

    @step
    async def chat(
        self, ctx: Context, ev: InputEvent | LoopEvent
    ) -> Optional[Union[StopEvent, ToolCallEvent]]:
        # This mirrors AGUIChatWorkflow.chat verbatim except for the
        # reasoning-emission block inside the stream loop. Kept as an explicit
        # override (not a super() call) because the base step streams the LLM
        # response itself — there is no narrower hook to wrap.
        if isinstance(ev, InputEvent):
            chat_history = await self._prepare_input(ctx, ev)
        else:
            chat_history = await ctx.store.get("chat_history")

        tools = list(self.frontend_tools.values())
        tools.extend(list(self.backend_tools.values()))

        if tools:
            resp_gen = await self.llm.astream_chat_with_tools(
                tools=tools,
                chat_history=chat_history,
                allow_parallel_tool_calls=True,
            )
        else:
            # No-tools path: ``astream_chat_with_tools(tools=[])`` resolves the
            # tool spec to ``None``, and LlamaIndex 0.5.6's
            # ``OpenAIResponses._get_model_kwargs`` then crashes on
            # ``[*initial_tools, *None]`` (it only defaults ``tools`` when the
            # key is absent, not when it is explicitly ``None``). Stream
            # directly to sidestep that bug — there are no tool calls to
            # dispatch anyway, and ``_finalize_chat`` handles a tool-less
            # response correctly.
            resp_gen = await self.llm.astream_chat(chat_history)

        text_msg_id = str(uuid.uuid4())
        reasoning_msg_id: Optional[str] = None
        resp = ChatResponse(message=ChatMessage(role="assistant", content=""))
        # No-tools path only: ``astream_chat`` over ``OpenAIResponses`` streams
        # the answer as ``resp.delta`` but does NOT accumulate it back onto the
        # terminal ``resp.message.content`` (unlike ``astream_chat_with_tools``,
        # which the tools branch and the GREEN
        # ``tool_rendering_reasoning_chain_agent`` rely on). So the message we
        # hand to ``_finalize_chat`` — and thus the MESSAGES_SNAPSHOT — is
        # content-empty even though ~hundreds of chars streamed, producing an
        # empty assistant bubble (``text-unstable``). Accumulate the deltas
        # ourselves and reconcile onto the finalized message below. Tracked only
        # when there are no tools; the tools branch already carries content.
        accumulated_text: list[str] = []
        track_text = not tools

        async for resp in resp_gen:
            reasoning_delta = _extract_reasoning_delta(resp)
            # Load-bearing non-empty guard: ReasoningMessageContentEvent.delta
            # is Field(min_length=1), so emitting an empty delta would raise a
            # pydantic ValidationError mid-stream — never gate on truthiness alone.
            if reasoning_delta:
                if reasoning_msg_id is None:
                    reasoning_msg_id = str(uuid.uuid4())
                    ctx.write_event_to_stream(
                        ReasoningMessageStartWorkflowEvent(
                            message_id=reasoning_msg_id,
                            role="reasoning",
                        )
                    )
                ctx.write_event_to_stream(
                    ReasoningMessageContentWorkflowEvent(
                        message_id=reasoning_msg_id,
                        delta=reasoning_delta,
                    )
                )

            if resp.delta:
                if track_text:
                    accumulated_text.append(resp.delta)
                # Reasoning precedes the answer; close the reasoning message
                # before the first text chunk so the frontend reasoning slot
                # finalizes ahead of the assistant message.
                if reasoning_msg_id is not None:
                    ctx.write_event_to_stream(
                        ReasoningMessageEndWorkflowEvent(message_id=reasoning_msg_id)
                    )
                    reasoning_msg_id = None
                ctx.write_event_to_stream(
                    TextMessageChunkWorkflowEvent(
                        role="assistant",
                        delta=resp.delta,
                        timestamp=timestamp(),
                        message_id=text_msg_id,
                    )
                )

        # If the model produced reasoning but no assistant text (pure
        # tool-call turn), still close the reasoning message.
        if reasoning_msg_id is not None:
            ctx.write_event_to_stream(
                ReasoningMessageEndWorkflowEvent(message_id=reasoning_msg_id)
            )

        # No-tools reconciliation: ``astream_chat`` left the terminal message
        # content-empty (see ``accumulated_text`` above). Fold the streamed
        # answer back onto ``resp.message`` BEFORE ``_finalize_chat`` snapshots
        # it, so MESSAGES_SNAPSHOT carries the real assistant text instead of an
        # empty bubble. Strictly additive: only fills a message the stream left
        # empty — never overwrites content the LLM already accumulated.
        if track_text and accumulated_text and not resp.message.content:
            resp.message.content = "".join(accumulated_text)

        return await self._finalize_chat(ctx, resp, chat_history)

    async def _prepare_input(self, ctx: Context, ev: InputEvent) -> List[ChatMessage]:
        """Build chat history + emit the initial state snapshot.

        Lifted verbatim from ``AGUIChatWorkflow.chat`` (the ``InputEvent``
        branch) so the override can reuse it without duplicating the state
        handling and system-prompt injection.
        """
        from llama_index.core.llms import TextBlock
        from llama_index.protocols.ag_ui.agent import DEFAULT_STATE_PROMPT
        from llama_index.protocols.ag_ui.events import StateSnapshotWorkflowEvent
        from llama_index.protocols.ag_ui.utils import (
            ag_ui_message_to_llama_index_message,
        )

        ag_ui_messages = ev.input_data.messages
        chat_history = [ag_ui_message_to_llama_index_message(m) for m in ag_ui_messages]

        state = ev.input_data.state
        if isinstance(state, dict):
            state.pop("messages", None)
        elif isinstance(state, str):
            state = json.loads(state)
            state.pop("messages", None)
        else:
            state = self.initial_state.copy()

        await ctx.store.set("state", state)
        ctx.write_event_to_stream(StateSnapshotWorkflowEvent(snapshot=state))

        if state:
            for msg in chat_history[::-1]:
                if msg.role.value == "user":
                    msg.content = DEFAULT_STATE_PROMPT.format(
                        state=str(state), user_input=msg.content
                    )
                    break

        if self.system_prompt:
            if chat_history[0].role.value == "system":
                chat_history[0].blocks.append(TextBlock(text=self.system_prompt))
            else:
                chat_history.insert(
                    0, ChatMessage(role="system", content=self.system_prompt)
                )

        await ctx.store.set("chat_history", chat_history)
        return chat_history

    async def _finalize_chat(
        self,
        ctx: Context,
        resp: ChatResponse,
        chat_history: List[ChatMessage],
    ) -> Optional[Union[StopEvent, ToolCallEvent]]:
        """Append the assistant message, dispatch tool calls, loop or stop.

        Lifted verbatim from the tail of ``AGUIChatWorkflow.chat`` (after the
        stream loop) so the override reuses the base tool-dispatch behavior.
        """
        chat_history.append(resp.message)
        self._snapshot_messages(ctx, [*chat_history])
        await ctx.store.set("chat_history", chat_history)

        tool_calls = self.llm.get_tool_calls_from_response(
            resp, error_on_no_tool_call=False
        )
        if tool_calls:
            await ctx.store.set("num_tool_calls", len(tool_calls))
            frontend_tool_calls = [
                tc for tc in tool_calls if tc.tool_name in self.frontend_tools
            ]
            backend_tool_calls = [
                tc for tc in tool_calls if tc.tool_name in self.backend_tools
            ]

            from llama_index.protocols.ag_ui.events import (
                ToolCallChunkWorkflowEvent,
            )

            for tool_call in backend_tool_calls:
                ctx.send_event(
                    ToolCallEvent(
                        tool_call_id=tool_call.tool_id,
                        tool_name=tool_call.tool_name,
                        tool_kwargs=tool_call.tool_kwargs,
                    )
                )
                ctx.write_event_to_stream(
                    ToolCallChunkWorkflowEvent(
                        tool_call_id=tool_call.tool_id,
                        tool_call_name=tool_call.tool_name,
                        delta=json.dumps(tool_call.tool_kwargs),
                    )
                )

            for tool_call in frontend_tool_calls:
                ctx.send_event(
                    ToolCallEvent(
                        tool_call_id=tool_call.tool_id,
                        tool_name=tool_call.tool_name,
                        tool_kwargs=tool_call.tool_kwargs,
                    )
                )
                ctx.write_event_to_stream(
                    ToolCallChunkWorkflowEvent(
                        tool_call_id=tool_call.tool_id,
                        tool_call_name=tool_call.tool_name,
                        delta=json.dumps(tool_call.tool_kwargs),
                    )
                )

            return None

        return StopEvent()


class ReasoningAGUIWorkflowRouter(AGUIWorkflowRouter):
    """``AGUIWorkflowRouter`` whose SSE forwarder also passes reasoning events."""

    async def run(self, input: RunAgentInput):  # noqa: A002 - match base signature
        from fastapi.responses import StreamingResponse
        from llama_index.protocols.ag_ui.events import (
            RunErrorWorkflowEvent,
            RunFinishedWorkflowEvent,
            RunStartedWorkflowEvent,
        )
        from llama_index.protocols.ag_ui.utils import workflow_event_to_sse

        workflow = await self.workflow_factory()
        handler = workflow.run(input_data=input)

        async def stream_response():
            try:
                yield workflow_event_to_sse(
                    RunStartedWorkflowEvent(
                        timestamp=timestamp(),
                        thread_id=input.thread_id,
                        run_id=input.run_id,
                    )
                )

                async for ev in handler.stream_events():
                    if isinstance(ev, REASONING_AG_UI_EVENTS):
                        yield workflow_event_to_sse(ev)

                _ = await handler

                yield workflow_event_to_sse(
                    RunFinishedWorkflowEvent(
                        timestamp=timestamp(),
                        thread_id=input.thread_id,
                        run_id=input.run_id,
                    )
                )
            except Exception as e:  # pragma: no cover - mirrors base behavior
                yield workflow_event_to_sse(
                    RunErrorWorkflowEvent(
                        timestamp=timestamp(),
                        message=str(e),
                        code=str(type(e)),
                    )
                )
                await handler.cancel_run()
                raise

        return StreamingResponse(stream_response(), media_type="text/event-stream")


def get_reasoning_ag_ui_workflow_router(
    llm: Optional[FunctionCallingLLM] = None,
    frontend_tools: Optional[List[Any]] = None,
    backend_tools: Optional[List[Any]] = None,
    initial_state: Optional[Dict[str, Any]] = None,
    system_prompt: Optional[str] = None,
    timeout: Optional[float] = 120,
) -> APIRouter:
    """Drop-in replacement for ``get_ag_ui_workflow_router`` that also emits
    AG-UI ``REASONING_MESSAGE_*`` events for ``reasoning_content`` the model
    streams. Same signature/usage as the stock factory.
    """

    async def workflow_factory():
        return ReasoningAGUIChatWorkflow(
            llm=llm,
            frontend_tools=frontend_tools,
            backend_tools=backend_tools,
            initial_state=initial_state,
            system_prompt=system_prompt,
            timeout=timeout,
        )

    return ReasoningAGUIWorkflowRouter(workflow_factory).router
