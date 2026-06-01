"""LlamaIndex agent backing the In-Chat HITL (useHumanInTheLoop) demo.

The `book_call` tool is defined on the frontend via `useHumanInTheLoop`.
The LlamaIndex AG-UI workflow router (AGUIChatWorkflow) does NOT
dynamically pick up frontend-declared tools from the CopilotKit run
request — it only recognises tools registered via the `frontend_tools`
constructor argument. Without a backend-side stub the workflow never
emits `ToolCallChunkWorkflowEvent` for `book_call`, so the CopilotKit
runtime never transitions the render status to "executing" and the
time-picker buttons stay disabled.

The stub below provides just enough schema for the LLM to call
`book_call` and for the workflow to emit the proper AG-UI events.
Actual execution happens on the frontend; the stub is never invoked
because CopilotKit intercepts the tool call before the backend can
process the result.

Mirrors `langgraph-python/src/agents/hitl_in_chat_agent.py`.

NOTE: We subclass AGUIChatWorkflow to fix three upstream library bugs:

  1. ToolCallChunkWorkflowEvent is emitted without parent_message_id,
     causing the client to create a duplicate assistant message.

  2. _snapshot_messages embeds toolCalls in the MESSAGES_SNAPSHOT AND
     emits separate TOOL_CALL_CHUNK events for the same calls, so the
     client ends up with the tool call registered twice.

  3. ag_ui_message_to_llama_index_message converts AG-UI ToolMessages to
     ChatMessage(role="user") instead of ChatMessage(role="tool"), so the
     OpenAI API call doesn't include a proper tool-result message and
     aimock's hasToolResult matcher fails on the second leg.
"""

from __future__ import annotations

import json
import os
import re
import uuid
from typing import Any, Dict, List, Optional, Union

from llama_index.core.llms import ChatMessage, ChatResponse, MessageRole, TextBlock
from llama_index.core.tools import FunctionTool
from llama_index.core.workflow import Context, step
from llama_index.core.workflow.events import StopEvent
from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.agent import (
    AGUIChatWorkflow,
    DEFAULT_STATE_PROMPT,
    InputEvent,
    LoopEvent,
    ToolCallEvent,
)
from llama_index.protocols.ag_ui.agent import ToolCallResultEvent
from llama_index.protocols.ag_ui.events import (
    MessagesSnapshotWorkflowEvent,
    StateSnapshotWorkflowEvent,
    TextMessageChunkWorkflowEvent,
    ToolCallChunkWorkflowEvent,
    ToolCallEndWorkflowEvent,
)
from ag_ui.core import EventType
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router
from llama_index.protocols.ag_ui.utils import (
    ag_ui_message_to_llama_index_message,
    llama_index_message_to_ag_ui_message,
    timestamp,
)

_openai_kwargs = {}
if os.environ.get("OPENAI_BASE_URL"):
    _openai_kwargs["api_base"] = os.environ["OPENAI_BASE_URL"]


def _book_call_stub(topic: str, attendee: str) -> str:
    """Ask the user to pick a time slot for a call.

    The picker UI presents fixed candidate slots; the user's choice is
    returned to the agent.
    """
    # Frontend-only tool — CopilotKit intercepts the call and renders the
    # TimePickerCard.  This stub satisfies the AGUIChatWorkflow tool
    # registry so the proper AG-UI events are emitted.
    return ""


_book_call_tool = FunctionTool.from_defaults(
    fn=_book_call_stub,
    name="book_call",
    description=(
        "Ask the user to pick a time slot for a call. The picker UI "
        "presents fixed candidate slots; the user's choice is returned "
        "to the agent."
    ),
)


def _fix_tool_messages(chat_history: List[ChatMessage]) -> None:
    """Fix tool-result messages that the upstream library incorrectly
    converts to role='user'.

    The library's ag_ui_message_to_llama_index_message converts AG-UI
    ToolMessages to ChatMessage(role='user') because llama-index-core
    didn't originally support role='tool'.  Modern versions DO support
    it (MessageRole.TOOL), and the OpenAI SDK needs role='tool' to send
    a proper tool-result message.  Without this fix, the OpenAI API
    call has no tool-result message and aimock's hasToolResult matcher
    fails on the second leg.
    """
    for msg in chat_history:
        if msg.role.value == "user" and "tool_call_id" in msg.additional_kwargs:
            msg.role = MessageRole.TOOL


