"""The Express path: one streaming Gemini call per turn, painted as it arrives.

The Antigravity path waits for the whole `render_ui` call before anything
draws. This path asks Gemini for A2UI Express (a compact, line-oriented
notation) and compiles it with Google's A2UI SDK as the text streams in. Each
compiled operation goes out at once as part of a `render_ui` tool call, so
CopilotKit's runtime validates it and the canvas paints it while the model is
still writing.

- The chat sentence before the `<a2ui>` block streams as the chat message.
- A new canvas starts with `createSurface`; every statement after it is an
  `updateComponents` delta.
- An edit seeds the compiler with the canvas so far (rebuilt from this
  thread's earlier `render_ui` calls) and shows it to the model as Express,
  so the model writes only the components that change.
- The surface id is the app's, `canvas-main`, whatever the model declares.

The catalog is `canvas_catalog.json`, written from the page's own generative
UI by `scripts/export-catalog.mjs`, so the compiler and the renderer agree.
"""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from a2ui.core import A2uiError, Catalog
from a2ui.inference_formats.express import ExpressFormatFactory
from a2ui.inference_formats.express.decompiler import ExpressDecompiler
from a2ui.parser import A2uiPart
from a2ui.parser.messages import to_message_dicts, to_message_models
from a2ui.processor import A2uiRequestProcessor
from ag_ui.core import (
    BaseEvent,
    RunAgentInput,
    RunErrorEvent,
    RunFinishedEvent,
    RunStartedEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallStartEvent,
)
from google import genai
from google.genai import types

log = logging.getLogger("canvas.express")

SURFACE_ID = "canvas-main"
TARGET = "canvas"
CATALOG = Catalog.from_json(
    json.loads((Path(__file__).parent / "canvas_catalog.json").read_text())
)


def _processor() -> A2uiRequestProcessor:
    return A2uiRequestProcessor(
        catalogs=[CATALOG],
        format_factory=ExpressFormatFactory(surface_id=SURFACE_ID, version="1.0"),
    )


BRIEF = """You build and edit a live canvas next to the chat: a dashboard, a \
form or a report, drawn with A2UI Express. Then you keep editing that same \
canvas as the user asks for changes.

## Every reply

One short sentence for the chat that says what you are building or what you \
changed, then one <a2ui> block, and nothing after it. Never ask the user a \
question first: if they leave something out, choose realistic sample data.

## A new canvas

Write root = Column([...]) as the first line of the block, then define \
each component right after the parent that lists it, top to bottom. The \
canvas paints line by line as you write, so this order draws it in reading \
order. Keep it tight: a Title (size "2xl") and a one-line Caption, a Row of \
three summary Cards, then the main content, at most about 40 components. \
Every component must be reachable from root: never define one that no \
parent lists.

## An edit

The request shows the canvas as it is now. Begin the block with \
surface("canvas-main", update=true), then write only the components that \
change or are new, keeping their variable names (a name is the component's \
id). To add or remove children, rewrite the parent with its new list.

## Writing Express

Pass a component's first argument by position if you like, and every other \
argument by name (label="Done", size="sm"). Never give one property both \
ways: the compiler rejects it.

## Design

- Summary tiles: Card(variant="outline", size="sm") with a Caption and a \
Title. Badge color shows status: success, warning, danger or info. Put a \
Badge in a Row (next to the text it labels) so it keeps the size of its \
text; directly in a Column or Card it stretches to the full width.
- Use color tokens (success, warning, danger, info, discovery, surface, \
surface-secondary), never raw CSS colors: the user can switch to dark mode.
- Numbers for gap, padding, width and height are 4px steps.
- There is no progress bar component. Draw one with two Boxes: \
Box([fill], height=2, radius="full", background="surface-secondary", \
padding=0), where fill = Box(width="40%", height=2, radius="full", \
background="warning-solid", padding=0), plus a Caption such as "40% complete".
- A progress chart: Chart(chartType="bar", layout="horizontal", \
data=[{goal: "Partner program", progress: 0.4}], xKey="goal", \
series=["progress"], format="percent", yAxis={min: 0, max: 1, width: 150}, \
showLegend=false, height=<44 per bar>). Percent values are fractions; keep \
category labels under 22 characters, and give each bar 44 of height so every \
label shows.
- Each open goal or task gets Button(label="Mark done", size="sm", \
onClick=Event("mark_done", {message: "Mark \\"<its name>\\" as done"})). A \
click reaches you as that message. Then show the item as done: a success \
Badge, a full success-solid bar, and Button(label="Done", size="sm", \
disabled=true).

## Common requests

- "Make it more compact": smaller gaps and padding, size "sm" cards and \
text, shorter wording. Keep every piece of data.
- "Add a chart": a Chart that fits the data already on the canvas.
- "Translate into <language>": rewrite every visible string in that \
language: titles, captions, badges, chart data labels, button labels (as \
actions: "Mark done" becomes "Completar", not "Completado") and each \
event's message. Keep the layout and the data.
"""

