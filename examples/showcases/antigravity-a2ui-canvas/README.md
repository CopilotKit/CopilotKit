# A2UI Canvas: CopilotKit × Google Antigravity

Chat on the left, a live canvas on the right. Ask for a dashboard, a form or a
report, and a [Google Antigravity](https://github.com/google-antigravity/antigravity-sdk-python)
agent on Gemini draws it as an [A2UI](https://a2ui.org) 1.0 surface, which
CopilotKit renders. Then keep editing that same canvas: make it compact, add a
chart, translate it, click its buttons, and step back through every version.

It is meant to be forked: one agent, one canvas, CopilotKit's standard
component catalog, and no custom components.

**Live demo:** https://a2ui-canvas-production.up.railway.app

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
button picks the model: Gemini 3.8 Flash (the default, fastest), Gemini 4
Neon, or Gemini 3.1 Pro.

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
Python ── FastAPI ── AntigravityAgent (one per model) ── Antigravity harness ── Gemini
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
- **The model picker** sends the chosen model with every run as
  `forwardedProps.model`. The agent server keeps one Antigravity agent per
  model and routes each run to it.

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
  the page starts one more run with no new message. If the runtime rejected
  some operations, the model sends them again, fixed; if not, it closes the
  turn with a short question. Sending the next user message into a paused turn
  instead makes ag-ui-antigravity 0.2.1 stall: the run never ends.
- **The canvas arrives all at once.** The harness sends a tool call's
  arguments in one piece, so nothing paints until the whole call is written.
  Thinking defaults to `low` to keep that wait short: about 20 seconds for the
  first dashboard on Gemini 3.8 Flash, and 10–20 seconds for an edit.
- **A conversation keeps its model.** Picking another model mid-chat starts a
  new chat.

## Settings

| Variable                 | Default                  | What it does                                                             |
| ------------------------ | ------------------------ | ------------------------------------------------------------------------ |
| `GEMINI_API_KEY`         | (required)               | The key the harness uses for every model call                            |
| `GEMINI_MODEL`           | `gemini-3.8-flash`       | The model when the page asks for none                                    |
| `GEMINI_MODELS`          | Flash, Neon, 3.1 Pro     | The models the picker may ask for; keep in step with `src/lib/models.ts` |
| `GEMINI_THINKING_LEVEL`  | `low`                    | `minimal`, `low`, `medium` or `high`                                     |
| `GOOGLE_GEMINI_BASE_URL` | Google's API             | A Gemini-compatible server to call instead                               |
| `LOG_LEVEL`              | `WARNING`                | `DEBUG` logs each run's model and tool calls parking and resuming        |
| `AGENT_URL`              | `http://localhost:8000/` | Where the Next.js runtime reaches the agent                              |

## Deploy

The `Dockerfile` builds one image with both processes; `entrypoint.sh` starts
the agent on 8000, waits for its `/health`, then starts Next.js on `PORT`.
`railway.toml` points Railway at it with `/api/health` as the healthcheck.

```bash
railway up            # from this folder, in a linked Railway project
echo "$GEMINI_API_KEY" | railway variable set GEMINI_API_KEY --stdin
```

Anyone who can open the deployed page runs the agent on your key, so the
runtime route rate limits agent runs (`src/lib/limits.ts`). Each message makes
two or three runs: the turn, then one or two that hand the render result back.

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
agent/main.py                    The agent server: instructions, one agent per model, routing
src/app/page.tsx                 Chat, input (model chip, "/" actions) and canvas
src/app/providers.tsx            CopilotKit, the trimmed catalog, the model sent with each run
src/app/api/copilotkit/          The CopilotKit runtime endpoint
src/lib/limits.ts                Rate limits and a request size cap for the hosted demo
src/components/canvas.tsx        The canvas, version arrows and quick actions
src/components/model-picker.tsx  The model chip and its menu
src/lib/use-canvas-repair.ts     Hands each render result back to the agent
src/lib/use-canvas-versions.ts   Stores a version after each finished render
```
