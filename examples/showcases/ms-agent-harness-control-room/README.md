# MS Agent Harness Control Room

A standalone AG-UI demo that exercises CopilotKit Harness primitives against a bundled local C# Control Room agent — or any remote AG-UI Harness endpoint you point it at.

The cockpit is a three-pane integrated layout (controls / workstream / inspectors) wired into a tiny fixture repo with a seeded failing test. Ask the agent to fix the test; it inspects the repo, requests approval for shell and patch actions, applies a minimal patch, reruns tests, and updates live state, todos, memory, and observers as it works.

## Prerequisites

- **Node.js 20+** and **pnpm 9+**.
- **Docker Desktop** (or any Docker engine with `docker compose`). The .NET 9 agent runs entirely inside Docker — you do not need the .NET SDK on your host.
- A **GitHub Models** token (used as the credential for the OpenAI-compatible chat API). `gh auth token` prints one if you're signed into the GitHub CLI.

## Quick start

```bash
cd examples/showcases/ms-agent-harness-control-room

# 1. Install Node deps.
pnpm install

# 2. Put your GitHub Models token in .env.
cp .env.example .env
# then edit .env and set GITHUB_TOKEN=<token>

# 3. Start everything.
pnpm dev
```

`pnpm dev` runs two processes concurrently:

- **Next UI** on http://localhost:3000.
- **Local C# agent** in Docker on http://localhost:8000. The first run builds the image (a couple of minutes); subsequent runs are fast.

Open http://localhost:3000 and you should see the three-pane cockpit.

## What you'll see

- **Left pane:** endpoint selector, mode toggle (Plan / Act / Review), command buttons (`install`, `test`, `test:coverage`, `typecheck`), fixture reset, reconnect, approval queue.
- **Center pane:** chat with a suggested starter prompt — _"Fix the seeded failing test in the fixture repo."_ Tool cards (shell output, file reads, diff proposals, generated results) appear inline as the agent works.
- **Right pane:** live state, todos, memory, repo / test / tool / state observers, feature autodetection, connection status.

App-owned wrappers that exist because the underlying Harness + AG-UI primitive isn't yet native are labeled with a small amber badge reading **"Live wrapper: pending native Harness AG-UI support"**. Native primitives (chat, mode, todos, memory, generated result, state snapshot) are unbadged.

## The demo story

1. Click the starter prompt or type _"Fix the seeded failing test in the fixture repo."_
2. The agent calls `repo_list_files` and `repo_read_file` to inspect the fixture.
3. It requests approval to run `pnpm test` (a small approval card appears with Approve / Reject buttons).
4. After approval, `command_run_registered` runs the test inside the container — you see exit code and stderr.
5. The agent proposes a minimal patch to `src/calculator.ts` via `repo_propose_patch` (diff card with Approve / Reject).
6. After approval, `repo_apply_patch` writes the patch, then it reruns `test` and `test:coverage`.
7. The final card summarizes the bug discovered, the patch applied, and the new passing state. Todos, memory, observers, and live state update in lock-step on the right.

The seeded bug: `add(a, b)` returns `a - b`. The expected fix is the obvious one.

## Endpoint switching

By default the cockpit talks to the bundled local agent at `http://localhost:8000/`. To point at a remote AG-UI Harness endpoint:

1. Type the new URL into the endpoint selector in the left pane.
2. Click **Connect**.

The endpoint is validated server-side. Allowed:

- `http://localhost:*` and `http://127.0.0.1:*`
- `https://*` (any host)

Rejected:

- Plain HTTP remote hosts (no TLS).
- Malformed URLs.
- `file://`, `javascript:`, and empty strings.

The validated endpoint is sent to the Next.js runtime as the `x-control-room-endpoint` header on every CopilotKit request; the runtime constructs a per-request `HttpAgent` against that endpoint.

## Fixture reset

Click **Reset fixture** in the left pane (or call `POST /api/fixture/reset` directly). The agent:

- Deletes `/app/.control-room-fixture` inside the container.
- Copies `fixture-template/` back into place — restoring the seeded failing test.

The active fixture lives in the container's writable layer and is wiped whenever you `docker compose down`. Containment is enforced server-side:

- File access is rejected for any path outside the active fixture root.
- Only four shell commands are allowed: `install`, `test`, `test:coverage`, `typecheck` — each runs `pnpm <command>` in the fixture root.
- Shell execution, file writes, and patch application require an approval token.
- Stdout/stderr are truncated at 12,000 characters per call.

## Configuration

`.env` (loaded by `docker-compose.yml`):

