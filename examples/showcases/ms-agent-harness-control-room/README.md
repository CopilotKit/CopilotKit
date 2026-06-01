# MS Agent Harness Control Room

A standalone AG-UI demo that exercises CopilotKit Harness primitives against a bundled local C# Control Room agent — or any remote AG-UI Harness endpoint you point it at.

The cockpit is a showcase for Microsoft Agent Harness augmented by CopilotKit. A presenter starts from CopilotChat suggestions that demonstrate Harness planning, todos, skills, memory, file access, sample data, shell execution, approvals, and verification while CopilotKit renders AG-UI tool evidence, generative UI, and HITL approval cards inline.

For the presenter checklist and Notion requirement audit, see [SHOWCASE_RUNBOOK.md](./SHOWCASE_RUNBOOK.md).

## Prerequisites

- **Node.js 20+** and **pnpm 9+**.
- **Docker Desktop** (or any Docker engine with `docker compose`). The .NET 9 agent runs entirely inside Docker — you do not need the .NET SDK on your host.
- An **OpenAI API key**. The default `gpt-5.4` model requires a key with access to that model; set `OPENAI_MODEL_ID=gpt-5-mini` for a lighter rehearsal.

## Quick start

```bash
cd examples/showcases/ms-agent-harness-control-room

# 1. Install Node deps.
pnpm install

# 2. Put your OpenAI API key in .env.
cp .env.example .env
# then edit .env and set OPENAI_API_KEY=<token>

# 3. Start everything.
pnpm dev
```

`pnpm dev` runs two processes concurrently:

- **Next UI** on http://localhost:3000.
- **Local C# agent** in Docker on http://localhost:8000. The first run builds the image (a couple of minutes); subsequent runs are fast.

Open http://localhost:3000 and you should see the Agent Harness showcase.

## What you'll see

- **Showcase drawer:** a left-opening two-pane ShadCN sidebar. The icon rail switches between Generative UI, Harness State, and Settings. It defaults to the Generative UI catalog.
- **Center pane:** the live CopilotChat AG-UI workstream. Starter suggestions launch generic workspace demos for orientation, charts, planning, approvals, and handoff.
- **State panel:** compact Harness evidence: mode, todos, files, latest test, approvals, memory, skills, and feature support.
- **Settings panel:** endpoint switching, command shortcuts, fixture reset, structured output, manual skill loading, and feature autodetection details.

App-owned wrappers that exist because the underlying Harness + AG-UI primitive isn't yet native are labeled with a small amber badge reading **"Live wrapper: pending native Harness AG-UI support"**. Native Harness primitives are still shown honestly; until `STATE_SNAPSHOT` / `STATE_DELTA` ships upstream, the UI derives mode, todos, memory, approvals, skills, and observers from AG-UI messages.

## Suggested demo paths

Use the CopilotChat starter suggestions instead of presenter step buttons:

1. **Explore workspace:** reads the workspace and renders one final Harness Summary.
2. **Chart sample data:** reads `data/revenue.csv` and renders one final chart.
3. **Plan an improvement:** inspects the workspace, creates a small todo list, and renders one final health table.
4. **Preview approval:** shows a display preview of a Harness approval surface without running commands.
5. **Create handoff:** saves a concise memory note when useful and renders one final handoff component.

Each `show...` generative UI component is terminal for its turn. The agent
finishes Harness tool calls first, then renders a single final component so tool
evidence does not get stranded mid-stream.

The real Harness approval card appears before shell tools run. The approval checkbox defaults to remembering the approved tool for the current session, so a missing-dependencies install and rerun can continue without hiding the safety mechanism.

## Endpoint switching

By default the cockpit talks to the bundled local agent at `http://localhost:8000/`. To point at a remote AG-UI Harness endpoint:

1. Open **Advanced controls** and type the new URL into the endpoint selector.
2. Click **Connect**.

The endpoint selector validates URLs before rebuilding the direct `HttpAgent`. The fixture-reset proxy applies the same allow-list when it forwards reset requests. Allowed:

- `http://localhost:*` and `http://127.0.0.1:*`
- `https://*` (any host)

Rejected:

- Plain HTTP remote hosts (no TLS).
- Malformed URLs.
- `file://`, `javascript:`, and empty strings.

CopilotKit uses the selected URL directly through `selfManagedAgents`; Next.js is not in the AG-UI chat path.

## Fixture reset

Click **Reset** in the Settings panel (or call `POST /api/fixture/reset` directly). The agent:

- Deletes `/app/.control-room-fixture` inside the container.
- Copies `fixture-template/` back into place — restoring the seeded TypeScript/data workspace.

The active fixture lives in the container's writable layer and is wiped whenever you `docker compose down`. Containment is enforced server-side:

