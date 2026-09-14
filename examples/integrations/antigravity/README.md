# CopilotKit <> Google Antigravity Starter

A starter template for building agent-powered apps with
[Google Antigravity](https://github.com/google-antigravity/antigravity-sdk-python)
and [CopilotKit](https://copilotkit.ai). It ships a Next.js app, a Python agent
server, and a chat UI wired to both, with three working tool demos.

## What Antigravity is

Antigravity is Google's agent harness, not a Python agent loop. The
`google-antigravity` SDK starts a bundled Go `localharness` subprocess and
drives it over a WebSocket; that subprocess plans the turn, calls the model,
and runs tools — including **real file and shell access on the host machine.**

Two consequences shape this starter:

- **`workspaces=[...]` is mandatory.** It is the directory tree the harness is
  allowed to touch. `agent/main.py` sets it from `ANTIGRAVITY_WORKSPACE`
  (default `/data/ws` in Docker, `/tmp/agws` outside it). Keep the path
  **short**: a long, high-entropy path (a macOS temp directory is ~75
  characters) makes the model reproduce it wrongly inside a tool call, and the
  harness treats the bad path as fatal. Measured on `gpt-4.1-mini`: 0/14 runs
  failed with a 9-character workspace, 2/14 with a 75-character one. Nothing in
  the resulting error message points at path length.
- **The model call happens in Go, not Python.** So Python cannot attach headers
  to it — which is why this starter has a shim (below).

Conversation history lives inside the harness process, keyed by thread. That is
also why this starter has no shared-state demo: the adapter surfaces state
snapshots only from structured output, and there is no writable client state
yet.

## Prerequisites

- Node.js 20+
- Python 3.10+ and [uv](https://docs.astral.sh/uv/getting-started/installation/)
  (`npm install` runs `uv sync` for you)
- An **OpenAI API key**. The starter talks to an OpenAI-compatible model, and
  `google-antigravity` 0.1.9's OpenAI path carries only a `base_url` — no API
  key field, and the Go harness reads no `OPENAI_API_KEY`. A small in-process
  shim (`agent/src/openai_proxy.py`) adds the `Authorization` header and
  normalizes the SDK's Gemini-flavoured tool schemas into what OpenAI accepts.
  Point `OPENAI_BASE_URL` at Ollama or LM Studio to run against a local model
  instead.

  **Prefer Gemini?** Then you need no key of the OpenAI kind and no shim at
  all. In `agent/main.py`, delete the `start_background(...)` call and give the
  agent `api_key=os.environ["GEMINI_API_KEY"]` with **no** `base_url` — the
  native path needs neither the injected header nor the schema rewrite.

## Getting started

```bash
cp .env.example .env      # then put your OPENAI_API_KEY in it
npm install               # also creates agent/.venv via `uv sync`
npm run dev               # Next.js on :3000, the agent on :8000
```

Open [http://localhost:3000](http://localhost:3000).

`npm install` works the same with pnpm, yarn, or bun.

## What the demo shows

Ask the assistant in the sidebar:

| Try saying                             | What it exercises                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| "Make the background sea green."       | A **frontend tool** (`setThemeColor`) — the agent calls it, and it runs in your browser via `useFrontendTool`.           |
| "What's the weather in San Francisco?" | A **backend tool** (`get_weather`) — it runs in the Python process, and `useRenderTool` draws the result as a card.      |
| "Book me an onboarding call."          | **Human-in-the-loop** (`scheduleTime`) — `useHumanInTheLoop` shows a time picker and the run _parks_ until you pick one. |

The HITL case is worth a note, because Antigravity handles it unusually well.
Its custom tools are async, awaited, and carry no timeout, so when the agent
calls a frontend tool the Go harness simply blocks on the returned coroutine.
The adapter parks an `asyncio.Future`, lets the HTTP response close, and
resolves it from the _next_ request. Your answer becomes the tool's real return
value — no proxy tool, no fire-and-forget workaround.

## How the pieces fit

```
browser ──► /api/copilotkit  ──►  agent :8000  ──►  Go localharness ──► shim :8931 ──► model
 (React)     (CopilotKit         (FastAPI +          (plans, runs        (adds auth,
              runtime route)      ag-ui-antigravity)  tools, calls        fixes schemas)
                                                      the model)
```

- **`agent/main.py`** — builds one `AntigravityAgent` (model, system prompt,
  the `get_weather` tool, the workspace, and a `CapabilitiesConfig` that
  enables only the `finish` built-in), wraps it with
  `create_antigravity_app(agent, path="/")`, and serves it on `:8000` plus a
  `/health` route. Built-ins are trimmed on purpose: `search_web` returns an
  empty summary without Google credentials and the model retries it forever,
  and `ask_question` would park on an interrupt this UI never answers.
- **`agent/src/openai_proxy.py`** — the shim. It starts on a daemon thread,
  injects `Authorization: Bearer $OPENAI_API_KEY`, rewrites proto-style tool
  schemas (`"STRING"` → `"string"`), and forwards to `OPENAI_BASE_URL`. Note
  the SDK wants the **root** URL, not `.../v1` — the harness appends
  `/v1/chat/completions` itself. Delete this file once the SDK supports
  authenticated OpenAI endpoints natively.
- **`src/app/api/copilotkit/[[...slug]]/route.ts`** — the CopilotKit runtime
  route. It registers an `HttpAgent` pointed at `AGENT_URL` under the name
  exported from `src/agent.ts`, and is what the browser talks to.
- **`src/app/page.tsx`** — the UI and all three tool registrations.

### Interim: the adapter installs from a pinned commit

`ag-ui-antigravity` (the AG-UI ⇄ Antigravity adapter) is not on PyPI yet, so
`agent/pyproject.toml` pins it to a commit of the
[AG-UI repo](https://github.com/ag-ui-protocol/ag-ui). That means the install
needs a `git` client (the Docker files install one). Once the package is
published, replace that line with `ag-ui-antigravity==<version>` and drop git
from the images.

## Available scripts

- `dev` — starts both UI and agent servers in development mode
- `dev:debug` — same, with debug logging
- `dev:ui` / `dev:agent` — one side only
- `build` / `start` — production build and server
- `install:agent` — `uv sync` for the Python agent
- `channel` — holds an Intelligence Channel open (see below)
- `typecheck:channel` — type-checks the channel host on its own tsconfig

## Docker

Two ways to run it in containers:

**Single image** (`Dockerfile` + `entrypoint.sh`) — Next.js and the Python
agent in one container, the way a platform like Railway deploys it:

```bash
docker build -t antigravity-starter .
docker run -p 3000:3000 -e OPENAI_API_KEY=sk-... antigravity-starter
```

**Two containers plus a mock model** (`docker-compose.test.yml`) — the smoke
suite. It boots [aimock](https://www.npmjs.com/package/@copilotkit/aimock) with
the fixtures in `./fixtures`, points the agent's shim at it, and runs the shared
Playwright smoke spec against the app. No API key needed, no network calls:

```bash
STARTER=antigravity docker compose -f docker-compose.test.yml \
  up --build --abort-on-container-exit --exit-code-from tests
docker compose -f docker-compose.test.yml down -v
```

The agent image creates `/data/ws` and `/data/sessions` for the harness, and
installs `git` because of the pinned adapter above.

## Running a Channel

`channel-host.mts` mounts the same agent as an Intelligence Channel
(Slack, Teams). It requires `CPK_INTELLIGENCE_API_KEY` and a declared Channel in
`.copilotkit/channels.json` — set both up with `copilotkit init` or
`copilotkit channels add`, which write that file and the credentials your
`.env` needs, then:

```bash
npm run channel
```

The host reads which Channel to hold from `.copilotkit/channels.json`. If a
project declares more than one, set `INTELLIGENCE_CHANNEL_NAME` to pick one.

The host holds no provider credentials and exposes no provider endpoint —
Intelligence owns the provider edge — so the same file works for every provider.

The Channel itself is declared in `channels.mts` — that is where to add commands,
reactions, or an `onMention` handler. `channel-host.mts` only owns the process
lifetime, and is byte-identical in every starter.

Once startup finishes, the log reports the truth per Channel:

- `Channel "<name>" is online.` — the session is up and can send.
- `Channel "<name>" is declared but no provider is attached yet.` —
  a normal waiting state, not a failure. Run `copilotkit channels status` to
  see what setup remains.

Neither message proves the provider app is installed, reachable, or that
anyone can message it — verify that separately (invite the bot, then message
it) before treating the Channel as working.

## Troubleshooting

**`OPENAI_API_KEY must be set to use the OpenAI shim.`** — the agent exits at
import without it. Put it in `.env`, or switch to the Gemini path (above).

**`Port 8931 is already in use`** — the shim's port. Set
`ANTIGRAVITY_SHIM_PORT` to something free.

**`RUN_ERROR: The model produced an invalid tool call`** — often a long
workspace path rather than a model problem. Set `ANTIGRAVITY_WORKSPACE` to
something short and stable, like `/tmp/agws`.

**The agent answers, but a run silently goes quiet** — a crashed harness
process loses its uncheckpointed history (SQLite WAL), and the next run on that
thread rebuilds the session from `save_dir` and carries on. The rebuild logs a
warning naming the thread.

**The chat can't reach the agent** — check that the agent is up on `:8000`
(`curl localhost:8000/health`) and that `AGENT_URL` matches.

## Documentation

- [Google Antigravity SDK](https://github.com/google-antigravity/antigravity-sdk-python)
- [CopilotKit docs](https://docs.copilotkit.ai)
- [AG-UI protocol](https://github.com/ag-ui-protocol/ag-ui)
- [Next.js docs](https://nextjs.org/docs)

## License

MIT — see the LICENSE file.
