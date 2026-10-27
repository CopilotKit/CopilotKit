"""The research desk agent: Google ADK on Gemini, served over AG-UI.

What reaches the model on each run:
- The system prompt in `prompt.py`.
- The App Context the app sends with the run: CopilotKit's generative UI
  guide (the standard catalog's components, the app's functions, how to
  write ```a2ui fences), the report sheet's description, and the view the
  reader asked for, if any. ag-ui-adk stores AG-UI context in session state;
  `instruction()` appends it.
- Tools: `web_research` and `find_images`, plus any frontend tools the app
  registers, exposed through `AGUIToolset`.

Generative UI uses CopilotKit's markdown transport: the model writes A2UI
operations in ```a2ui fences inside its reply, `FenceRepairer` fixes what it
gets wrong on the way out, and the app renders each component as it arrives.

Per run, the app sends the model the person picked in `forwardedProps.model`.
`ResearchDeskAgent.run` copies it into session state and `use_selected_model`
applies it to every model call. On a thread's first run, a small model picks
an icon for the thread; it goes out as a state delta (`icon`), where the
app's thread list reads it.
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from collections.abc import AsyncGenerator
from contextlib import aclosing

from ag_ui.core import (
    BaseEvent,
    RunAgentInput,
    RunFinishedEvent,
    RunStartedEvent,
    StateDeltaEvent,
    StateSnapshotEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
)
from ag_ui_adk import CONTEXT_STATE_KEY, ADKAgent, AGUIToolset
from google.adk.agents import Agent
from google.adk.agents.callback_context import CallbackContext
from google.adk.agents.run_config import RunConfig, StreamingMode, ToolThreadPoolConfig
from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.models import LlmRequest
from google.adk.planners import BuiltInPlanner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from .actions import ConnectedAppsToolset
from .clock import reader_now
from .fences import FenceRepairer
from .icons import DEFAULT_ICON, THREAD_ICONS
from .identity import user_of
from .images import find_images
from .prompt import SYSTEM_PROMPT
from .research import genai_client, web_research

logger = logging.getLogger(__name__)

# Keep in sync with `src/lib/models.ts` in the app.
MODELS = ("gemini-3.8-flash", "gemini-4-argon", "gemini-3.1-pro-preview")
DEFAULT_MODEL = os.getenv("DEFAULT_MODEL", "gemini-3.8-flash")
HELPER_MODEL = os.getenv("HELPER_MODEL", "gemini-3.5-flash-lite")

MODEL_STATE_KEY = "model"
ICON_STATE_KEY = "icon"
# How long the end of a run waits for an icon pick that is still running.
ICON_WAIT_SECONDS = 5


def instruction(context: ReadonlyContext) -> str:
    entries = context.state.get(CONTEXT_STATE_KEY) or []
    prompt = f"{SYSTEM_PROMPT}\n\n{reader_now(entries)}"
    if not entries:
        return prompt
    app_context = "\n\n".join(f"{e['description']}:\n{e['value']}" for e in entries)
    return f"{prompt}\n\nApp Context:\n{app_context}"


def use_selected_model(
    callback_context: CallbackContext, llm_request: LlmRequest
) -> None:
    model = callback_context.state.get(MODEL_STATE_KEY)
    llm_request.model = model if model in MODELS else DEFAULT_MODEL


async def _pick_icon(question: str) -> str:
    """Asks the helper model for the thread icon that fits a question."""
    options = "\n".join(f"- {name}: {topics}" for name, topics in THREAD_ICONS.items())
    try:
        response = await genai_client().aio.models.generate_content(
            model=HELPER_MODEL,
            contents=(
                "Pick the one icon that best fits a research conversation that "
                f"starts with this question.\n\nQuestion: {question}\n\nIcons:\n{options}\n\n"
                "Reply with the icon name only."
            ),
            config=types.GenerateContentConfig(
                response_mime_type="text/x.enum",
                response_schema={"type": "STRING", "enum": list(THREAD_ICONS)},
            ),
        )
        name = (response.text or "").strip()
    except Exception as exc:  # noqa: BLE001 - an icon is never worth failing a run
        logger.warning("icon pick failed: %s", exc)
        return DEFAULT_ICON
    return name if name in THREAD_ICONS else DEFAULT_ICON


def _icon_delta(icon: str) -> StateDeltaEvent:
    return StateDeltaEvent(
        delta=[{"op": "add", "path": f"/{ICON_STATE_KEY}", "value": icon}]
    )


def _first_question(input: RunAgentInput) -> str:
    for message in input.messages:
        if message.role == "user" and isinstance(message.content, str):
            return message.content[:600]
    return ""


class ResearchDeskAgent(ADKAgent):
    async def run(self, input: RunAgentInput) -> AsyncGenerator[BaseEvent, None]:
        if _is_title_run(input):
            async for event in _title_run(input):
                yield event
            return

        forwarded = (
            input.forwarded_props if isinstance(input.forwarded_props, dict) else {}
        )
        model = forwarded.get("model")
        if model in MODELS:
            state = dict(input.state) if isinstance(input.state, dict) else {}
            state[MODEL_STATE_KEY] = model
            input = input.model_copy(update={"state": state})

        # A thread without an icon gets one, picked alongside the answer: the
        # pick goes out as soon as it is ready, and the run waits for it (at
        # most ICON_WAIT_SECONDS) only at the very end.
        state = input.state if isinstance(input.state, dict) else {}
        question = _first_question(input)
        icon_pick = (
            asyncio.create_task(_pick_icon(question))
            if question and not state.get(ICON_STATE_KEY)
            else None
        )

        fences = FenceRepairer()
        try:
            async with aclosing(super().run(input)) as events:
                async for event in events:
                    if icon_pick and isinstance(event, RunFinishedEvent):
                        try:
                            icon = await asyncio.wait_for(icon_pick, ICON_WAIT_SECONDS)
                        except Exception:  # noqa: BLE001 - includes the timeout
                            icon = DEFAULT_ICON
                        icon_pick = None
                        yield _icon_delta(icon)
                    for out in fences.feed(_without_internal_state(event)):
                        yield out
                    if icon_pick and icon_pick.done():
                        yield _icon_delta(icon_pick.result())
                        icon_pick = None
        finally:
            if icon_pick:
                icon_pick.cancel()


def _op_path(op: object) -> str:
    path = op.get("path") if isinstance(op, dict) else getattr(op, "path", "")
    return str(path or "")


def _without_internal_state(event: BaseEvent) -> BaseEvent:
    """Keep ADK's internal state keys (such as the stored App Context, about
    100 KB) out of the thread state the app and Intelligence keep."""
    if isinstance(event, StateSnapshotEvent) and isinstance(event.snapshot, dict):
        return event.model_copy(
            update={
                "snapshot": {
                    k: v for k, v in event.snapshot.items() if not k.startswith("_")
                }
            }
        )
    if isinstance(event, StateDeltaEvent) and isinstance(event.delta, list):
        return event.model_copy(
            update={
                "delta": [op for op in event.delta if not _op_path(op).startswith("/_")]
            }
        )
    return event


def run_config(input: RunAgentInput) -> RunConfig:
    """ag-ui-adk's run config, plus a thread pool for synchronous tools: the
    connected apps' tools make blocking HTTP calls, and in the pool they no
    longer hold up other readers' runs."""
    config: dict = {
        "streaming_mode": StreamingMode.SSE,
        "save_input_blobs_as_artifacts": False,
        "tool_thread_pool_config": ToolThreadPoolConfig(),
    }
    if input.context:
        config["custom_metadata"] = {
            "ag_ui_context": [
                {"description": c.description, "value": c.value} for c in input.context
            ]
        }
    return RunConfig(**config)