INSTRUCTIONS = BRIEF + "\n\n" + _processor().prompt_snippet

_client: genai.Client | None = None


def _gemini() -> genai.Client:
    global _client
    if _client is None:
        base_url = os.environ.get("GOOGLE_GEMINI_BASE_URL", "").rstrip("/")
        _client = genai.Client(
            api_key=os.environ.get("GEMINI_API_KEY"),
            http_options=types.HttpOptions(base_url=base_url) if base_url else None,
        )
    return _client


# ---------------------------------------------------------------- history


def _text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            getattr(part, "text", None)
            or (part.get("text", "") if isinstance(part, dict) else "")
            for part in content
        )
    return ""


def _prior_operations(messages: list) -> list[dict]:
    """Every A2UI operation this thread sent to the canvas, in order."""
    operations: list[dict] = []
    for message in messages:
        if getattr(message, "role", None) != "assistant":
            continue
        for call in getattr(message, "tool_calls", None) or []:
            if call.function.name != "render_ui":
                continue
            try:
                args = json.loads(call.function.arguments or "{}")
            except ValueError:
                continue
            for op in args.get("operations") or []:
                if isinstance(op, dict):
                    operations.append(op)
    return operations


def _conversation(messages: list, canvas: str | None, request: str) -> list:
    """The chat so far as Gemini contents, ending with the request."""
    contents: list[types.Content] = []
    for message in messages[:-1]:
        role = getattr(message, "role", None)
        text = _text(getattr(message, "content", None)).strip()
        if not text or role not in ("user", "assistant"):
            continue
        contents.append(
            types.Content(
                role="user" if role == "user" else "model",
                parts=[types.Part(text=text)],
            )
        )
    last = request
    if canvas:
        last = f"The canvas now:\n{canvas}\n\nRequest: {request}"
    contents.append(types.Content(role="user", parts=[types.Part(text=last)]))
    return contents[-21:]


# ----------------------------------------------------------------- events


class _Turn:
    """Builds the AG-UI events of one reply: chat text, then a render_ui call."""

    def __init__(self, quiet: bool = False) -> None:
        self.message_id = str(uuid.uuid4())
        self.call_id: str | None = None
        self.text_open = False
        self.quiet = quiet  # a repair only fixes the canvas; the chat has its line
        self.sent: list[dict] = []

    @property
    def operations(self) -> int:
        return len(self.sent)

    def text(self, delta: str) -> list[BaseEvent]:
        if not delta or self.quiet:
            return []
        events: list[BaseEvent] = []
        if not self.text_open:
            self.text_open = True
            events.append(
                TextMessageStartEvent(
                    type="TEXT_MESSAGE_START",
                    message_id=self.message_id,
                    role="assistant",
                )
            )
        events.append(
            TextMessageContentEvent(
                type="TEXT_MESSAGE_CONTENT", message_id=self.message_id, delta=delta
            )
        )
        return events

    def operation(self, op: dict) -> list[BaseEvent]:
        # The app owns the surface id, whatever the model declared.
        for key, body in op.items():
            if key != "version" and isinstance(body, dict) and "surfaceId" in body:
                body["surfaceId"] = SURFACE_ID
        events: list[BaseEvent] = []
        if self.call_id is None:
            self.call_id = str(uuid.uuid4())
            events.append(
                ToolCallStartEvent(
                    type="TOOL_CALL_START",
                    tool_call_id=self.call_id,
                    tool_call_name="render_ui",
                    parent_message_id=self.message_id,
                )
            )
            head = json.dumps({"target": TARGET})[:-1] + ', "operations": ['
            delta = head + json.dumps(op)
        else:
            delta = ", " + json.dumps(op)
        self.sent.append(op)
        events.append(
            ToolCallArgsEvent(
                type="TOOL_CALL_ARGS", tool_call_id=self.call_id, delta=delta
            )
        )
        return events

    def close(self) -> list[BaseEvent]:
        events: list[BaseEvent] = []
        if self.text_open:
            events.append(
                TextMessageEndEvent(type="TEXT_MESSAGE_END", message_id=self.message_id)
            )
            self.text_open = False
        if self.call_id is not None:
            events.append(
                ToolCallArgsEvent(
                    type="TOOL_CALL_ARGS", tool_call_id=self.call_id, delta="]}"
                )
            )
            events.append(
                ToolCallEndEvent(type="TOOL_CALL_END", tool_call_id=self.call_id)
            )
            self.call_id = None
        return events


def _parts(parts: list, turn: _Turn) -> list[BaseEvent]:
    events: list[BaseEvent] = []
    for part in parts:
        if isinstance(part, A2uiPart):
            for op in to_message_dicts(part.a2ui):
                events += turn.operation(op)
        else:
            events += turn.text(getattr(part, "text", "") or "")
    return events


# -------------------------------------------------------------------- run


