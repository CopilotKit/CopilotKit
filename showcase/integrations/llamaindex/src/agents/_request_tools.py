"""Forward CopilotKit request-time frontend tools to the LlamaIndex AG-UI LLM.

WHY THIS EXISTS
---------------
The llama-index AG-UI adapter (``llama_index.protocols.ag_ui``) builds the
tool list it hands to the LLM from ONLY the *static* ``frontend_tools`` /
``backend_tools`` passed at router-construction time (see
``AGUIChatWorkflow.chat`` -> ``tools = list(self.frontend_tools.values()) +
list(self.backend_tools.values())``). It never reads ``RunAgentInput.tools``,
the per-request tool list CopilotKit injects from the page's
``useFrontendTool`` / ``useHumanInTheLoop`` / ``useComponent`` hooks.

Every other working integration (LangGraph, ag2, ...) forwards the request's
injected tools to the model automatically — the gold-standard
``langgraph-python`` does it inside the framework runtime. LlamaIndex does not,
so any showcase demo whose page registers a tool the sub-router was constructed
WITHOUT (e.g. ``beautiful-chat`` injects ``toggleTheme`` / ``pieChart`` /
``barChart`` / ``scheduleTime`` but its router was built with
``frontend_tools=[]``) produces a request whose tool list differs from the
recorded aimock fixture. aimock 404s (``no_fixture_match``), the adapter raises
``openai.NotFoundError`` and emits ``RUN_ERROR`` instead of ``RUN_FINISHED`` →
the harness reports ``sse-missing``.

THE FIX
-------
A mixin that, at the start of the ``chat`` step, converts each
``RunAgentInput.tools`` entry into a no-op ``FunctionTool`` whose OpenAI wire
schema is *byte-faithful* to the schema the frontend injected, and merges them
into ``self.frontend_tools`` BEFORE the parent ``chat`` builds its tool list.
Because the merged tools land in ``self.frontend_tools``, every existing
``in self.frontend_tools`` classification in the adapter (tool-call routing,
``aggregate_tool_calls`` -> ``StopEvent``) treats them correctly as
frontend-resolved tools: their calls stream back to the client and are never
executed server-side. CopilotKit resolves the real result on the page.

A fresh workflow is constructed per request (``AGUIWorkflowRouter.run`` ->
``await self.workflow_factory()``), so mutating ``self.frontend_tools`` per
request is safe and never leaks across runs.

Statically-declared tools always win over an injected tool of the same name
(so a router that intentionally declares a backend tool keeps its server-side
implementation).
"""

from __future__ import annotations

import json
import uuid
from typing import Any, Dict, List, Optional, Union, cast

from ag_ui.core import RunAgentInput
from fastapi import APIRouter
from llama_index.core.llms import ChatMessage, ChatResponse, MessageRole, TextBlock
from llama_index.core.llms.function_calling import FunctionCallingLLM
from llama_index.core.tools import BaseTool, FunctionTool, ToolMetadata
from llama_index.core.workflow import Context, step

# StopEvent is re-exported by llama_index.core.workflow.events, but pyright flags
# that as a private re-export (reportPrivateImportUsage). Import from the public
# `workflows.events` module instead — verified to be the SAME class object.
from workflows.events import StopEvent
from llama_index.protocols.ag_ui.agent import (
    AGUIChatWorkflow,
    DEFAULT_STATE_PROMPT,
    InputEvent,
    LoopEvent,
    ToolCallEvent,
)
from llama_index.protocols.ag_ui.events import (
    StateSnapshotWorkflowEvent,
    TextMessageChunkWorkflowEvent,
    ToolCallChunkWorkflowEvent,
)
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router
from llama_index.protocols.ag_ui.utils import (
    ag_ui_message_to_llama_index_message,
    timestamp,
)


