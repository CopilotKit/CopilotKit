# @copilotkit/studio

A local-only web app for inspecting and iterating on CopilotKit **frontend tool
components** (`useCopilotAction` with `render`). Launched via `npx`; reached
from the existing in-page popup inspector via "Open in Web Inspector".

> **Status:** M0 spike — scan + display only. M1 (real AST scanner +
> watcher) and M2-M6 (fixtures, sandbox, arg form, timeline, popup handoff)
> are tracked in [`.chalk/plans/web-inspector-execution.md`][execution-plan].
>
> [execution-plan]: ../../.chalk/plans/web-inspector-execution.md

---

## What's in M0

- `apps/studio/` scaffolded as an Nx app.
- `apps/studio/src/shared/types.ts` — the locked contract types
  (`ToolDescriptor`, `ParameterDescriptor`, `LauncherEvent`, `LauncherCommand`).
- Minimal Node launcher (`src/launcher/`):
  - Recursive `*.{ts,tsx}` walker with skip list (`node_modules`, `dist`, etc.).
  - `useCopilotAction(` regex extraction; `name` literal pulled by lookahead.
  - WebSocket server at `ws://localhost:NNNN/__inspector/ws`.
  - HTTP server for built SPA assets (with dev-placeholder fallback).
- Minimal React SPA (`src/spa/`) — dumb list of detected tool name + file
  path + line number.
- `bin/studio.ts` — CLI entry. `--root <path>` and `--port <number>` flags.

## What is _not_ in M0 (handed off to later agents)

- `oxc-parser` AST scanning (M1).
- Real schema extraction (M1).
- `chokidar` file watcher (M1).
- Project-root walk-up — `--root` is mandatory in M0 (M1).
- Sibling `*.fixture.json` loading (M2).
- Sandbox iframe + `InspectorSandboxHost` (M3 — lives in
  `packages/react-core`).
- Arg form / `descriptor → form` renderer (M4).
- SSE timeline (M5).
- Popup handoff button (M6 — lives in `packages/web-inspector`).

---

## Smoke test (M0)

Pick a directory containing `useCopilotAction(` call sites. The
`examples/v1/` tree is the easiest M0 target — it has ~40 v1-style hook
sites:

```sh
pnpm install
pnpm exec tsx apps/studio/bin/studio.ts --root examples/v1
```

You should see something like:

```
[studio] Listening on http://localhost:4123
[studio] Scanning /abs/path/CopilotKit/examples/v1 ...
[studio] Scan complete: 40 tools across 301 files.
[studio] Open http://localhost:4123 in your browser.
```

The browser opens to a list of every detected `useCopilotAction(name, ...)`
plus its source file and line number. Use `--no-open` to suppress
auto-opening.

### Useful targets

| Target                      | Why                                                         |
| --------------------------- | ----------------------------------------------------------- |
| `examples/v1`               | Many v1-style `useCopilotAction` sites — easiest M0 target. |
| `examples/v1/state-machine` | Tight focused subset with ~9 tools.                         |
| `examples/v2/react/demo`    | A few v2 sites (M1 will handle `useFrontendTool` etc.).     |

> **Note (M0 limitation):** M0's scanner only matches the literal token
> `useCopilotAction`. The v2 hooks (`useFrontendTool`, `useRenderTool`,
> `useRenderToolCall`, `useDefaultRenderTool`) are listed in the
> `HookName` union and will be picked up once M1 ports
> `vscode-extension/src/extension/hooks/hook-scanner.ts` with the full
> `oxc-parser` walk.

---

## Nx targets

This is an Nx-managed app. Always invoke targets through `nx`:

```sh
# Run the launcher in dev mode (tsx watch)
nx run @copilotkit/studio:dev -- --root showcase/integrations

# Build SPA + launcher
nx run @copilotkit/studio:build

# Typecheck only
nx run @copilotkit/studio:typecheck

# Lint
nx run @copilotkit/studio:lint
```

`nx run-many -t test --projects=packages/**` (the pre-commit gate) is scoped
to `packages/**` and does not include this app. The repo's existing test
hook is therefore unaffected by adding this app.

---

## Layout

```
apps/studio/
  bin/
    studio.ts                   ← npx entry: arg parsing + launcher boot
  src/
    launcher/                   ← Node-side (runs in the npx process)
      index.ts                  ← orchestrator: HTTP + WS + scan
      scanner.ts                ← M0 regex scanner (replaced by oxc in M1)
      ws-server.ts              ← ws://localhost:NNNN/__inspector/ws
      http-server.ts            ← serves built SPA assets + placeholder
    spa/                        ← Browser-side (Vite-built)
      index.html
      main.tsx
      App.tsx
    shared/
      types.ts                  ← THE TYPE LOCK — see §7 of the main plan
  package.json
  project.json
  tsconfig.json                 ← typecheck-only config (whole app)
  tsconfig.launcher.json        ← emit-config for the Node launcher
  vite.config.ts                ← SPA build config
```

The SPA builds to `dist/spa/`; the launcher TS emits to `dist/`. The HTTP
server resolves `dist/spa` at runtime (with fall-back to a dev placeholder
page when the SPA hasn't been built — handy for `tsx` driving the launcher
directly).

---

## Design references

- [.chalk/plans/web-inspector-v1.md](../../.chalk/plans/web-inspector-v1.md)
  — full design. §7 defines the type lock; §8 defines this package layout.
- [.chalk/plans/web-inspector-execution.md](../../.chalk/plans/web-inspector-execution.md)
  — parallel-agent decomposition. The §4 file boundary matrix tells M2-M6
  agents which files they own without colliding.
