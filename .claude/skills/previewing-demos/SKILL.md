---
name: previewing-demos
description: Use when working on any demo in examples/integrations/* or examples/v2/* and you need to boot a live preview in the browser. Routes you to the right launch.json entry and pre-flight checks.
---

# Previewing CopilotKit demos

The repo has **Claude Preview MCP** (`mcp__Claude_Preview__preview_*`) wired up for every UI-rendering demo under `examples/integrations/*` and `examples/v2/*`. Entries live in `.claude/launch.json`.

## When to use this

If you're touching a demo's code and want to see the change in a browser (verify a fix, inspect behavior, take a screenshot for a PR), use the preview tools. Do **not** spawn a dev server via `Bash` for these demos — `preview_start` is already the right path.

## The workflow

1. **Pick the entry.** Names follow the convention `example-<slug>` where `<slug>` identifies the demo (e.g. `example-langgraph-python`, `example-mastra`, `example-react-demo`, `example-docs`). Run `preview_list` or read `.claude/launch.json` to see all names.
2. **Pre-flight check** (see the section below) — env vars, `npm install`.
3. **Start:** `preview_start({ name: "<entry>" })`. It reuses the server if already running.
4. **Interact:** `preview_click`, `preview_fill`, `preview_snapshot`, `preview_screenshot`, `preview_eval`, `preview_console_logs`.
5. **Stop when done** (optional — servers persist across turns): `preview_stop({ serverId })`. Use `preview_list` to find the ID.

## Pre-flight checks

Before `preview_start`, make sure these are in order. If you skip them the server will start but the demo will error on first request.

### Integration demos (under `examples/integrations/*`)

- **Not in the pnpm workspace.** Each integration has its own `package-lock.json`. You must run `npm install` inside the demo folder at least once before previewing, because the `postinstall` hook provisions the agent (Python venv, .NET project, etc).
  - Check: does `<demo>/node_modules` exist?
  - If not: `cd examples/integrations/<demo> && npm install` (slow first time — Python venvs etc).
- **Env var:** every integration needs `OPENAI_API_KEY` in `<demo>/.env`. Copy from `.env.example` if missing. If you're only verifying UI that doesn't hit the agent, the server will still boot.
- **`example-langgraph-python-threads`** also runs `docker compose up -d` as part of `dev:infra`. Make sure Docker Desktop is running.

### v2 demos (under `examples/v2/*`)

- **In the pnpm workspace.** If `pnpm install` at the repo root has been run, they're ready.
- **`example-react-demo` / `example-angular-demo`** consume workspace packages. If packages were rebuilt recently, the demo already picks them up; you don't need to restart preview for package edits unless the demo config caches aggressively.
- **`example-docs`** is a Mintlify docs site — no agent, no env needed.

## Port conventions

Most demos land on port 3000 (Next.js default). Dedicated ports:
- Storybook → 6006 (both `example-react-storybook` and `example-angular-storybook` — run them one at a time)
- `example-docs` → 4000 (Mintlify)
- `example-angular-demo` → 4200 (Angular CLI default)
- `example-react-router` / `example-agentcore-frontend` → 5173 (Vite default)

Port collisions don't matter across configs — `preview_start` only runs one at a time per name, and `preview_list` shows what's live.

## Adding a new demo

When you create a new demo under `examples/integrations/<new>` or `examples/v2/<new>`:

1. Open `.claude/launch.json`.
2. Add a configuration object:
   ```json
   {
     "name": "example-<new>",
     "cwd": "examples/integrations/<new>",
     "runtimeExecutable": "npm",
     "runtimeArgs": ["run", "dev"],
     "port": 3000
   }
   ```
3. Use `npm` for integrations (they have their own lockfile) and `pnpm` for v2 demos (workspace).
4. Set `port` to whatever the dev script binds to.
5. Commit the launch.json entry alongside the demo.

## What NOT to preview here

- `examples/v2/runtime/*`, `examples/v2/node`, `examples/v2/node-express` — backend-only, no UI surface to preview.
- `examples/v2/next-pages-router` — uses `example-dev` (not standalone dev).
- `examples/v1/*`, `examples/canvas/*`, `examples/showcases/*`, `showcase/starters/*`, `community/*` — out of scope for this skill. If you need to preview one, add it to `.claude/launch.json` following the same pattern.

## Troubleshooting

- **Port says "not listening":** the underlying dev script failed. Use `preview_logs({ serverId })` to see the output.
- **Hangs forever:** agent-backed demos take 30–60s for the first start as the Python/.NET agent compiles. Check `preview_logs` before killing.
- **"EADDRINUSE 3000":** another demo is already on that port — stop it via `preview_list` + `preview_stop`.
