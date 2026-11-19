"""The canvas agent: Google Antigravity on Gemini, served over AG-UI.

The agent has no tools of its own. CopilotKit's runtime gives every run a
`render_ui` tool and a generative UI guide (the components it may use, the
"canvas" target, and the surfaces that already exist). The agent calls
`render_ui` to create and edit one A2UI 1.0 surface, which the page draws in
the canvas next to the chat.

Two adapter settings make that work on Antigravity:

- `experimental_app_context=True`. Antigravity fixes the instructions when the
  session starts, so the per-run guide in `RunAgentInput.context` would never
  reach the model. This gives the model a `get_app_context` tool that returns
  it, and the instructions below tell it to call that first.
- `deduplicate_tool_calls=False`. With de-duplication on, a second
  `render_ui` with different operations in the same turn is answered with
  "already ran" instead of reaching the canvas.

A frontend tool like `render_ui` ends the AG-UI run. Its result comes back
with the next message, so the instructions ask for the chat reply first and
`render_ui` last.

The page lets the user pick the Gemini model. Antigravity fixes a
conversation's model when it starts, so there is one agent per model, made on
first use, and each run goes to the agent named by `forwardedProps.model`.
"""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
from contextlib import asynccontextmanager

from dotenv import load_dotenv

# Load .env before anything below reads os.environ.
load_dotenv()

# LOG_LEVEL=DEBUG shows the adapter's view of each run: tool calls parking,
# resuming, and runs ending.
logging.basicConfig(level=os.environ.get("LOG_LEVEL", "WARNING").upper())

from ag_ui.core import RunAgentInput, RunErrorEvent
from ag_ui_antigravity import AntigravityAgent
from ag_ui_antigravity.endpoint import default_capabilities
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from google.antigravity import CapabilitiesConfig
from google.antigravity.models import (
    DEFAULT_MODEL,
    GeminiModelOptions,
    ThinkingLevel,
)
from google.antigravity.types import BuiltinTools, GeminiAPIEndpoint

MODEL = os.environ.get("GEMINI_MODEL") or DEFAULT_MODEL
# The models the page may ask for. Anything else runs on MODEL. Keep this in
# step with src/lib/models.ts.
MODELS = [
    m.strip()
    for m in (
        os.environ.get("GEMINI_MODELS")
        or f"{MODEL},gemini-4-neon,gemini-3.1-pro-preview"
    ).split(",")
    if m.strip()
]
if MODEL not in MODELS:
    MODELS.insert(0, MODEL)
# "low" by default: the canvas arrives in one tool call that the harness does
# not stream, so every second of thinking is a second of an empty canvas.
THINKING_LEVEL = os.environ.get("GEMINI_THINKING_LEVEL") or "low"


def _short_dir(env_var: str, container_default: str, name: str) -> str:
    """A short, writable folder for the harness.

    The harness needs a workspace even though this agent touches no files.
    Keep the path short: the model copies it into tool calls, and long
    random paths (like macOS temp folders) get copied wrong.
    """
    explicit = os.environ.get(env_var)
    candidates = (
        [explicit]
        if explicit
        else [
            container_default,
            os.path.join("/tmp", name),
            os.path.join(tempfile.gettempdir(), name),
        ]
    )
    for candidate in candidates:
        try:
            os.makedirs(candidate, exist_ok=True)
            probe = os.path.join(candidate, ".write-probe")
            with open(probe, "w"):
                pass
            os.remove(probe)
            return candidate
        except OSError:
            continue
    raise RuntimeError(
        f"None of these folders is writable: {candidates}. "
        f"Set {env_var} to a short, writable path."
    )


WORKSPACE = _short_dir("ANTIGRAVITY_WORKSPACE", "/data/ws", "canvasws")
SAVE_DIR = _short_dir("ANTIGRAVITY_SAVE_DIR", "/data/sessions", "canvassess")


def _endpoint() -> GeminiAPIEndpoint | None:
    """A Gemini-compatible server or a thinking level, when either is set."""
    base_url = os.environ.get("GOOGLE_GEMINI_BASE_URL", "").rstrip("/") or None
    if base_url is None and THINKING_LEVEL is None:
        return None
    options = (
        GeminiModelOptions(thinking_level=ThinkingLevel(THINKING_LEVEL))
        if THINKING_LEVEL
        else None
    )
    return GeminiAPIEndpoint(base_url=base_url, options=options)


