# A2UI Canvas: CopilotKit × Google Antigravity

Chat on the left, a live canvas on the right. Ask for a dashboard, a form or a
report, and Gemini draws it as an [A2UI](https://a2ui.org) 1.0 surface, which
CopilotKit renders. Then keep editing that same canvas: make it compact, add a
chart, translate it, click its buttons, and step back through every version.

Two paths draw the canvas, and the chip in the chat input switches between
them. **Express streaming** (the default) asks Gemini for A2UI Express and
paints each piece as it arrives, about 2.5 seconds after you send. The
**[Google Antigravity](https://github.com/google-antigravity/antigravity-sdk-python)
agent** draws the whole canvas in one tool call.

It is meant to be forked: one agent, one canvas, CopilotKit's standard
component catalog, and no custom components.

**Live demo:** https://a2ui-canvas.copilotkit.ai

## Try it

1. Pick **Q4 team goals**. The agent writes one line in the chat and draws a
   dashboard with summary cards, a progress chart and a card per goal.
2. Type _Add a progress chart and make the cards more compact._ The same
   canvas is edited in place.
3. Click **Translate**. Every visible string, chart labels and button labels
   included, comes back in Spanish.
4. Click a goal's **Mark done** button. The click reaches the agent as a chat
   message, and the goal, the totals and the chart update.
5. Click **Dark**, then use the arrows at the top right to go back to v1.

Typing `/` in the chat lists the canvas actions. The chip next to the send
button picks the model (Gemini 3.8 Flash, the default and fastest; Gemini 4
Hydrogen; Gemini 4 Neon) and the drawing path. Edits are outlined for a moment
so you can see what changed.

## Run it locally

You need Node 20+, [pnpm](https://pnpm.io), Python 3.11–3.14,
[uv](https://docs.astral.sh/uv/) and a Gemini API key.

```bash
pnpm install          # also creates the agent's venv with uv
cp .env.example .env  # then set GEMINI_API_KEY
pnpm dev              # Next.js on :3000, the agent on :8000
```

Open http://localhost:3000.

## How it works

```
Browser ── CopilotChat + GenerativeUISurface("canvas")
   │  AG-UI over /api/copilotkit
Next.js ── CopilotRuntime ── GenerativeUIMiddleware (adds render_ui + the UI guide)
   │  HttpAgent
Python ── FastAPI ─┬─ Express: one streaming Gemini call ── A2UI SDK compiler
                   └─ AntigravityAgent (one per model) ── Antigravity harness ── Gemini
```

- **The canvas** is a `GenerativeUISurface` with the id `canvas`
  (`src/components/canvas.tsx`). CopilotKit's runtime gives every run a
  `render_ui` tool and a guide listing the catalog's components and props. The
  agent calls `render_ui` with A2UI operations, the runtime checks each one
  against the catalog, and the page draws the result.
- **The catalog** is CopilotKit's standard UI with the components a dashboard
  does not need removed (`src/app/providers.tsx`). The guide lists every
  component's props, so a shorter catalog keeps the guide short and the model
  on props that exist.
- **The agent** (`agent/main.py`) has no tools of its own. Its instructions
  carry an exact prop sheet for the components it should use, because Gemini
  otherwise writes props from memory (`level` on a Title, `text` on a Badge)
  and the runtime rejects the whole operation.
- **Versions** are kept in the page (`src/lib/use-canvas-versions.ts`): each
  finished render is stored, and an older one is drawn read-only by the
  chat's surface renderer (`src/components/stored-version.tsx`).
- **Buttons** on the canvas carry an A2UI event with a `userMessage`. A click
  becomes that chat message and a new run.
- **The model chip** sends the chosen model and path with every run as
  `forwardedProps.model` and `forwardedProps.path`. The agent server routes
  each run: Express to `agent/express.py`, Antigravity to one agent per model.

## The Express path

`agent/express.py` makes one streaming Gemini call per turn and asks for A2UI
Express, a compact, line-oriented notation that Google's A2UI SDK compiles to
standard A2UI operations as the text arrives.

- **It paints as it writes.** The model writes `root =` first and then each
  component below its parent. The SDK turns the first line into
  `createSurface` and every statement after it into an `updateComponents`
  delta. Each one goes out at once inside a streamed `render_ui` call, so
  CopilotKit validates it and the canvas paints it while the model is still
  writing. The chat sentence before the block streams as the chat message.
- **Edits send only what changes.** The agent rebuilds the canvas from the
  thread's earlier `render_ui` calls, seeds the compiler with it, and shows it
  to the model as Express. The model writes `surface("canvas-main",
update=true)` and only the components that change.
- **The compiler and the renderer share one catalog.**
  `scripts/export-catalog.mjs` writes `agent/canvas_catalog.json` from the
  page's own generative UI (`src/lib/catalog-omit.json` lists what is left
  out). Run `pnpm export:catalog` after changing that list.
- **One retry.** If a reply stops compiling halfway, what already painted
  stays, and the agent asks the model once to finish it with the error quoted.
  If the retry does not compile either, the run ends with an error rather than
  reporting success; the painted part still stays.

On Gemini 3.8 Flash, the first canvas paints about 2.5 seconds after you send
and finishes in about 9; an edit paints in about 2.5 and finishes in about 6.

## What Antigravity changes

Antigravity is Google's agent harness: a Go process that plans the turn,
calls the model and runs tools. A few of its traits shape this demo, and the
workarounds are worth knowing before you change it.

- **The model only sees the UI guide through a tool.** Antigravity fixes the
  instructions when a conversation starts, so the per-run guide in
  `RunAgentInput.context` would never reach it. `experimental_app_context`
  gives the model a `get_app_context` tool, and the instructions tell it to
  call that once per turn.
- **A turn pauses at `render_ui`.** A frontend tool ends the AG-UI run, and its
  result reaches the model with the next run. So the agent writes its chat
  line first and draws last.
- **The page hands each render result straight back**
  (`src/lib/use-canvas-repair.ts`). When a run ends on a `render_ui` result,
  the page starts one more run with no new message, so a rejected operation is
  fixed at once instead of on the user's next message: the model sends the
  rejected operations again, fixed, or closes the turn with a short question.
  A hand-back counts only once its run finishes, and a failed one is tried
  again, up to three runs per message. A result that still has not reached the
  agent goes with the next message; ag-ui-antigravity answers the paused call
  and adds the message to the same turn.
- **The canvas arrives all at once.** The harness sends a tool call's
  arguments in one piece, so nothing paints until the whole call is written.
  Thinking defaults to `low` to keep that wait short: about 20 seconds for the
  first dashboard on Gemini 3.8 Flash, and 10–20 seconds for an edit.
- **A conversation keeps its model and path.** A new choice mid-chat starts a
  new chat.

## Settings

| Variable                 | Default                  | What it does                                                           |
| ------------------------ | ------------------------ | ---------------------------------------------------------------------- |
| `GEMINI_API_KEY`         | (required)               | The key the harness uses for every model call                          |
| `GEMINI_MODEL`           | `gemini-3.8-flash`       | The model when the page asks for none                                  |
| `GEMINI_MODELS`          | Flash, Hydrogen, Neon    | Overrides which models a run may ask for; `GEMINI_MODEL` stays allowed |
| `GEMINI_THINKING_LEVEL`  | `low`                    | `minimal`, `low`, `medium` or `high`, on both paths                    |
| `GOOGLE_GEMINI_BASE_URL` | Google's API             | A Gemini-compatible server to call instead                             |
| `LOG_LEVEL`              | `WARNING`                | `DEBUG` logs each run's model and tool calls parking and resuming      |
| `AGENT_URL`              | `http://localhost:8000/` | Where the Next.js runtime reaches the agent                            |

## Deploy

The `Dockerfile` builds one image with both processes; `entrypoint.sh` starts
the agent on 8000, waits for its `/health`, then starts Next.js on `PORT`. If
the agent is not answering within `AGENT_STARTUP_SECONDS` (60 by default), or
either process stops later, the container exits with a nonzero code, so
Railway's `ON_FAILURE` restart policy brings it back. `railway.toml` points
Railway at it with `/api/health` as the healthcheck.

```bash
railway up            # from this folder, in a linked Railway project
echo "$GEMINI_API_KEY" | railway variable set GEMINI_API_KEY --stdin
```

Anyone who can open the deployed page runs the agent on your key, so the
runtime route rate limits agent runs (`src/lib/limits.ts`). Each message makes
two or three runs: the turn, then one or two that hand the render result back.
A run counts only when the runtime would accept its body; a malformed one is
still refused, and still counts toward the per-visitor request limit.

| Variable                | Default | What it does                                           |
| ----------------------- | ------- | ------------------------------------------------------ |
| `AGENT_RUNS_PER_10_MIN` | 30      | Runs per visitor every 10 minutes, after a burst of 15 |
| `AGENT_RUNS_PER_HOUR`   | 600     | Runs across every visitor per hour                     |
| `AGENT_RUNS_PER_DAY`    | 2000    | Runs across every visitor per UTC day                  |
| `AGENT_RUNS_PAUSED`     | unset   | `1` turns live runs off                                |

The counts live in memory, which is right for one instance. With more, each
instance counts on its own.

## Files

```
agent/main.py                    The agent server: routing, and the Antigravity agent per model
agent/express.py                 The Express path: streaming Gemini call, A2UI SDK compiler
agent/canvas_catalog.json        The A2UI catalog the Express compiler checks against
scripts/export-catalog.mjs       Writes that catalog from the page's generative UI
src/app/page.tsx                 Chat, input (model chip, "/" actions) and canvas
src/app/providers.tsx            CopilotKit, the trimmed catalog, the model sent with each run
src/app/api/copilotkit/          The CopilotKit runtime endpoint
src/lib/limits.ts                Rate limits and a request size cap for the hosted demo
src/components/canvas.tsx        The canvas, version arrows and quick actions
src/components/model-picker.tsx  The model chip and its menu
src/lib/use-canvas-repair.ts     Hands each render result back to the agent
src/lib/use-canvas-versions.ts   Stores a version after each finished render
src/lib/use-change-highlight.ts  Outlines what each edit changed
```