class _RawSchemaToolMetadata(ToolMetadata):
    """ToolMetadata that returns a verbatim, frontend-supplied JSON schema.

    The adapter serializes a tool to the OpenAI wire format via
    ``ToolMetadata.to_openai_tool`` -> ``get_parameters_dict``, which normally
    derives the schema from a pydantic ``fn_schema``. Round-tripping the
    injected JSON schema through a generated pydantic model can subtly reshape
    it (added ``title`` keys, reordered ``required``, ``$defs`` rewrites), which
    would diverge from the recorded aimock fixture. We instead carry the exact
    schema the page injected and hand it back unchanged.
    """

    def __init__(self, raw_parameters: Optional[Dict[str, Any]], **kwargs: Any):
        super().__init__(**kwargs)
        # Stored on the instance dict (ToolMetadata is a dataclass; this is an
        # extra, non-field attribute used only by get_parameters_dict below).
        object.__setattr__(self, "_raw_parameters", raw_parameters)

    def get_parameters_dict(self) -> dict:
        raw = getattr(self, "_raw_parameters", None)
        if raw is None:
            # Tool injected with no parameters schema — present an empty object
            # so the LLM sees a zero-arg tool (matches a ``z.object({})`` page
            # registration like beautiful-chat's ``toggleTheme``).
            return {"type": "object", "properties": {}}
        return raw


def _noop_stub(**kwargs: Any) -> str:
    """No-op sync body for a frontend-resolved tool.

    The adapter sends a ``ToolCallEvent`` for frontend tools too, which routes
    through ``handle_tool_call`` -> ``tool.acall(**kwargs)``. The real result is
    produced on the client and streamed back; this body is never the source of
    truth. ``aggregate_tool_calls`` then returns a ``StopEvent`` (the call was
    classified as frontend), so the frontend resolves the actual result.
    """
    return ""


async def _noop_stub_async(**kwargs: Any) -> str:
    """Async counterpart of ``_noop_stub`` for the ``acall`` path."""
    return ""


def request_tools_to_frontend_tools(
    input_data: RunAgentInput,
) -> Dict[str, BaseTool]:
    """Convert ``RunAgentInput.tools`` into a name -> stub-tool mapping.

    Built via ``FunctionTool.from_defaults`` with an explicit ``tool_metadata``
    so the OpenAI wire schema is the verbatim, frontend-supplied JSON schema
    (no pydantic round-trip reshaping that would diverge from the recorded
    aimock fixture), while reusing the battle-tested ``FunctionTool`` for the
    ``acall`` path.
    """
    result: Dict[str, BaseTool] = {}
    for tool in input_data.tools or []:
        metadata = _RawSchemaToolMetadata(
            raw_parameters=tool.parameters,
            name=tool.name,
            description=tool.description or tool.name,
            fn_schema=None,
        )
        result[tool.name] = FunctionTool.from_defaults(
            fn=_noop_stub,
            async_fn=_noop_stub_async,
            tool_metadata=metadata,
        )
    return result


def _fix_tool_messages_copy(chat_history: List[ChatMessage]) -> None:
    """Re-role tool-result messages the upstream converter mis-roles as ``user``.

    ``ag_ui_message_to_llama_index_message`` converts AG-UI ``ToolMessage`` to
    ``ChatMessage(role="user")`` (an upstream hack). The OpenAI SDK needs
    ``role="tool"`` to emit a proper tool-result message; aimock's
    ``hasToolResult`` matcher (``messages.some(role === "tool")``) likewise only
    sees the second-leg fixture when the role is ``tool``. Without this, a
    frontend tool's follow-up turn (``toggleTheme`` / ``scheduleTime``) sends
    the result as ``user`` → ``hasToolResult:false`` → the ``hasToolResult:true``
    fixture never matches → 404 → run error.

    Operates on a SHALLOW-copied list: it REPLACES affected entries with re-roled
    clones (rather than mutating the shared ``ChatMessage`` objects), so the
    caller's original ``chat_history`` — which also feeds ``_snapshot_messages``
    / the stored history and thus the client's rendered ``useComponent``
    surfaces — is left untouched.
    """
    for i, msg in enumerate(chat_history):
        if msg.role.value == "user" and "tool_call_id" in msg.additional_kwargs:
            chat_history[i] = ChatMessage(
                role=MessageRole.TOOL,
                content=msg.content,
                additional_kwargs=dict(msg.additional_kwargs),
            )