SYSTEM_INSTRUCTIONS = """You build and edit a live canvas next to the chat. \
The user asks for a dashboard, a form or a report, and you draw it on the \
canvas with A2UI, then keep editing that same canvas as they ask for changes.

## Every turn, in this order

1. Call `get_app_context` once. It returns the generative UI guide: the \
components and their props, the "canvas" target, and the surfaces that \
already exist with any values the user entered. Do not call it again in the \
same turn.
2. Write one short sentence in the chat that says what you are building or \
what you changed. No lists, no markdown headings.
3. Last, call `render_ui` exactly once, with target "canvas" and every \
operation in that one call. Write nothing after it: the turn ends there.

Never ask the user a question first. If they leave something out, choose \
sensible, realistic sample data and build.

The result of `render_ui` comes back to you right after the call. If it \
lists rejected operations, the canvas is missing those parts: call \
`render_ui` again with only those operations, fixed, and do not resend the \
parts that were accepted. If nothing was rejected, the canvas is done: do \
not call `render_ui` again. Reply with one short question that offers a \
next change that fits this canvas, such as "Want a chart of revenue by \
region?", and stop. Never repeat a question you already asked.

## The canvas

- There is one canvas surface. If none exists yet, create it with \
`createSurface` (surfaceId "canvas-main", with only the root Column in \
"components"), then add the rest with `updateComponents`. If one exists, \
edit it in place with `updateComponents`: a component with an id that \
already exists replaces it. Never delete the surface and never create a \
second one.
- Send `updateComponents` as several operations, one per section (header, \
summary cards, each group of cards, table). A component with a wrong prop \
gets its whole operation rejected, so small operations lose less.
- Write values straight into props. Use the data model only to read what the \
user types into inputs.
- Keep it tight: a Title and a one-line Caption, a row of three summary \
cards, then the main content. At most about 40 components.
- Never write raw CSS colors: the user can switch the canvas to dark mode, \
and the color tokens follow it.

## Props (the validator rejects anything else)

Every component is {"id": "...", "component": "<Name>", ...props}, and \
"component" is never left out. Children are lists of ids.

- Column, Row: children, gap (number, 4px steps), align (start|center|end|\
stretch), justify (start|center|end|spaceBetween), padding.
- Grid: children, columns (number), gap.
- Card: children, variant (default|outline|soft|elevated), size (sm|md|lg), \
padding, gap.
- Title: text, size (sm|md|lg|xl|2xl; "2xl" once at the top, "lg" for \
sections). There is no "level".
- Caption: text, size (sm|md|lg).
- Text: text, size (xs|sm|md|lg), fontWeight (normal|medium|semibold|bold), \
color. "weight" is flex-grow, not boldness.
- Badge: label (not "text"), color (secondary|success|danger|warning|info|\
discovery), variant (soft|solid|outline).
- Button: label, variant (default|primary|soft|borderless), color (primary|\
secondary|danger), size (sm|md|lg), disabled, onClick.
- Chart: chartType (bar|line|area|pie|donut), data (list of objects), xKey \
(the category field), series (list of value field names), layout \
(vertical|horizontal), format (number|currency|percent), height (number), \
yAxis ({"min": 0, "max": 1}), showLegend, showValueLabels. There is no \
"type", "x", "y" or "horizontal". With format "percent" the values are \
fractions: 0.4 shows as 40%. Set showLegend false for a single series.
- Table: columns (list of header strings), rows (list of row lists of \
strings or numbers). Put it in a Column, not in a Card.
- Divider: no props needed.
- TextField: label, placeholder, variant (shortText|longText|email|number|\
tel), required, value ({"@path": "/form/name"}).
- Select: label, options (list of strings), value ({"@path": "/form/x"}).
- CheckBox: label, value ({"@path": "/form/x"}).
- DateTimeInput: label, enableDate, enableTime, value ({"@path": "/form/x"}).
- Form: children, onSubmit. A Button with "submit": true submits it.
- Text color tokens: secondary, success, info, warning, danger, discovery.

- Box: children, width, height, radius (full|lg|md), background (surface-\
secondary, or a token with -solid: info-solid, success-solid, \
warning-solid, danger-solid), padding.

There is no progress-bar component. Draw one with two Boxes, as in the \
example: a surface-secondary track with a colored fill whose width is the \
percent. Numbers for gap, padding, width and height are 4px steps, so a \
bar of height 2 is 8px tall. For "a progress chart", use a bar Chart of every goal: data \
[{"goal": "Partner program", "progress": 0.4}, ...], xKey "goal", series \
["progress"], format "percent", yAxis {"min": 0, "max": 1, "width": 150}, \
showLegend false. In a horizontal chart, yAxis width sets the room for the \
category labels: keep it at 150 and the labels under 22 characters, and \
leave showValueLabels off (the labels overlap the bars).

## Buttons and events

For goals or tasks, each open item gets a "Mark done" Button (event name \
mark_done) and each finished one a disabled "Done" Button. \
Give each item the user can act on a Button whose `onClick` is an event: \
{"event": {"name": "mark_done", "userMessage": "Mark \\"Launch the partner \
program\\" as done"}}. Name the item in the userMessage and leave out \
"context": the chat shows every context field under the message. A click \
reaches you as that user message. Then update the canvas (for a done goal: a success Badge, a \
full success-solid bar, and a disabled "Done" button) and confirm it in the chat. A \
Form's onSubmit works the same way, with the field values in its context: \
"context": {"email": {"@path": "/form/email"}}.

## Example

A goal card, in one updateComponents operation:
{"version": "1.0", "updateComponents": {"surfaceId": "canvas-main", \
"components": [
{"id": "g3", "component": "Card", "variant": "outline", "size": "sm", \
"children": ["g3-head", "g3-bar", "g3-pct", "g3-done"]},
{"id": "g3-head", "component": "Row", "justify": "spaceBetween", \
"align": "center", "children": ["g3-title", "g3-badge"]},
{"id": "g3-title", "component": "Text", "text": "Launch the partner program", \
"fontWeight": "semibold"},
{"id": "g3-badge", "component": "Badge", "label": "At risk", "color": "warning"},
{"id": "g3-bar", "component": "Box", "height": 2, "radius": "full", \
"background": "surface-secondary", "padding": 0, "children": ["g3-fill"]},
{"id": "g3-fill", "component": "Box", "width": "40%", "height": 2, \
"radius": "full", "background": "warning-solid", "padding": 0},
{"id": "g3-pct", "component": "Caption", "text": "40% complete"},
{"id": "g3-done", "component": "Button", "label": "Mark done", "size": "sm", \
"onClick": {"event": {"name": "mark_done", "userMessage": "Mark \\"Launch \
the partner program\\" as done"}}}
]}}

## Common requests

- "Make it more compact": smaller gaps and padding, size "sm" cards and \
text, shorter wording. Keep every piece of data.
- "Add a chart": add a Chart that fits the data already on the canvas.
- "Translate into <language>": rewrite every visible string on the canvas \
in that language, including titles, labels, badges, button labels, chart \
labels and the `userMessage` of each event. Button labels stay actions in \
the new language ("Mark done" becomes "Completar", not "Completado"). Keep \
the layout and the data.
"""


