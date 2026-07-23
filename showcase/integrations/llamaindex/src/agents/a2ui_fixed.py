"""
LlamaIndex agent for the A2UI Fixed Schema demo.

Mirrors `langgraph-python/src/agents/a2ui_fixed.py`: the component tree (the
flight card schema) is authored ahead of time as JSON; the agent only streams
*data* into the data model at runtime via a `display_flight` tool. The frontend
registers a matching catalog (see
`src/app/demos/a2ui-fixed-schema/a2ui/catalog.ts`) that pins the schema's
component names (Card / Title / Airport / …) to real React components.

INTEGRATION-LEVEL STREAMED render_a2ui FIX
------------------------------------------
The A2UI middleware (`@ag-ui/a2ui-middleware`) mounts the surface from a
STREAMED render-tool CALL, NOT from a tool result:

  - On `TOOL_CALL_START`: it tracks the call ONLY when `toolCallName` is in its
    watched set (populated when `injectA2UITool: true`, watching `render_a2ui`).
  - On `TOOL_CALL_ARGS` deltas: it accumulates the args, parses `components` out
    of the streamed args, and emits the `a2ui-surface` activity
    (`createSurface` / `updateComponents` / `updateDataModel`) once `components`
    (and then `data`) are present.

A `TOOL_CALL_RESULT` does NOT mount the surface. The upstream llama-index AG-UI
adapter only appends backend tool results to chat history and re-emits via
`MESSAGES_SNAPSHOT`, which the middleware ignores — so the surface was never
mounted (`reason=surface-missing`). This is the same root cause fixed for the
sibling `declarative-gen-ui` (A2UI — Dynamic Schema) demo.

We close the gap at the integration level by mirroring how google-adk drives
the middleware — emitting a streamed `render_a2ui` tool-CALL:

  1. `display_flight` (the backend tool) returns the fixed-schema `render_a2ui`
     args (`surfaceId` / `catalogId` / `components` / `data`) as JSON. The
     `components` array is the pre-authored flight schema; `data` is the runtime
     trip the LLM supplied. Nothing is stubbed.
  2. The workflow override (`_A2UIRenderToolCallWorkflow`) parses that backend
     tool result and writes a discrete streamed `render_a2ui` tool-CALL to the
     AG-UI stream: `TOOL_CALL_START` (toolCallName=`render_a2ui`), one or more
     `TOOL_CALL_ARGS` deltas carrying the args JSON (whose `components` array and
     `data` object the middleware parses), and `TOOL_CALL_END`. The upstream
     `MESSAGES_SNAPSHOT` behaviour is preserved (super() body still runs).

The streamed `TOOL_CALL_START` / `TOOL_CALL_ARGS` / `TOOL_CALL_END` events are
already in the upstream `AG_UI_EVENTS` allow-list the router streams against, so
they pass through the SSE shim unmodified.

Pairs with the dedicated runtime route
`src/app/api/copilotkit-a2ui-fixed-schema/route.ts` which sets
`a2ui.injectA2UITool: true` so the middleware WATCHES the `render_a2ui`
tool-call name (the watched-names set is only populated when the tool is
injected).

Both changes live entirely in this integration; no shared/`@ag-ui` package is
touched.
"""

# @region[backend-render-operations]
# @region[backend-schema-json-load]
import json
import os
import uuid
from pathlib import Path
from typing import Annotated, Awaitable, Callable, List, Optional, Union

from ag_ui.core import RunAgentInput
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from llama_index.core.llms import ChatMessage
from llama_index.core.workflow import Context, Workflow, step
from llama_index.core.workflow.events import StopEvent
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


CATALOG_ID = "copilotkit://flight-fixed-catalog"
SURFACE_ID = "flight-fixed-schema"

# The render-tool name `@ag-ui/a2ui-middleware` watches (when
# `injectA2UITool: true`) and mounts the surface from. We synthesise a STREAMED
# tool-CALL by this name on the outbound stream.
RENDER_A2UI_TOOL_NAME = "render_a2ui"

# Allow-list the router streams against. The streamed `render_a2ui` tool-CALL
# events (TOOL_CALL_START / TOOL_CALL_ARGS / TOOL_CALL_END) are already part of
# the upstream `AG_UI_EVENTS` tuple, so no extension is required.
_A2UI_AG_UI_EVENTS = AG_UI_EVENTS

_SCHEMAS_DIR = Path(__file__).parent / "a2ui_schemas"


