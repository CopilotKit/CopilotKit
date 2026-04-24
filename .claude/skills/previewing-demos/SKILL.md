---
name: previewing-demos
description: Use when working on any demo in examples/integrations/*, examples/v2/*, or showcase/* (shells and starters) and you need to boot a live preview in the browser. Routes you to the right launch.json entry and pre-flight checks.
---

# Previewing CopilotKit demos

The repo has **Claude Preview MCP** (`mcp__Claude_Preview__preview_*`) wired up for every UI-rendering demo under `examples/integrations/*`, `examples/v2/*`, and `showcase/*` (shells and starters). Entries live in `.claude/launch.json`.

## When to use this

If you're touching a demo's code and want to see the change in a browser (verify a fix, inspect behavior, take a screenshot for a PR), use the preview tools. Do **not** spawn a dev server via `Bash` for these demos — `preview_start` is already the right path.

## The workflow

1. **Pick the entry.** Names use two namespaces to avoid collisions (several agent names repeat across roots):
   - `example-<slug>` → `examples/integrations/*` and `examples/v2/*` (e.g. `example-langgraph-python`, `example-mastra`, `example-react-demo`, `example-docs`)
   - `showcase-<slug>` → `showcase/shell*` and `showcase/starters/*` (e.g. `showcase-shell`, `showcase-shell-dashboard`, `showcase-langgraph-python`, `showcase-mastra`)

   Run `preview_list` or read `.claude/launch.json` to see all names.
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

### Showcase shells (under `showcase/shell*`)

- **Not in the pnpm workspace** — each shell has its own `package-lock.json`. Run `cd showcase/<shell> && npm install` first.
- **`showcase-shell`** is the main content shell. `showcase-shell-dashboard`, `showcase-shell-docs`, and `showcase-shell-dojo` are the other UIs that live alongside it.
- The shells' dev scripts bundle demo content from sibling folders. If `showcase/scripts` or `showcase/shared` isn't installed, the bundler step will fail — run `pnpm install` at the repo root too.

### Showcase starters (under `showcase/starters/*`)

- **Standalone projects** — each starter has its own `package.json` and typically a Python (or .NET / JVM) agent sidecar. Run `cd showcase/starters/<starter> && npm install` first. For Python-agent starters you also need `pip install` in the agent folder before the agent process can boot; check the starter's README for exact steps.
- All starters expose the UI on port 3000 and the agent on port 8123.
- `showcase-mastra`, `showcase-spring-ai`, `showcase-ms-agent-dotnet` need their respective toolchains (mastra CLI, Java/Maven, .NET SDK) on PATH.

## Port conventions

Most demos land on port 3000 (Next.js default). Dedicated ports:
- `showcase-shell-dojo` → 3001, `showcase-shell-dashboard` → 3002, `showcase-shell-docs` → 3003 (so you can run multiple shells side-by-side)
- Storybook → 6006 (both `example-react-storybook` and `example-angular-storybook` — run them one at a time)
- `example-docs` → 4000 (Mintlify)
- `example-angular-demo` → 4200 (Angular CLI default)
- `example-react-router` / `example-agentcore-frontend` → 5173 (Vite default)

Port collisions don't matter across configs — `preview_start` only runs one at a time per name, and `preview_list` shows what's live.

## Adding a new demo

When you create a new demo under `examples/integrations/<new>`, `examples/v2/<new>`, or `showcase/starters/<new>`:

1. Open `.claude/launch.json`.
2. Add a configuration object. Pick the namespace based on where the demo lives:
   ```json
   {
     "name": "example-<new>",
     "cwd": "examples/integrations/<new>",
     "runtimeExecutable": "npm",
     "runtimeArgs": ["run", "dev"],
     "port": 3000
   }
   ```
   or for showcase:
   ```json
   {
     "name": "showcase-<new>",
     "cwd": "showcase/starters/<new>",
     "runtimeExecutable": "npm",
     "runtimeArgs": ["run", "dev"],
     "port": 3000
   }
   ```
3. Use `npm` for integrations, showcase shells, and showcase starters (they all have their own lockfiles). Use `pnpm` for v2 demos (they're in the workspace).
4. Set `port` to whatever the dev script binds to.
5. Commit the launch.json entry alongside the demo.

## What NOT to preview here

- `examples/v2/runtime/*`, `examples/v2/node`, `examples/v2/node-express` — backend-only, no UI surface to preview.
- `examples/v2/next-pages-router` — uses `example-dev` (not standalone dev).
- `showcase/aimock` — Dockerized mock proxy, not a UI.
- `showcase/packages`, `showcase/scripts`, `showcase/ops`, `showcase/pocketbase`, `showcase/shared`, `showcase/tests` — infrastructure, not previewable apps.
- `showcase/starters/template` — meta-template, not a runnable demo.
- `examples/v1/*`, `examples/canvas/*`, `examples/showcases/*`, `community/*` — out of scope. If you need to preview one, add it to `.claude/launch.json` following the same pattern.

## Troubleshooting

- **Port says "not listening":** the underlying dev script failed. Use `preview_logs({ serverId })` to see the output.
- **Hangs forever:** agent-backed demos take 30–60s for the first start as the Python/.NET agent compiles. Check `preview_logs` before killing.
- **"EADDRINUSE 3000":** another demo is already on that port — stop it via `preview_list` + `preview_stop`.
- **"concurrently: command not found" or similar:** the demo folder hasn't been installed. Run `npm install` in that specific folder.