def _make_agent(model: str) -> AntigravityAgent:
    return AntigravityAgent(
        model=model,
        # The key comes from GEMINI_API_KEY, which the SDK reads itself.
        endpoint=_endpoint(),
        system_instructions=SYSTEM_INSTRUCTIONS,
        workspaces=[WORKSPACE],
        save_dir=SAVE_DIR,
        # Only the harness' `finish` tool: no file, shell or web tools.
        # Sub-agents and `ask_question` are off because nothing in this UI
        # answers them.
        capabilities=CapabilitiesConfig(
            enabled_tools=[BuiltinTools.FINISH], enable_subagents=False
        ),
        enable_ask_question=False,
        experimental_app_context=True,
        deduplicate_tool_calls=False,
    )


# One agent per model, made on first use. Each keeps its own sessions, and a
# thread stays on one model: the page starts a new chat when the model changes.
_agents: dict[str, AntigravityAgent] = {}
_agents_lock = asyncio.Lock()


async def _agent_for(model: object) -> AntigravityAgent:
    name = model if isinstance(model, str) and model in MODELS else MODEL
    async with _agents_lock:
        if name not in _agents:
            _agents[name] = _make_agent(name)
        return _agents[name]


def _sse(event) -> str:
    return f"data: {event.model_dump_json(by_alias=True, exclude_none=True)}\n\n"


async def _events(agent: AntigravityAgent, input_data: RunAgentInput):
    try:
        async for event in agent.run(input_data):
            yield _sse(event)
    except Exception as error:  # the run already started streaming
        logging.getLogger(__name__).exception("Agent run failed")
        yield _sse(
            RunErrorEvent(
                type="RUN_ERROR",
                message=f"Agent execution failed: {error}",
                code="AGENT_ERROR",
            )
        )


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    yield
    for agent in _agents.values():
        await agent.close()


app = FastAPI(title="Antigravity A2UI Canvas Agent", lifespan=_lifespan)


@app.post("/")
async def run(input_data: RunAgentInput):
    """The AG-UI run endpoint. `forwardedProps.model` picks the model."""
    model = (input_data.forwarded_props or {}).get("model")
    agent = await _agent_for(model)
    logging.getLogger("canvas").info(
        "run %s on %s", input_data.run_id, agent._model or MODEL
    )
    return StreamingResponse(
        _events(agent, input_data),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/capabilities")
async def capabilities():
    return default_capabilities(await _agent_for(MODEL))


@app.get("/models")
async def models():
    """The models this server accepts, the default first."""
    return {"default": MODEL, "models": MODELS}


@app.get("/health")
async def health():
    """Liveness for the dev loop and the container. Does not call the model."""
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    print(
        f"[agent] models={','.join(MODELS)} default={MODEL} thinking={THINKING_LEVEL}"
    )
    # Pass the app object, not "main:app", or uvicorn imports this module a
    # second time and builds the app twice.
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
