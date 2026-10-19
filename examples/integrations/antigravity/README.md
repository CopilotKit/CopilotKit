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
  harness treats the bad path as fatal. Measured: 0/14 runs
  failed with a 9-character workspace, 2/14 with a 75-character one. Nothing in
  the resulting error message points at path length.
- **The model call happens in Go, not Python.** So Python cannot attach
  per-request headers to it. Anything the call needs — the API key, a custom
  endpoint, fixed headers — is configured on the agent up front.

Conversation history lives inside the harness process, keyed by thread. That is
also why the model sees shared state only through tools: server tools can read
and write it with the adapter's experimental `experimental_get_state()` /
`experimental_set_state()`, and this starter keeps to chat and tools.

## Prerequisites

- Node.js 20+
- Python 3.10+ and [uv](https://docs.astral.sh/uv/getting-started/installation/)
  (`npm install` runs `uv sync` for you)
- A **Gemini API key** from [Google AI Studio](https://aistudio.google.com/apikey),
  as `GEMINI_API_KEY`. That is the only name the Antigravity SDK reads, so an
  ADK-style `GOOGLE_API_KEY` is not picked up. To send the same Gemini requests
  to another Gemini-compatible server, such as a gateway, set
  `GOOGLE_GEMINI_BASE_URL` as well.

## Getting started

```bash
cp .env.example .env      # then put your GEMINI_API_KEY in it
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
browser ──► /api/copilotkit  ──►  agent :8000  ──►  Go localharness ──► Gemini
 (React)     (CopilotKit         (FastAPI +          (plans, runs
              runtime route)      ag-ui-antigravity)  tools, calls
                                                      the model)
```

- **`agent/main.py`** — builds one `AntigravityAgent` (model, system prompt,
  the `get_weather` tool, the workspace, and a `CapabilitiesConfig` that
  enables only the `finish` built-in), wraps it with
  `create_antigravity_app(agent, path="/")`, and serves it on `:8000` plus a
  `/health` route. Built-ins are trimmed on purpose: `search_web` returns an
  empty summary without Google credentials and the model retries it forever,
  and `ask_question` would park on an interrupt this UI never answers.
- **`src/app/api/copilotkit/[[...slug]]/route.ts`** — the CopilotKit runtime
  route. It registers an `HttpAgent` pointed at `AGENT_URL` under the name
  exported from `src/agent.ts`, and is what the browser talks to.
- **`src/app/page.tsx`** — the UI and all three tool registrations.

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
docker run -p 3000:3000 -e GEMINI_API_KEY=... antigravity-starter
```

**Two containers plus a mock model** (`docker-compose.test.yml`) — the smoke
suite. It boots [aimock](https://www.npmjs.com/package/@copilotkit/aimock) with
the fixtures in `./fixtures`, points the agent's Gemini endpoint at it, and runs the shared
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

**`a Gemini API key is required`** — `GEMINI_API_KEY` is missing. Put it in
`.env`. The harness wants it even when `GOOGLE_GEMINI_BASE_URL` points at a
mock, which ignores its value.

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