def _seed(processor: A2uiRequestProcessor, operations: list[dict]):
    """A compiler state holding the canvas so far, and the operations kept.

    An operation the compiler refuses was refused by the runtime too, so it
    is not on the canvas and is dropped.
    """
    state = processor.create_state()
    kept: list[dict] = []
    for op in operations:
        try:
            state.apply([op])
            kept.append(op)
        except A2uiError:
            continue
    return state, kept


def _request(messages: list) -> str | None:
    """What this run should do: the user's message, or a fix for rejections.

    A run that ends on a tool result is the page handing back what the
    runtime drew. With nothing rejected there is nothing to do; with
    rejections, the model is asked to fix exactly those.
    """
    if not messages:
        return None
    last = messages[-1]
    role = getattr(last, "role", None)
    if role == "user":
        return _text(getattr(last, "content", None)).strip() or None
    if role == "tool":
        try:
            result = json.loads(_text(getattr(last, "content", None)) or "{}")
        except ValueError:
            return None
        rejected = result.get("rejected") or []
        if rejected:
            reasons = "; ".join(str(r.get("reason", r)) for r in rejected[:8])
            return (
                "The canvas rejected part of your last block: "
                f"{reasons}. Fix only those components."
            )
    return None


class ExpressCompileError(Exception):
    """The reply's A2UI Express block failed to compile on both attempts."""


async def express_events(
    input_data: RunAgentInput, model: str, thinking_level: str | None
) -> AsyncIterator[BaseEvent]:
    """One AG-UI run on the Express path.

    It ends in RUN_FINISHED when the reply compiles, and in RUN_ERROR when it
    still does not after the retry. Either way, whatever already reached the
    canvas stays: those operations went out, and were closed, as they arrived.
    """
    yield RunStartedEvent(
        type="RUN_STARTED", thread_id=input_data.thread_id, run_id=input_data.run_id
    )
    messages = list(input_data.messages or [])
    request = _request(messages)
    if request is not None:
        try:
            async for event in _reply(messages, request, model, thinking_level):
                yield event
        except ExpressCompileError as failure:
            yield RunErrorEvent(
                type="RUN_ERROR",
                message=f"The canvas reply did not compile, even after a retry: {failure}",
                code="EXPRESS_COMPILE_ERROR",
            )
            return
    yield RunFinishedEvent(
        type="RUN_FINISHED", thread_id=input_data.thread_id, run_id=input_data.run_id
    )


async def _reply(
    messages: list, request: str, model: str, thinking_level: str | None
) -> AsyncIterator[BaseEvent]:
    processor = _processor()
    applied = _prior_operations(messages)

    config = types.GenerateContentConfig(
        system_instruction=INSTRUCTIONS,
        thinking_config=types.ThinkingConfig(
            thinking_level=(thinking_level or "low").upper()
        ),
    )
    error: str | None = None
    for attempt in (1, 2):
        state, applied = _seed(processor, applied)
        canvas = (
            ExpressDecompiler([CATALOG]).decompile(
                to_message_models(applied), use_keyword_args=True
            )
            if applied
            else None
        )
        contents = _conversation(messages, canvas, request)
        if error:
            contents.append(
                types.Content(
                    role="user",
                    parts=[
                        types.Part(
                            text=f"Your last block did not compile: {error} "
                            "Write the reply again with that fixed."
                        )
                    ],
                )
            )
        turn = _Turn(quiet=attempt > 1)
        stream = processor.open_stream(state=state)
        started = time.monotonic()
        first_paint: float | None = None
        usage = None
        error = None
        try:
            response = await _gemini().aio.models.generate_content_stream(
                model=model, contents=contents, config=config
            )
            async for chunk in response:
                usage = chunk.usage_metadata or usage
                text = "".join(
                    part.text
                    for candidate in (chunk.candidates or [])[:1]
                    for part in ((candidate.content and candidate.content.parts) or [])
                    if part.text and not part.thought
                )
                if not text:
                    continue
                for event in _parts(stream.feed(text), turn):
                    if first_paint is None and isinstance(event, ToolCallArgsEvent):
                        first_paint = time.monotonic() - started
                    yield event
            for event in _parts(stream.close(), turn):
                yield event
        except A2uiError as failure:
            error = str(failure).splitlines()[0][:400]
            for event in _parts(getattr(failure, "partial_results", None) or [], turn):
                yield event
        for event in turn.close():
            yield event
        log.info(
            "express %s attempt=%d first_paint=%s total=%.1fs ops=%d in=%s out=%s error=%s",
            model,
            attempt,
            f"{first_paint:.1f}s" if first_paint is not None else "-",
            time.monotonic() - started,
            turn.operations,
            getattr(usage, "prompt_token_count", None),
            getattr(usage, "candidates_token_count", None),
            error,
        )
        if error is None:
            return
        # Retry once. What already reached the canvas stays, and the retry
        # starts from it, so a reply that broke halfway is finished, not redrawn.
        applied = applied + turn.sent
    raise ExpressCompileError(error)