| Variable          | Required | Default                                 | Notes                                                      |
| ----------------- | -------- | --------------------------------------- | ---------------------------------------------------------- |
| `GITHUB_TOKEN`    | yes      | —                                       | GitHub Models token used as the OpenAI-compatible API key. |
| `OPENAI_BASE_URL` | no       | `https://models.inference.ai.azure.com` | Override the chat API base.                                |

The `.env` file is gitignored — your token never leaves the host.

## Smoke verification

If you just want to confirm the wiring is alive (no LLM call):

```bash
# In one shell
pnpm dev

# In another shell, once the agent container reports "Now listening on…":
curl http://localhost:8000/health
# → {"status":"ok"}

curl http://localhost:8000/features
# → {"native":[...],"live_wrappers":[...]}

curl -X POST http://localhost:8000/fixture/reset
# → {"reset":true,"file_count":<N>}

# Or hit the Next.js proxies (default endpoint):
curl http://localhost:3000/api/features
curl -X POST http://localhost:3000/api/fixture/reset
```

Then open http://localhost:3000 and:

- UI loads with three panes.
- Local endpoint connects by default.
- "Fix the seeded failing test in the fixture repo." completes the demo story end-to-end.
- Approval cards appear before shell execution and before patch application.
- Shell output, file read, diff, and final result cards render in the center pane.
- Tests pass after rerun; coverage output appears.
- Todo, state, memory, and observer panels update in the right pane.
- Fixture reset returns the repo to the failing state.
- Entering `http://example.com/` is rejected; entering `https://example.com/` is accepted.
- After stopping and restarting `pnpm dev`, **Reconnect** in the left pane reattaches the cockpit to the new agent process.

## Architecture (one screen)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Browser (http://localhost:3000)                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │  React cockpit (Tasks 5/6)                                          │ │
│  │  └─ <CopilotKit> with headers={() => ({                              │ │
│  │       "x-control-room-endpoint": currentEndpoint })}                 │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │ /api/copilotkit (CopilotRuntime + HttpAgent)
                                     │ /api/features, /api/fixture/reset, /api/approvals/*
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Next.js API layer (Task 4) — same Next process                           │
│  - validates endpoint header                                              │
│  - constructs CopilotRuntime + HttpAgent per request                      │
│  - proxies /features, /fixture/reset, /approvals/{id}/(approve|reject)    │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │ HTTP to ${endpoint}
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  .NET 9 Control Room agent (Tasks 2/3) — Docker container                 │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │  Microsoft.Agents.AI.Hosting.AGUI.AspNetCore                         │ │
│  │  - AG-UI endpoint at /                                                │ │
│  │  - HTTP helpers: /health, /features, /fixture/reset, /approvals/*    │ │
│  │  - 12 tools: fixture_reset, repo_list_files, repo_read_file,         │ │
│  │    repo_propose_patch, repo_apply_patch, command_request_approval,   │ │
│  │    command_run_registered, approval_list, memory_write,              │ │
│  │    state_snapshot, observer_snapshot, generated_result_card           │ │
│  │  - SharedStateAgent emits ControlRoomStateSnapshot                   │ │
│  │  - FixtureWorkspace / CommandRegistry / ApprovalStore / ObserverStore│ │
│  │    enforce containment, approvals, output truncation                  │ │
│  │  - Node + pnpm installed in the runtime image so fixture commands run │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

## Troubleshooting

- **Container fails to build with "GITHUB_TOKEN is required":** copy `.env.example` to `.env` and set `GITHUB_TOKEN`.
- **Port 8000 already in use:** stop the other process or edit `docker-compose.yml` (change the host-side port mapping; the agent listens on container port 8000).
- **`docker compose up` warns about an obsolete `version` field:** ignored — the file intentionally omits the deprecated `version` key.
- **UI loads but chat returns immediately with no tool calls:** check the agent container logs. The most common cause is an invalid `GITHUB_TOKEN`.
- **Approve / Reject buttons fail silently:** check the browser network panel. The approval proxy routes return 502 if the agent is unreachable.

## Limitations (intentional for the first version)

- Smoke validation only — no Playwright, no automated TypeScript or C# tests.
- The `.control-room-fixture` lives in the container; restarting the container (`docker compose down && docker compose up`) wipes any in-progress work.
- The `state_snapshot` tool path and the `SharedStateAgent` structured-output path each emit a snapshot per turn; the UI deduplicates by always trusting the latest accepted snapshot.
- Approve / reject use REST proxy routes rather than the AG-UI tool-result channel; the UI updates optimistically.
