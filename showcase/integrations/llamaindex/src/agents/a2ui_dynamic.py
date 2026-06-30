"""
LlamaIndex agent for the Declarative Generative UI (A2UI — Dynamic Schema) demo.

Mirrors `langgraph-python/src/agents/a2ui_dynamic.py`:

- The agent binds a single `generate_a2ui` backend tool.
- When called, `generate_a2ui` kicks off a secondary OpenAI chat completion with
  a forced `_design_a2ui_surface` tool call. The registered client catalog is
  expected to surface through the system prompt (the LlamaIndex router does not
  yet auto-inject `copilotkit.context`, so the catalog description is inlined
  into the system prompt for parity).
- The tool result carries the planner's A2UI component payload, which the
  workflow then RE-EMITS as a streamed ``render_a2ui`` tool-CALL on the outbound
  AG-UI stream so ``@ag-ui/a2ui-middleware`` mounts the surface.

Pairs with the dedicated runtime route
`src/app/api/copilotkit-declarative-gen-ui/route.ts` which sets
`a2ui.injectA2UITool: true` so the middleware WATCHES the ``render_a2ui``
tool-call name (the watched-names set is only populated when the tool is
injected).

INTEGRATION-LEVEL STREAMED render_a2ui FIX
------------------------------------------
The A2UI middleware (``@ag-ui/a2ui-middleware``) mounts the surface from a
STREAMED render-tool CALL, NOT from a tool result:

  - On ``TOOL_CALL_START``: it tracks the call ONLY when ``toolCallName`` is in
    its watched set (populated when ``injectA2UITool: true``, watching
    ``render_a2ui``).
  - On ``TOOL_CALL_ARGS`` deltas: it accumulates the args, parses ``components``
    out of the streamed args, and emits the ``a2ui-surface`` activity
    (``createSurface`` / ``updateComponents``) when ``components`` is present.

A ``TOOL_CALL_RESULT`` does NOT mount the surface. The upstream llama-index
AG-UI adapter only appends backend tool results to chat history and re-emits via
``MESSAGES_SNAPSHOT``, which the middleware ignores — so the surface was never
mounted (``reason=surface-missing``).

We close the gap at the integration level by mirroring how google-adk drives
the middleware — emitting a streamed ``render_a2ui`` tool-CALL:

  1. ``generate_a2ui`` (the backend tool) runs the secondary forced planner call
     and returns the planner's ``render_a2ui`` args (``surfaceId`` / ``catalogId``
     / ``components`` / ``data``) as JSON. The backend still PRODUCES the
     components — nothing is stubbed.
  2. The workflow override (``_A2UIRenderToolCallWorkflow``) parses that backend
     tool result and writes a discrete streamed ``render_a2ui`` tool-CALL to the
     AG-UI stream: ``TOOL_CALL_START`` (toolCallName=``render_a2ui``), one or
     more ``TOOL_CALL_ARGS`` deltas carrying the args JSON (whose ``components``
     array the middleware parses), and ``TOOL_CALL_END``. The upstream
     ``MESSAGES_SNAPSHOT`` behaviour is preserved (super() body still runs).

The streamed ``TOOL_CALL_START`` / ``TOOL_CALL_ARGS`` / ``TOOL_CALL_END`` events
are already in the upstream ``AG_UI_EVENTS`` allow-list the router streams
against, so they pass through the SSE shim unmodified.

Both changes live entirely in this integration; no shared/`@ag-ui` package is
touched.
"""

import json
import logging
import os
import uuid
from typing import Annotated, Awaitable, Callable, List, Optional, Union

from ag_ui.core import RunAgentInput
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from llama_index.core.llms import ChatMessage
from llama_index.core.workflow import Context, Workflow, step
from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.agent import (
    AGUIChatWorkflow,
    LoopEvent,
    ToolCallResultEvent,
)
from llama_index.protocols.ag_ui.events import (
    RunErrorWorkflowEvent,
    RunFinishedWorkflowEvent,
    RunStartedWorkflowEvent,
    ToolCallArgsWorkflowEvent,
    ToolCallEndWorkflowEvent,
    ToolCallStartWorkflowEvent,
)
from llama_index.protocols.ag_ui.router import AG_UI_EVENTS
from llama_index.protocols.ag_ui.utils import timestamp, workflow_event_to_sse
from llama_index.core.workflow.events import StopEvent


logger = logging.getLogger(__name__)