# Schemas are JSON so they can be authored and reviewed independently of the
# Python code. `_load_schema` is just a thin `json.load` wrapper.
def _load_schema(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


FLIGHT_SCHEMA = _load_schema(_SCHEMAS_DIR / "flight_schema.json")
# @endregion[backend-schema-json-load]


def _emit_render_a2ui_tool_call(ctx: Context, args: dict) -> None:
    """Write a STREAMED ``render_a2ui`` tool-CALL to the AG-UI stream.

    Emits ``TOOL_CALL_START`` (toolCallName=``render_a2ui``), the args JSON as
    one or more ``TOOL_CALL_ARGS`` deltas (the middleware parses ``components``
    and ``data`` out of the accumulated args), then ``TOOL_CALL_END``. This is
    the exact event sequence ``@ag-ui/a2ui-middleware`` watches to mount the
    surface.
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
    # (it parses `components` / `data` from the concatenated deltas).
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
    """Upstream workflow that RE-EMITS each backend `display_flight` result as a
    STREAMED ``render_a2ui`` tool-CALL so ``@ag-ui/a2ui-middleware`` mounts the
    surface.

    Only ``aggregate_tool_calls`` is overridden. The override re-applies
    ``@step`` (a plain override drops the method from llama-index's step
    registry) and reproduces the upstream body byte-for-byte — preserving the
    ``MESSAGES_SNAPSHOT`` history update and the loop/stop control flow — with a
    single addition: it parses each backend tool result (the fixed-schema
    ``render_a2ui`` args carrying ``components``) and streams a discrete
    ``render_a2ui`` tool-CALL. This mirrors how google-adk drives the middleware
    without altering any other adapter behaviour.
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

        # ADDITION: for every backend `display_flight` result, RE-EMIT the
        # fixed-schema component args as a STREAMED `render_a2ui` tool-CALL. The
        # middleware mounts the surface from this streamed call (it does NOT
        # inspect tool results or MESSAGES_SNAPSHOT). Frontend-tool results are
        # resolved on the client and must NOT be re-emitted here.
        for result in backend_tool_calls:
            try:
                render_args = json.loads(result.tool_output.content)
            except (TypeError, ValueError):
                render_args = None
            if isinstance(render_args, dict) and render_args.get("components"):
                _emit_render_a2ui_tool_call(ctx, render_args)

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


async def display_flight(
    origin: Annotated[str, "Origin airport code (e.g. 'SFO')."],
    destination: Annotated[str, "Destination airport code (e.g. 'JFK')."],
    airline: Annotated[str, "Airline name."],
    price: Annotated[str, "Price string (e.g. '$289')."],
) -> str:
    """Show a flight card for the given trip.

    Returns the fixed-schema ``render_a2ui`` args (surfaceId, catalogId, the
    pre-authored flight ``components``, and the runtime trip ``data``) as JSON.
    The workflow override (`_A2UIRenderToolCallWorkflow.aggregate_tool_calls`)
    parses this result and RE-EMITS it as a streamed ``render_a2ui`` tool-CALL
    that the A2UI middleware watches and mounts the surface from. The frontend
    catalog resolves the component names to the local React components.
    """
    args = {
        "surfaceId": SURFACE_ID,
        "catalogId": CATALOG_ID,
        "components": FLIGHT_SCHEMA,
        "data": {
            "origin": origin,
            "destination": destination,
            "airline": airline,
            "price": price,
        },
    }
    return json.dumps(args)
    # @endregion[backend-render-operations]


SYSTEM_PROMPT = (
    "You help users find flights. When asked about a flight, call "
    "display_flight with origin, destination, airline, and price. "
    "Use short airport codes (e.g. 'SFO', 'JFK') and a price string like "
    "'$289'. Keep any chat reply to one short sentence."
)


_openai_kwargs = {}
if os.environ.get("OPENAI_BASE_URL"):
    _openai_kwargs["api_base"] = os.environ["OPENAI_BASE_URL"]


def _a2ui_fixed_workflow_factory() -> Callable[[], Awaitable[Workflow]]:
    async def factory() -> Workflow:
        return _A2UIRenderToolCallWorkflow(
            llm=OpenAI(model="gpt-4o-mini", **_openai_kwargs),
            frontend_tools=[],
            backend_tools=[display_flight],
            system_prompt=SYSTEM_PROMPT,
            initial_state={},
            timeout=120,
        )

    return factory


a2ui_fixed_router = _make_a2ui_router(_a2ui_fixed_workflow_factory())
