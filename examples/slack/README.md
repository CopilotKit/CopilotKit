# slack-example

Runnable demo for [`@copilotkit/slack`](../../packages/slack) — connect
a Slack workspace to an AG-UI agent.

This example contains:

- **`app/`** — a sample bridge app wiring frontend tools, render-only
  components, human-in-the-loop pickers, LangGraph interrupt handlers,
  and an A2UI catalog.
- **`agent/`** — a vendored, standalone AG-UI agent backend (the
  **beautiful_chat** + **interrupt_agent** showcase graphs). Ships its
  own lockfile and builds independently of the pnpm workspace.
- **`e2e/`** — a live-Slack test harness that sends real messages to a
  test channel and asserts on the streamed replies, plus a
  kill-and-restart recovery scenario.
- **`runtime.ts`** — a standalone CopilotKit Runtime that adapts the
  LangGraph agents to AG-UI for the bridge (an alternative to the
  agent's Next.js routes; run with `pnpm runtime`).

## Local run

Three pieces: the **Slack app** (created once), the **agent** (AG-UI
server), and the **slack bridge** (this example's `app/`).

### 1. Slack app

- <https://api.slack.com/apps?new_app=1> → **From a manifest** →
  paste `slack-app-manifest.yaml`.
- _OAuth & Permissions_ → **Install to Workspace** → copy the `xoxb-`
  bot token.
- _Basic Information → App-Level Tokens_ → generate one with
  `connections:write` → copy the `xapp-` app token.

### 2. Agent

One-time setup (uses [uv](https://github.com/astral-sh/uv) for Python
3.12 + npm for Node):

```bash
cd examples/slack
./setup-agent.sh
```

Start the agent backend — a Next.js app (port 3000) wrapping a LangGraph
dev server (port 8123):

```bash
cd agent
source .venv/bin/activate
export OPENAI_API_KEY=sk-...
npm run dev          # Next.js :3000 + LangGraph :8123
```

The Next.js app exposes one AG-UI route per graph under
`/api/copilotkit-*`, e.g. `http://localhost:3000/api/copilotkit-beautiful-chat`.

Optional: `pnpm runtime` (`tsx runtime.ts`) runs a standalone CopilotKit
Runtime adapter on port 8200 that proxies straight to the LangGraph dev
server (`http://localhost:8200/api/copilotkit/agent/<graphId>/run`) — use
it instead of the Next.js routes when you want the runtime to apply the
A2UI middleware stack itself.

### 3. Slack bridge

```bash
cp .env.example .env
# fill in SLACK_BOT_TOKEN, SLACK_APP_TOKEN, AGENT_URL
pnpm install        # from the repo root
pnpm dev            # tsx watch app/index.ts
```

`AGENT_URL` points at whichever AG-UI endpoint you're testing:

```env
# Default beautiful_chat (Next.js route — matches .env.example)
AGENT_URL=http://localhost:3000/api/copilotkit-beautiful-chat

# Via the standalone runtime adapter (pnpm runtime, port 8200)
AGENT_URL=http://localhost:8200/api/copilotkit/agent/beautiful_chat/run

# Anything that speaks AG-UI works
AGENT_URL=https://your-deployment.example.com/api/copilotkit
AGENT_AUTH_HEADER=Bearer your-token
```

### 4. Try it

In the Slack workspace, invite the bot to any channel and @mention it:

> @CopilotKit AG-UI Bot summarize the latest changes in this repo

The bot opens a thread and streams the agent's reply in place.

## Tests

```bash
pnpm test            # app unit tests
pnpm e2e             # live-Slack case catalog (needs a real workspace + agent)
pnpm e2e:restart     # kill + restart + click recovery scenario
```

See [`PROTO_E2E.md`](./PROTO_E2E.md) for the e2e harness design.