CUSTOM_CATALOG_ID = "declarative-gen-ui-catalog"

# The render-tool name `@ag-ui/a2ui-middleware` watches (when
# `injectA2UITool: true`) and mounts the surface from. We synthesise a STREAMED
# tool-CALL by this name on the outbound stream.
RENDER_A2UI_TOOL_NAME = "render_a2ui"

# Inner planner tool name. Deliberately NOT `render_a2ui`: the secondary forced
# planner call is an internal OpenAI tool-call, and naming it `render_a2ui`
# would risk the middleware/frontend intercepting that internal call. The
# planner emits `_design_a2ui_surface`; the OUTER workflow then RE-EMITS its
# component args as a STREAMED `render_a2ui` tool-CALL (see
# `_A2UIRenderToolCallWorkflow`) that the middleware actually watches.
DESIGN_TOOL_NAME = "_design_a2ui_surface"


# Allow-list the router streams against. The streamed `render_a2ui` tool-CALL
# events (TOOL_CALL_START / TOOL_CALL_ARGS / TOOL_CALL_END) are already part of
# the upstream `AG_UI_EVENTS` tuple, so no extension is required.
_A2UI_AG_UI_EVENTS = AG_UI_EVENTS


def _emit_render_a2ui_tool_call(ctx: Context, args: dict) -> None:
    """Write a STREAMED ``render_a2ui`` tool-CALL to the AG-UI stream.

    Emits ``TOOL_CALL_START`` (toolCallName=``render_a2ui``), the args JSON as
    one or more ``TOOL_CALL_ARGS`` deltas (the middleware parses ``components``
    out of the accumulated args), then ``TOOL_CALL_END``. This is the exact
    event sequence ``@ag-ui/a2ui-middleware`` watches to mount the surface.
    """
    tool_call_id = f"render_a2ui-{uuid.uuid4().hex}"
    payload = json.dumps(args)

    ctx.write_event_to_stream(
        ToolCallStartWorkflowEvent(
            tool_call_id=tool_call_id,
            tool_call_name=RENDER_A2UI_TOOL_NAME,
        )
    )
    # Chunk the args so the middleware exercises its streaming-args accumulator
    # (it parses `components` from the concatenated deltas).
    chunk_size = 256
    for start in range(0, len(payload), chunk_size):
        ctx.write_event_to_stream(
            ToolCallArgsWorkflowEvent(
                tool_call_id=tool_call_id,
                delta=payload[start : start + chunk_size],
            )
        )
    ctx.write_event_to_stream(ToolCallEndWorkflowEvent(tool_call_id=tool_call_id))