class RequestAwareAGUIChatWorkflow(AGUIChatWorkflow):
    """Upstream ``AGUIChatWorkflow`` + request-time frontend-tool forwarding,
    re-implementing ``chat`` with three targeted, empirically-validated changes.

    The single workflow ``make_request_aware_router`` builds. Design rationale,
    earned on the D5 beautiful-chat 5-cell suite (toggle / pie / bar / flights /
    schedule):

    - The bug: the llama-index AG-UI adapter never forwards
      ``RunAgentInput.tools`` to the LLM, so page-injected tools are invisible →
      the recorded fixture's tool call can't be satisfied → RUN_ERROR →
      ``sse-missing``.

    This ``chat`` is the upstream ``AGUIChatWorkflow.chat`` body with exactly
    three additions, each tied to a concrete failure mode (and NOTHING else —
    no stable ``id`` / ``parent_message_id`` regrouping like
    ``FixedAGUIChatWorkflow``, which breaks ``useComponent`` rendering):

      0. Request-tool forwarding: merge ``RunAgentInput.tools`` into
         ``self.frontend_tools`` so the LLM sees page-injected tools.
      1. FIX 3 (tool-result re-roling) applied ONLY to the LLM-bound message
         copy: AG-UI tool results are mis-roled ``role="user"`` upstream; the
         OpenAI request (and aimock's ``hasToolResult`` matcher) need
         ``role="tool"`` so the ``hasToolResult:true`` second-leg fixture matches
         (``toggleTheme`` / ``scheduleTime`` follow-up turns). We re-role a COPY,
         leaving the stored history / MESSAGES_SNAPSHOT untouched.
      2. Frontend tool calls are NOT re-emitted as TOOL_CALL_CHUNK events: the
         (bare, un-stripped) MESSAGES_SNAPSHOT already carries them via
         ``ag_ui_tool_calls``, and emitting the chunk too double-delivers the
         arguments — for an args-bearing frontend tool (``scheduleTime``) the
         doubled args concatenate (``{...}{...}``) and the client raises
         ``tool_argument_parse_failed``. The snapshot path alone both renders
         ``useComponent`` surfaces (``pieChart`` / ``barChart``) AND drives the
         HITL / frontend-tool flows. Backend tool calls DO still emit the chunk
         (their server-side execution loop depends on it).

    Empirical matrix that pins each choice:
    bare-snapshot + emit-frontend-chunk → pie/bar/toggle/flights pass, schedule
    fails (dup args); stripping the snapshot tool calls instead → schedule
    passes but pie/bar break. Dropping the frontend chunk (this design) keeps the
    snapshot for rendering AND removes the dup → all five pass.
    """

    @step
    async def chat(
        self, ctx: Context, ev: InputEvent | LoopEvent
    ) -> Optional[Union[StopEvent, ToolCallEvent]]:
        if isinstance(ev, InputEvent):
            # ADD 0: forward page-injected tools so the LLM can see/call them.
            # A fresh workflow is built per request, so mutating frontend_tools
            # is safe.
            injected = request_tools_to_frontend_tools(ev.input_data)
            for name, tool in injected.items():
                # Statically declared tools (frontend or backend) win.
                if name in self.frontend_tools or name in self.backend_tools:
                    continue
                self.frontend_tools[name] = tool

            ag_ui_messages = ev.input_data.messages
            chat_history = [
                ag_ui_message_to_llama_index_message(m) for m in ag_ui_messages
            ]

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

        # ADD 1: FIX 3 on the LLM-bound copy only (re-role tool results -> tool)
        # so the OpenAI request / aimock `hasToolResult` matcher sees a proper
        # tool-result message. We do NOT mutate `chat_history` itself — it feeds
        # the (bare) snapshot and stored history that drive client rendering.
        llm_chat_history = list(chat_history)
        _fix_tool_messages_copy(llm_chat_history)

        # `self.llm` is declared `LLM` by the base, but upstream's __init__
        # asserts `isinstance(self.llm, FunctionCallingLLM)`; the tool-calling
        # methods below (astream_chat_with_tools / get_tool_calls_from_response)
        # live on FunctionCallingLLM. Cast so the runtime-guaranteed type is
        # visible to the type checker (no behavior change).
        llm = cast(FunctionCallingLLM, self.llm)

        resp_gen = await llm.astream_chat_with_tools(
            tools=tools,
            chat_history=llm_chat_history,
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

        # Bare snapshot (inherited): keeps `ag_ui_tool_calls` so useComponent /
        # HITL / frontend tools render from the MESSAGES_SNAPSHOT.
        chat_history.append(resp.message)
        self._snapshot_messages(ctx, [*chat_history])
        await ctx.store.set("chat_history", chat_history)

        tool_calls = llm.get_tool_calls_from_response(resp, error_on_no_tool_call=False)
        if tool_calls:
            await ctx.store.set("num_tool_calls", len(tool_calls))
            frontend_tool_calls = [
                tc for tc in tool_calls if tc.tool_name in self.frontend_tools
            ]
            backend_tool_calls = [
                tc for tc in tool_calls if tc.tool_name in self.backend_tools
            ]

            # Backend tools: emit chunk AND dispatch (server-side execution loop
            # consumes the ToolCallEvent and loops back).
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

            # ADD 2: frontend tools — dispatch the ToolCallEvent (so the
            # workflow tracks completion / loops correctly) but do NOT emit the
            # TOOL_CALL_CHUNK: the bare snapshot's `ag_ui_tool_calls` already
            # delivers the call to the client. Emitting both doubles the
            # arguments (`{...}{...}`) and breaks args-bearing tools
            # (beautiful-chat's `scheduleTime`, pie/bar `useComponent`).
            #
            # NAME-SCOPED EXEMPTION (`generateSandboxedUi` only): the
            # open-generative-ui runtime middleware
            # (`open-generative-ui-middleware.ts`) builds the sandboxed iframe
            # exclusively from streamed TOOL_CALL_* events; it does NOT read the
            # snapshot's `ag_ui_tool_calls`. So for this one tool the
            # snapshot-only delivery yields 0 iframes (open-gen-ui /
            # open-gen-ui-advanced render nothing). We therefore stream the
            # chunk for `generateSandboxedUi` while keeping every other frontend
            # tool snapshot-only. The exemption is intentionally narrow — broaden
            # it and the double-args regression above returns.
            for tool_call in frontend_tool_calls:
                ctx.send_event(
                    ToolCallEvent(
                        tool_call_id=tool_call.tool_id,
                        tool_name=tool_call.tool_name,
                        tool_kwargs=tool_call.tool_kwargs,
                    )
                )
                if tool_call.tool_name == "generateSandboxedUi":
                    ctx.write_event_to_stream(
                        ToolCallChunkWorkflowEvent(
                            tool_call_id=tool_call.tool_id,
                            tool_call_name=tool_call.tool_name,
                            delta=json.dumps(tool_call.tool_kwargs),
                        )
                    )

            return None

        return StopEvent()


def make_request_aware_router(
    *,
    llm: FunctionCallingLLM,
    frontend_tools: Optional[List[Any]] = None,
    backend_tools: Optional[List[Any]] = None,
    system_prompt: Optional[str] = None,
    initial_state: Optional[Dict[str, Any]] = None,
    timeout: Optional[float] = 120,
) -> APIRouter:
    """Drop-in for ``get_ag_ui_workflow_router(llm=..., ...)`` that also forwards
    request-time injected frontend tools to the LLM.

    Use this instead of the upstream router for any demo whose page registers
    tools/components via React hooks (``useFrontendTool`` / ``useComponent`` /
    ``useHumanInTheLoop``) that the router does not statically declare. The
    underlying workflow forwards those injected tools to the LLM (the core
    sse-missing fix) and dedups duplicate snapshot tool calls so zero-arg
    frontend tools (``toggleTheme``) don't break, while preserving the bare
    adapter's ``useComponent`` rendering path (``pieChart`` / ``barChart``).
    """

    async def _factory():
        return RequestAwareAGUIChatWorkflow(
            llm=llm,
            frontend_tools=frontend_tools or [],
            backend_tools=backend_tools or [],
            system_prompt=system_prompt,
            initial_state=initial_state or {},
            timeout=timeout,
        )

    return get_ag_ui_workflow_router(workflow_factory=_factory)