def _is_title_run(input: RunAgentInput) -> bool:
    """Whether this run is CopilotKit Intelligence naming a new thread.

    The runtime names a thread by running this same agent with a system
    prompt of its own and no forwardedProps, and marks the run no other way.
    The app forwards the picked model on every run it starts, so a run that
    opens with a system message and carries no model is the naming run. It is
    answered with the helper model instead of the research agent.
    """
    forwarded = input.forwarded_props if isinstance(input.forwarded_props, dict) else {}
    first = input.messages[0] if input.messages else None
    return "model" not in forwarded and getattr(first, "role", None) == "system"


async def _title_run(input: RunAgentInput) -> AsyncGenerator[BaseEvent, None]:
    system = input.messages[0].content
    transcript = next(
        (
            m.content
            for m in input.messages[1:]
            if m.role == "user" and isinstance(m.content, str)
        ),
        "",
    )
    try:
        response = await genai_client().aio.models.generate_content(
            model=HELPER_MODEL,
            contents=transcript,
            config=types.GenerateContentConfig(
                system_instruction=system,
                response_mime_type="application/json",
            ),
        )
        text = response.text or ""
    except Exception as exc:  # noqa: BLE001 - the runtime falls back to the first words
        logger.warning("title generation failed: %s", exc)
        text = ""

    message_id = str(uuid.uuid4())
    yield RunStartedEvent(thread_id=input.thread_id, run_id=input.run_id)
    yield TextMessageStartEvent(message_id=message_id, role="assistant")
    if text:
        yield TextMessageContentEvent(message_id=message_id, delta=text)
    yield TextMessageEndEvent(message_id=message_id)
    yield RunFinishedEvent(thread_id=input.thread_id, run_id=input.run_id)


def create_agent() -> ResearchDeskAgent:
    return ResearchDeskAgent(
        adk_agent=Agent(
            name="research_desk",
            model=DEFAULT_MODEL,
            instruction=instruction,
            # Low thinking: with the generative UI guide in context, higher
            # levels doubled latency without better views in our runs.
            planner=BuiltInPlanner(
                thinking_config=types.ThinkingConfig(thinking_level="low")
            ),
            tools=[
                web_research,
                find_images,
                ConnectedAppsToolset(),
                AGUIToolset(),
            ],
            before_model_callback=use_selected_model,
        ),
        app_name="research_desk",
        # The signed-in reader, from the runtime's header (see identity.py).
        user_id_extractor=user_of,
        run_config_factory=run_config,
        session_service=InMemorySessionService(),
        use_thread_id_as_session_id=True,
    )