class _A2UIRenderToolCallWorkflow(AGUIChatWorkflow):
    """Upstream workflow that RE-EMITS each backend `generate_a2ui` result as a
    STREAMED ``render_a2ui`` tool-CALL so ``@ag-ui/a2ui-middleware`` mounts the
    surface.

    Only ``aggregate_tool_calls`` is overridden. The override re-applies
    ``@step`` (a plain override drops the method from llama-index's step
    registry) and is functionally equivalent to upstream
    llama-index-protocols-ag-ui 0.2.2 ``aggregate_tool_calls`` (verified; two
    cosmetic differences — an ``Optional`` type hint and a list comprehension —
    both behaviorally identical), with one additive step that re-emits backend
    results as a streamed ``render_a2ui`` tool-CALL — preserving the
    ``MESSAGES_SNAPSHOT`` history update and the loop/stop control flow. It
    parses each backend tool result (the planner's ``render_a2ui`` args carrying
    ``components``) and streams a discrete ``render_a2ui`` tool-CALL. This
    mirrors how google-adk drives the middleware without altering any other
    adapter behaviour.
    """

    @step
    async def aggregate_tool_calls(
        self, ctx: Context, ev: ToolCallResultEvent
    ) -> Optional[Union[StopEvent, LoopEvent]]:
        num_tool_calls = await ctx.store.get("num_tool_calls")
        tool_call_results: Optional[List[ToolCallResultEvent]] = ctx.collect_events(
            ev, [ToolCallResultEvent] * num_tool_calls
        )
        if tool_call_results is None:
            # Not all sibling tool results have arrived yet.
            return None

        frontend_tool_calls = [
            r for r in tool_call_results if r.tool_name in self.frontend_tools
        ]
        backend_tool_calls = [
            r for r in tool_call_results if r.tool_name in self.backend_tools
        ]

        # ADDITION: for every backend `generate_a2ui` result, RE-EMIT the
        # planner's component args as a STREAMED `render_a2ui` tool-CALL. The
        # middleware mounts the surface from this streamed call (it does NOT
        # inspect tool results or MESSAGES_SNAPSHOT). Frontend-tool results are
        # resolved on the client and must NOT be re-emitted here.
        for result in backend_tool_calls:
            content = result.tool_output.content
            render_args = None
            if isinstance(content, str):
                try:
                    render_args = json.loads(content)
                except json.JSONDecodeError as exc:
                    # A non-JSON backend result means the planner produced no
                    # parseable surface; without this log a planner regression
                    # presents as a blank UI with zero diagnostic trail.
                    logger.warning(
                        "a2ui_dynamic: backend tool %r returned non-JSON content "
                        "(%s); no render_a2ui surface emitted. raw=%r",
                        result.tool_name,
                        exc,
                        content,
                    )
            else:
                logger.warning(
                    "a2ui_dynamic: backend tool %r returned non-str content "
                    "(type=%s); no render_a2ui surface emitted.",
                    result.tool_name,
                    type(content).__name__,
                )

            if isinstance(render_args, dict) and render_args.get("error"):
                # `generate_a2ui` returns `{"error": ...}` when the planner LLM
                # did not call the design tool. It parses as valid JSON but has
                # no components, so it would otherwise be skipped silently.
                logger.warning(
                    "a2ui_dynamic: backend tool %r reported an error (%s); "
                    "no render_a2ui surface emitted.",
                    result.tool_name,
                    render_args.get("error"),
                )
                continue

            if isinstance(render_args, dict) and render_args.get("components"):
                _emit_render_a2ui_tool_call(ctx, render_args)
            elif isinstance(render_args, dict):
                # Valid JSON but no `components` — the middleware mounts nothing,
                # so surface the empty/missing-components case for debugging.
                logger.warning(
                    "a2ui_dynamic: backend tool %r returned no components "
                    "(keys=%s); no render_a2ui surface emitted.",
                    result.tool_name,
                    sorted(render_args.keys()),
                )

        # --- upstream aggregate_tool_calls body (unchanged) ---
        new_tool_messages = [
            ChatMessage(
                role="tool",
                content=r.tool_output.content,
                additional_kwargs={"tool_call_id": r.tool_call_id},
            )
            for r in backend_tool_calls
        ]

        chat_history = await ctx.store.get("chat_history")
        if new_tool_messages:
            chat_history.extend(new_tool_messages)
            self._snapshot_messages(ctx, [*chat_history])
            await ctx.store.set("chat_history", chat_history)

        if len(frontend_tool_calls) > 0:
            return StopEvent()

        return LoopEvent(messages=chat_history)


def _make_a2ui_router(
    workflow_factory: Callable[[], Awaitable[Workflow]],
) -> APIRouter:
    """SSE router mirroring upstream ``AGUIWorkflowRouter``.

    Upstream ``AGUIWorkflowRouter.run`` filters ``handler.stream_events()``
    against a fixed ``AG_UI_EVENTS`` tuple; this shim is functionally identical
    (it filters against ``_A2UI_AG_UI_EVENTS``, which equals ``AG_UI_EVENTS``).
    The streamed ``render_a2ui`` tool-CALL events the workflow emits
    (TOOL_CALL_START / TOOL_CALL_ARGS / TOOL_CALL_END) are already in that
    allow-list, so they pass through unmodified.
    """
    router = APIRouter()

    async def run(input: RunAgentInput):
        workflow = await workflow_factory()
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
                async for stream_ev in handler.stream_events():
                    if isinstance(stream_ev, _A2UI_AG_UI_EVENTS):
                        yield workflow_event_to_sse(stream_ev)
                _ = await handler
                yield workflow_event_to_sse(
                    RunFinishedWorkflowEvent(
                        timestamp=timestamp(),
                        thread_id=input.thread_id,
                        run_id=input.run_id,
                    )
                )
            except Exception as exc:  # noqa: BLE001 — mirror upstream error path
                yield workflow_event_to_sse(
                    RunErrorWorkflowEvent(
                        timestamp=timestamp(),
                        message=str(exc),
                        code=str(type(exc)),
                    )
                )
                await handler.cancel_run()
                raise

        return StreamingResponse(stream_response(), media_type="text/event-stream")

    router.add_api_route("/run", run, methods=["POST"])
    return router


