"""A generic ADK chat agent using frontend-provided context and tools.

The frontend describes its component catalog and rendering contract through
AG-UI context and tools. Express configurations compile at the transport
boundary; the agent itself has no hardcoded component schema or UI examples.
"""

import logging
from collections.abc import AsyncGenerator
from contextlib import aclosing

from ag_ui.core import BaseEvent, RunAgentInput, RunErrorEvent, RunStartedEvent
from ag_ui_adk import CONTEXT_STATE_KEY, ADKAgent, AGUIToolset
from google.adk.agents import Agent
from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.sessions import InMemorySessionService

from .timing import TimedGemini, trace_run

MODELS = ("gemini-3.6-flash", "gemini-3.8-flash")
FORMATS = ("express", "json")
TRANSPORTS = ("tool", "markdown")

SYSTEM_PROMPT = (
    "You are a helpful assistant. When a visual, interactive answer helps, "
    "render it with generative UI as described in your App Context."
)

logger = logging.getLogger(__name__)


def instruction(context: ReadonlyContext) -> str:
    """Read the current run's frontend context, including catalog and guidelines."""
    entries = context.state.get(CONTEXT_STATE_KEY) or []
    if not entries:
        return SYSTEM_PROMPT
    app_context = "\n\n".join(
        f"{entry['description']}:\n{entry['value']}" for entry in entries
    )
    return f"{SYSTEM_PROMPT}\n\nApp Context:\n{app_context}"


class DemoAgent(ADKAgent):
    """Apply Express conversion only to configurations that request it."""

    def __init__(self, *, format: str, transport: str, **kwargs):
        super().__init__(**kwargs)
        self.format = format
        self.transport = transport

    async def run(self, input: RunAgentInput) -> AsyncGenerator[BaseEvent, None]:
        async with aclosing(
            trace_run(
                self._run(input),
                input,
                self._adk_agent.model.model,
                self.format,
                self.transport,
            )
        ) as events:
            async for event in events:
                yield event

    async def _run(self, input: RunAgentInput) -> AsyncGenerator[BaseEvent, None]:
        if self.format == "json":
            async with aclosing(super().run(input)) as events:
                async for event in events:
                    yield event
            return

        # JSON runs never import the Express compiler or initialize its catalog.
        try:
            from .transport import prepare_express_input, transform_express_events

            prepared, compiler = prepare_express_input(input, self.transport)
        except Exception as exc:
            logger.exception("Unable to prepare Express input")
            yield RunStartedEvent(thread_id=input.thread_id, run_id=input.run_id)
            yield RunErrorEvent(message=str(exc), code="EXPRESS_PREPARATION_ERROR")
            return

        async with (
            aclosing(super().run(prepared)) as events,
            aclosing(
                transform_express_events(events, compiler, self.transport)
            ) as transformed,
        ):
            async for event in transformed:
                yield event


def create_agent(model: str, format: str, transport: str) -> DemoAgent:
    """Create an independently namespaced configuration without requiring a key yet."""
    for name, value, supported in (
        ("model", model, MODELS),
        ("format", format, FORMATS),
        ("transport", transport, TRANSPORTS),
    ):
        if value not in supported:
            raise ValueError(
                f"Unsupported {name}: {value!r}; expected one of {supported}"
            )

    namespace = f"generative_ui_{model}_{format}_{transport}".replace("-", "_").replace(
        ".", "_"
    )
    return DemoAgent(
        format=format,
        transport=transport,
        adk_agent=Agent(
            name=namespace,
            model=TimedGemini(model=model, client_kwargs={"vertexai": False}),
            instruction=instruction,
            tools=[AGUIToolset()],
        ),
        app_name=namespace,
        user_id="demo-user",
        session_service=InMemorySessionService(),
        streaming_function_call_arguments=False,
    )