class ToolCallResultWorkflowEvent(ToolCallEndWorkflowEvent):
    """Emit a TOOL_CALL_RESULT AG-UI event for backend tools.

    llama-index-protocols-ag-ui v0.2.2 has no built-in workflow event for
    TOOL_CALL_RESULT — ToolCallChunkWorkflowEvent emits the call but the
    result is never forwarded to the frontend. Without this event,
    CopilotKit's useRenderTool never transitions from "executing" to
    "complete" and rendered tool cards stay in their loading state.

    Subclasses ToolCallEndWorkflowEvent so it passes the AG_UI_EVENTS
    isinstance filter in the router's stream_events loop.
    """

    message_id: str = ""
    content: str = ""
    role: Optional[str] = "tool"
    type: EventType = EventType.TOOL_CALL_RESULT


class FixedAGUIChatWorkflow(AGUIChatWorkflow):
    """AGUIChatWorkflow that fixes duplicate tool-call rendering and
    tool-result message formatting.

    See module docstring for the three upstream bugs this addresses.

    render_only_tool_names: set of tool names that use useRenderTool
    on the frontend. For these tools, aggregate_tool_calls emits a
    TOOL_CALL_RESULT event so the render callback transitions to
    status "complete". Interactive tools (useHumanInTheLoop,
    useComponent) must NOT be in this set.
    """

    render_only_tool_names: set = set()

    def _snapshot_messages(self, ctx: Context, chat_history: List[ChatMessage]) -> None:
        """Emit MESSAGES_SNAPSHOT without toolCalls on assistant messages.

        We create clean copies of assistant messages that strip both
        ag_ui_tool_calls metadata AND the <tool_call> XML tags that the
        upstream _snapshot_messages would re-extract.  This ensures the
        MESSAGES_SNAPSHOT contains no toolCalls — they arrive exclusively
        via TOOL_CALL_CHUNK events.
        """
        cleaned = []
        for msg in chat_history:
            if msg.role == "assistant":
                content = msg.content or ""
                content = re.sub(
                    r"<tool_call>[\s\S]*?</tool_call>", "", content
                ).strip()

                clone = ChatMessage(
                    role=msg.role,
                    content=content if content else None,
                    additional_kwargs={
                        k: v
                        for k, v in msg.additional_kwargs.items()
                        if k != "ag_ui_tool_calls"
                    },
                )
                cleaned.append(clone)
            else:
                cleaned.append(msg)

        ag_ui_messages = [llama_index_message_to_ag_ui_message(m) for m in cleaned]

        ctx.write_event_to_stream(
            MessagesSnapshotWorkflowEvent(
                timestamp=timestamp(),
                messages=ag_ui_messages,
            )
        )

    @step
    async def chat(
        self, ctx: Context, ev: InputEvent | LoopEvent
    ) -> Optional[Union[StopEvent, ToolCallEvent]]:
        # ------------------------------------------------------------------
        # Duplicated from AGUIChatWorkflow.chat with three changes:
        #   1. Assign a stable `id` to the assistant response message
        #   2. Pass `parent_message_id` on ToolCallChunkWorkflowEvent
        #   3. Fix tool-result messages to use role='tool' not 'user'
        # ------------------------------------------------------------------
        if isinstance(ev, InputEvent):
            ag_ui_messages = ev.input_data.messages
            chat_history = [
                ag_ui_message_to_llama_index_message(m) for m in ag_ui_messages
            ]

            # FIX 3: convert incorrectly-roled tool messages
            _fix_tool_messages(chat_history)

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
        else:
            chat_history = await ctx.store.get("chat_history")

        tools = list(self.frontend_tools.values())
        tools.extend(list(self.backend_tools.values()))

        resp_gen = await self.llm.astream_chat_with_tools(
            tools=tools,
            chat_history=chat_history,
            allow_parallel_tool_calls=True,
        )

        resp_id = str(uuid.uuid4())
        resp = ChatResponse(message=ChatMessage(role="assistant", content=""))

        async for resp in resp_gen:
            if resp.delta:
                ctx.write_event_to_stream(
                    TextMessageChunkWorkflowEvent(
                        role="assistant",
                        delta=resp.delta,
                        timestamp=timestamp(),
                        message_id=resp_id,
                    )
                )

        # FIX 1: Assign a stable ID to the assistant message so
        # MESSAGES_SNAPSHOT and TOOL_CALL events reference the same message.
        resp.message.additional_kwargs["id"] = resp_id

        chat_history.append(resp.message)
        self._snapshot_messages(ctx, [*chat_history])
        await ctx.store.set("chat_history", chat_history)

        tool_calls = self.llm.get_tool_calls_from_response(
            resp, error_on_no_tool_call=False
        )
        if tool_calls:
            await ctx.store.set("num_tool_calls", len(tool_calls))
            frontend_tool_calls = [
                tool_call
                for tool_call in tool_calls
                if tool_call.tool_name in self.frontend_tools
            ]
            backend_tool_calls = [
                tool_call
                for tool_call in tool_calls
                if tool_call.tool_name in self.backend_tools
            ]

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
                        # FIX 2: attach to the assistant message
                        parent_message_id=resp_id,
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
                        # FIX 2: attach to the assistant message
                        parent_message_id=resp_id,
                    )
                )

            return None

        return StopEvent()

    @step
    async def aggregate_tool_calls(
        self, ctx: Context, ev: ToolCallResultEvent
    ) -> Optional[Union[StopEvent, LoopEvent]]:
        """Override to emit TOOL_CALL_RESULT events for backend tools.

        The upstream aggregate_tool_calls processes backend tool results
        internally (adding to chat_history + MESSAGES_SNAPSHOT) but never
        emits a TOOL_CALL_RESULT AG-UI event. Without it, CopilotKit's
        useRenderTool never transitions to "complete" and tool cards stay
        in their loading state forever.
        """
        num_tool_calls = await ctx.store.get("num_tool_calls")
        tool_call_results: List[ToolCallResultEvent] = ctx.collect_events(
            ev, [ToolCallResultEvent] * num_tool_calls
        )
        if tool_call_results is None:
            return None

        frontend_tool_calls = [
            r for r in tool_call_results if r.tool_name in self.frontend_tools
        ]
        backend_tool_calls = [
            r for r in tool_call_results if r.tool_name in self.backend_tools
        ]

        new_tool_messages = []
        for tool_result in backend_tool_calls:
            new_tool_messages.append(
                ChatMessage(
                    role="tool",
                    content=tool_result.tool_output.content,
                    additional_kwargs={
                        "tool_call_id": tool_result.tool_call_id,
                    },
                )
            )
            # Emit TOOL_CALL_RESULT so useRenderTool transitions to "complete"
            ctx.write_event_to_stream(
                ToolCallResultWorkflowEvent(
                    tool_call_id=tool_result.tool_call_id,
                    message_id=str(uuid.uuid4()),
                    content=tool_result.tool_output.content,
                    role="tool",
                )
            )

        chat_history = await ctx.store.get("chat_history")
        if new_tool_messages:
            chat_history.extend(new_tool_messages)
            self._snapshot_messages(ctx, [*chat_history])
            await ctx.store.set("chat_history", chat_history)

        if len(frontend_tool_calls) > 0:
            # Emit TOOL_CALL_RESULT for render-only frontend tools (those
            # registered via useRenderTool, like get_weather). These tools
            # execute server-side and need the result forwarded so the
            # render callback transitions to status "complete".
            #
            # Do NOT emit for interactive frontend tools (those using
            # useHumanInTheLoop like generate_task_steps, book_call, or
            # useComponent like show_card). Those tools need CopilotKit to
            # manage the result lifecycle — premature TOOL_CALL_RESULT
            # would skip past the "executing" state and disable interactive
            # buttons.
            for tool_result in frontend_tool_calls:
                if tool_result.tool_name in self.render_only_tool_names:
                    ctx.write_event_to_stream(
                        ToolCallResultWorkflowEvent(
                            tool_call_id=tool_result.tool_call_id,
                            message_id=str(uuid.uuid4()),
                            content=tool_result.tool_output.content,
                            role="tool",
                        )
                    )
            return StopEvent()

        return LoopEvent(messages=chat_history)


async def _workflow_factory():
    return FixedAGUIChatWorkflow(
        llm=OpenAI(model="gpt-4o-mini", **_openai_kwargs),
        frontend_tools=[_book_call_tool],
        backend_tools=[],
        system_prompt=(
            "You help users book an onboarding call with the sales team. "
            "When they ask to book a call, call the frontend-provided "
            "`book_call` tool with a short topic and the user's name. "
            "Keep any chat reply to one short sentence."
        ),
        initial_state={},
    )


hitl_in_chat_router = get_ag_ui_workflow_router(
    workflow_factory=_workflow_factory,
)