async def generate_a2ui(
    context: Annotated[
        str,
        "Short description of what the UI should show; mirrors the last user "
        "message so the secondary LLM has full context.",
    ],
) -> str:
    """Generate dynamic A2UI components based on the conversation.

    Invokes a secondary LLM bound to `_design_a2ui_surface` (tool_choice
    forced) and returns the planner's `render_a2ui` args (surfaceId, catalogId,
    components, data) as JSON. The workflow override
    (`_A2UIRenderToolCallWorkflow.aggregate_tool_calls`) parses this result and
    RE-EMITS it as a streamed `render_a2ui` tool-CALL that the A2UI middleware
    watches and mounts the surface from.
    """
    from openai import OpenAI as OpenAIClient

    client = OpenAIClient()
    tool_schema = {
        "type": "function",
        "function": {
            "name": DESIGN_TOOL_NAME,
            "description": "Render a dynamic A2UI v0.9 surface.",
            "parameters": {
                "type": "object",
                "properties": {
                    "surfaceId": {"type": "string"},
                    "catalogId": {"type": "string"},
                    "components": {"type": "array", "items": {"type": "object"}},
                    "data": {"type": "object"},
                },
                "required": ["surfaceId", "catalogId", "components"],
            },
        },
    }

    response = client.chat.completions.create(
        model="gpt-4.1",
        messages=[
            {
                "role": "system",
                "content": (
                    "You design dynamic A2UI v0.9 surfaces for the "
                    "declarative-gen-ui demo. Use catalogId "
                    f"'{CUSTOM_CATALOG_ID}'. Components: Card (title, "
                    "subtitle?, child?), StatusBadge (text, variant: "
                    "success|warning|error|info), Metric (label, value, "
                    "trend: up|down|neutral), InfoRow (label, value), "
                    "PrimaryButton (label, action?), PieChart (title, "
                    "description, data: [{label, value}]), BarChart (title, "
                    "description, data: [{label, value}]), DataTable (columns: "
                    "[{key, label}], rows: [{<key>: string|number}]; row keys "
                    "must match columns[].key — ideal for rankings and "
                    "per-person/per-item breakdowns like rep performance vs "
                    "quota). Basic primitives "
                    "(Column, Row, Text, Image, Card, Button) are also "
                    "available. The root component id must be 'root'."
                ),
            },
            {"role": "user", "content": context or "Generate a useful dashboard UI."},
        ],
        tools=[tool_schema],
        tool_choice={"type": "function", "function": {"name": DESIGN_TOOL_NAME}},
    )

    if not response.choices[0].message.tool_calls:
        return json.dumps({"error": f"LLM did not call {DESIGN_TOOL_NAME}"})

    tool_call = response.choices[0].message.tool_calls[0]
    args = json.loads(tool_call.function.arguments)
    if not args.get("catalogId"):
        args["catalogId"] = CUSTOM_CATALOG_ID
    if not args.get("surfaceId"):
        args["surfaceId"] = "dynamic-surface"
    # Return the planner's render_a2ui args verbatim. The workflow re-emits these
    # as a streamed `render_a2ui` tool-CALL (the middleware parses `components`
    # from the streamed args to mount the surface).
    return json.dumps(args)


SYSTEM_PROMPT = (
    "You are a demo assistant for Declarative Generative UI (A2UI — Dynamic "
    "Schema). Whenever a response would benefit from a rich visual — a "
    "dashboard, status report, KPI summary, card layout, info grid, a "
    "pie/donut chart of part-of-whole breakdowns, a bar chart comparing "
    "values across categories, or anything more structured than plain text — "
    "call `generate_a2ui` with a short `context` describing what to render. "
    "Keep chat replies to one short sentence; let the UI do the talking."
)


_openai_kwargs = {}
if os.environ.get("OPENAI_BASE_URL"):
    _openai_kwargs["api_base"] = os.environ["OPENAI_BASE_URL"]


def _a2ui_dynamic_workflow_factory() -> Callable[[], Awaitable[Workflow]]:
    async def factory() -> Workflow:
        return _A2UIRenderToolCallWorkflow(
            llm=OpenAI(model="gpt-4.1", **_openai_kwargs),
            frontend_tools=[],
            backend_tools=[generate_a2ui],
            system_prompt=SYSTEM_PROMPT,
            initial_state={},
            timeout=120,
        )

    return factory


a2ui_dynamic_router = _make_a2ui_router(_a2ui_dynamic_workflow_factory())