- File access is rejected for any path outside the active fixture root.
- Only approved shell commands are allowed: `install`, `test`, `test:coverage`, `typecheck`, and `data:summary` — each runs inside the fixture root.
- Shell execution through `pnpm_run` requires a Harness approval. File writes remain sandboxed to the fixture root.
- Stdout/stderr are truncated at 12,000 characters per call.

## Configuration

`.env` (loaded by `docker-compose.yml`):

| Variable          | Required | Default   | Notes                                  |
| ----------------- | -------- | --------- | -------------------------------------- |
| `OPENAI_API_KEY`  | yes      | —         | OpenAI key used by the .NET agent.     |
| `OPENAI_MODEL_ID` | no       | `gpt-5.4` | Override the Responses API model name. |

The `.env` file is gitignored — your token never leaves the host.

## Smoke verification

If you just want to confirm the wiring is alive (no LLM call):

```bash
pnpm run verify:stage
```

Manual equivalent:

```bash
# In one shell, if you want the UI running too
pnpm dev

# In another shell, once the agent container reports "Now listening on…":
curl http://localhost:8000/health
# → {"status":"ok"}

curl http://localhost:8000/features
# → {"native":[...],"live_wrappers":[...]}

curl -X POST http://localhost:8000/fixture/reset
# → {"reset":true,"file_count":<N>}

# Or hit the Next.js reset proxy (default endpoint):
curl -X POST http://localhost:3000/api/fixture/reset
```

Then open http://localhost:3000 and:

- UI loads with the left-side showcase drawer control and CopilotChat workstream.
- Local endpoint connects by default.
- The starter suggestions launch the happy-path MAH + CopilotKit demo flows.
- A real Harness approval card appears before shell execution, and remembered approval reduces repeated clicks for the same session.
- Shell output, file read, and final result cards render in the center pane.
- Tests pass after rerun; coverage output appears.
- Todo, state, skill, memory, approval, and test evidence update in the State panel.
- Settings exposes endpoint switching, command shortcuts, structured output, skills, and feature support.
- Fixture reset returns the repo to the failing state.
- Entering `http://example.com/` is rejected; entering `https://example.com/` is accepted.
- After stopping and restarting `pnpm dev`, **Reconnect** in Advanced controls reattaches the cockpit to the new agent process.

## Architecture (one screen)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Browser (http://localhost:3000)                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │  React showcase cockpit                                              │ │
│  │  └─ <CopilotKitProvider selfManagedAgents={{                         │ │
│  │       control_room_agent: new HttpAgent({ url: currentEndpoint }) }}> │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │ AG-UI fetch + SSE directly to Harness
                                     │ /health, /features, /fixture/reset helpers
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  .NET 9 Control Room agent (Tasks 2/3) — Docker container                 │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │  Microsoft.Agents.AI.Hosting.AGUI.AspNetCore                         │ │
│  │  - AG-UI endpoint at /                                                │ │
│  │  - HTTP helpers: /health, /features, /fixture/reset                  │ │
│  │  - Harness providers: AgentMode, TodoList, FileAccess, FileMemory,   │ │
│  │    ToolApprovalAgent, AgentSkills                                     │ │
│  │  - App wrapper: ApprovalContentWireBridge carries approval content    │ │
│  │    over AG-UI as request_approval tool calls                          │ │
│  │  - Narrow pnpm_run function enforces command allow-list + truncation  │ │
│  │  - Node + pnpm installed in the runtime image so fixture commands run │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

## Troubleshooting

- **Container fails to build with "OPENAI_API_KEY is required":** copy `.env.example` to `.env` and set `OPENAI_API_KEY`.
- **Port 8000 already in use:** stop the other process or edit `docker-compose.yml` (change the host-side port mapping; the agent listens on container port 8000).
- **`docker compose up` warns about an obsolete `version` field:** ignored — the file intentionally omits the deprecated `version` key.
- **UI loads but chat returns immediately with no tool calls:** check the agent container logs. The most common cause is an invalid `OPENAI_API_KEY`.
- **Approve / Reject buttons fail silently:** check the browser network panel and agent logs. The Harness approval card returns an AG-UI tool result, so failures usually mean the agent connection was interrupted.

## Limitations (intentional for the first version)

- Smoke validation only — no Playwright, no automated TypeScript or C# tests.
- The `.control-room-fixture` lives in the container; restarting the container (`docker compose down && docker compose up`) wipes any in-progress work.
- Harness providers do not yet emit native `STATE_SNAPSHOT` / `STATE_DELTA`; the UI derives mode, todos, memory, skills, approvals, and observers from AG-UI messages.
- File writes are sandboxed to the fixture root but do not currently show a separate approval card. Shell execution does.
