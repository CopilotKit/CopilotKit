# @copilotkit/studio

A local-only web app for inspecting and iterating on CopilotKit **frontend
tool components** (`useCopilotAction` with `render`). Launched via `npx`;
reached from the existing in-page popup inspector via "Open in Web Inspector".

> **Status:** M7 (v1 end-to-end). All of M0-M6 are merged; this is the final
> integration that wires the SPA shell, runtime CORS handshake, and CLI
> packaging together. Plan: [`.chalk/plans/web-inspector-v1.md`][plan].
>
> [plan]: ../../.chalk/plans/web-inspector-v1.md

---

## Usage

```sh
# Run against the example v1 showcase from anywhere in the repo:
npx @copilotkit/studio --runtime http://localhost:3000

# Or, locally during development:
pnpm exec tsx apps/studio/bin/studio.ts --root examples/v1 --runtime http://localhost:3000
```

A browser tab opens at `http://localhost:4123/?runtime=<your-runtime>` with:

- The left rail listing every detected `useCopilotAction` / `useRenderTool`
  call site in your project.
- A center sandbox iframe rendering the selected tool against your running
  app via `?__cpk_sandbox=<tool>&args=<base64-json>`.
- A right panel with a parameter form (editable per-tool) plus a `*.fixture.json`
  preset chip strip.
- A bottom timeline drawer (`Cmd+J` to toggle) streaming the runtime's
  `/cpk-debug-events` invocations live.

The launcher's WebSocket and the runtime SSE are independent — discovery
works even without your dev server running; the live timeline lights up when
your app is reachable.

### CLI flags

| Flag              | Default                                   | What it does                                                                                                                                            |
| ----------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--root <path>`   | walk-up `package.json` w/ `@copilotkit/*` | Project to scan.                                                                                                                                        |
| `--port <number>` | `4123`                                    | Launcher port. If 4123 is busy, the launcher tries the next free port — the popup handoff hardcodes 4123 though, so free it up for the in-app shortcut. |
| `--runtime <url>` | (none — set in the header)                | Preselect `?runtime=...` in the SPA so the timeline + sandbox iframe wire up immediately.                                                               |
| `--no-open`       | (auto-opens browser)                      | Skip the browser open.                                                                                                                                  |
| `-h`, `--help`    |                                           | Show usage.                                                                                                                                             |

---

## What works in v1

- **Discovery** — AST-based scanner (`oxc-parser`) finds every
  `useCopilotAction`, `useRenderTool`, `useRenderToolCall`,
  `useDefaultRenderTool`, and `useFrontendTool` call site. Schema extraction
  for `parameters: [...]` (v1) and Zod `parameters: z.object({...})` (v2)
  with fall-through to opaque JSON for dynamic shapes.
- **Live file watcher** — chokidar with 300 ms debounce; rescan delta is
  broadcast on every save. Identity-hash dedup so format-on-save no-ops don't
  hit the wire.
- **Sandbox iframe** — selects a tool, opens
  `http://<runtime>/?__cpk_sandbox=<name>&args=<base64-json>` in an iframe,
  postMessage handshake for args > 2 KB. Errors inside `render(args)` get a
  dismiss-able overlay.
- **Args form** — descriptor-driven; primitives, enums, objects, arrays, plus
  a JSON editor fallback for opaque types. Persists per-tool across
  selections.
- **Fixture presets** — sibling `*.fixture.json` files are loaded as preset
  chips; one-click apply, inline save-as-preset (writes back through the WS
  → file system).
- **Live timeline** — SSE subscription to `<runtime>/cpk-debug-events`,
  collapsible drawer (`Cmd+J`), filter by selected tool, "↩ Reproduce"
  copies real args into the form + sandbox iframe.
- **Deep-link handoff** — the popup's "Open in Web Inspector" button passes
  `runtime`, `agent`, `thread`, `tool` query params; the SPA restores
  selection on mount.

## Known limitations / deferred to follow-up

- **State-only / handler-only tools** — `useCopilotAction({ handler })`
  without `render`. The scanner sees them; the sandbox skips them. Tracked
  in [.chalk/issues/state-only-tools-support.md][issue-state-only].
- **A2UI / generative UI** — separate sandbox surface, deferred. Tracked in
  [.chalk/issues/a2ui-support.md][issue-a2ui].
- **MCP tools** — out of scope for v1.
- **Multi-user / hosted** — local-only; no CopilotCloud dependency.

[issue-state-only]: ../../.chalk/issues/state-only-tools-support.md
[issue-a2ui]: ../../.chalk/issues/a2ui-support.md

## Troubleshooting

| Symptom                                                  | Fix                                                                                                                                                                                          |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Popup "Open in Web Inspector" → `ERR_CONNECTION_REFUSED` | The launcher isn't running. Start it: `npx @copilotkit/studio --runtime http://localhost:3000`. The popup's companion "Copy command" affordance drops that exact line into your clipboard.   |
| Components rail is empty                                 | The scanner couldn't find a CopilotKit project. Pass `--root <path>` explicitly. The launcher prints the detected root on startup; check that it's pointing where you expect.                |
| Timeline shows "no runtime connected" forever            | Either you haven't set the runtime URL (header input or `--runtime`), or the runtime isn't serving `/cpk-debug-events`. Open `<runtime>/cpk-debug-events` in a tab to confirm.               |
| Timeline empty even though the runtime is up             | The runtime needs CORS on `/cpk-debug-events`. The v2 runtime in this repo emits the right headers in dev mode; older runtimes may need an update.                                           |
| Sandbox iframe is blank                                  | Your app must be running on the runtime URL (the iframe loads `<runtime>/?__cpk_sandbox=...`). Render errors inside `render()` surface as a dismiss-able overlay rather than a blank iframe. |
| `Port 4123 was in use — falling back to 4124`            | Another launcher is running. Stop it and restart, or accept the fallback port (note: the popup handoff is hardcoded to 4123 — free that up to get one-click handoff working).                |

---

## Smoke test

Boot a CopilotKit app on `localhost:3000` (any v1 showcase with `useCopilotAction({ render })` works — e.g.
`examples/v1/research-canvas`). Then:

```sh
pnpm exec tsx apps/studio/bin/studio.ts --root examples/v1 --runtime http://localhost:3000
```

Expected output:

```
[studio] Detected project root: …/examples/v1
[studio] Listening on http://localhost:4123
[studio] Scanning …/examples/v1 ...
[studio] Scan complete: 42 tools across 301 files.
[studio] Watching …/examples/v1 for changes.

  CopilotKit Studio
  ────────────────────────────────────────────
  URL:     http://localhost:4123/?runtime=http%3A%2F%2Flocalhost%3A3000
  Root:    …/examples/v1
  Runtime: http://localhost:3000
```

In the browser:

1. Components rail populates with every detected tool.
2. Click a render-bearing tool → center pane iframes the tool against your
   running app.
3. Edit a parameter on the right → iframe re-renders.
4. Drop a `*.fixture.json` next to the source file → preset chip appears.
5. Trigger a chat interaction in your app → the bottom timeline drawer
   streams invocations live (`Cmd+J` to expand).

### Useful targets

| Target                        | Why                                                |
| ----------------------------- | -------------------------------------------------- |
| `examples/v1`                 | ~42 v1-style `useCopilotAction` sites.             |
| `examples/v1/research-canvas` | Real render-bearing tool (`DeleteResources`).      |
| `examples/v2/react/demo`      | v2 `useFrontendTool` + Zod schemas across 4 sites. |

---

## Nx targets

This is an Nx-managed app. Always invoke targets through `nx`:

```sh
# Run the launcher in dev mode (tsx watch)
nx run @copilotkit/studio:dev -- --root examples/v1

# Build SPA + launcher (+ chmod the bin)
nx run @copilotkit/studio:build

# Typecheck only
nx run @copilotkit/studio:typecheck

# Lint
nx run @copilotkit/studio:lint
```

`nx run-many -t test --projects=packages/**` (the pre-commit gate) is scoped
to `packages/**` and does not include this app. The repo's existing test
hook is therefore unaffected.

---

## Layout

```
apps/studio/
  bin/
    studio.ts                       ← npx entry: arg parsing, port fallback, launcher boot
  src/
    launcher/                       ← Node-side (runs in the npx process)
      index.ts                      ← orchestrator: HTTP + WS + scan + watcher + deltas
      scanner.ts                    ← oxc-parser AST walk → ToolDescriptor[]
      schema-extraction.ts          ← v1 + Zod parameter extraction
      hook-registry.ts
      map-hooks-to-components.ts
      ast-utils.ts
      fixture-loader.ts             ← *.fixture.{json,ts,tsx} → presets map
      file-watcher.ts               ← chokidar wrapper, 300 ms debounce
      project-root.ts               ← walk-up package.json detection
      ws-server.ts                  ← ws://localhost:NNNN/__inspector/ws
      http-server.ts                ← serves built SPA assets + dev placeholder
    spa/                            ← Browser-side (Vite-built)
      index.html
      main.tsx
      App.tsx                       ← M7 integration shell — wires every Wave-2 component
      components/
        sandbox-frame.tsx           ← M3: iframe wrapper + postMessage protocol
        arg-form.tsx                ← M4: descriptor-driven editable form
        fixture-presets.tsx         ← M2: preset chips + save UI
        timeline.tsx                ← M5: bottom drawer + SSE-fed list
      lib/
        sse-client.ts               ← M5: EventSource port of debug-stream.ts
        descriptor-to-form.ts       ← M4: default args from descriptor
    shared/
      types.ts                      ← THE TYPE LOCK — see §7 of the main plan
  package.json                      ← bin: { "cpk-studio": "./dist/bin/studio.js" }
  project.json
  tsconfig.json
  tsconfig.launcher.json
  vite.config.ts
```

The SPA builds to `dist/spa/`; the launcher TS emits to `dist/`. The HTTP
server resolves `dist/spa` at runtime (with fall-back to a dev placeholder
page when the SPA hasn't been built — handy for `tsx` driving the launcher
directly).

---

## Design references

- [.chalk/plans/web-inspector-v1.md](../../.chalk/plans/web-inspector-v1.md)
  — full design. §5 layout, §7 type lock, §8 package layout.
- [.chalk/plans/web-inspector-execution.md](../../.chalk/plans/web-inspector-execution.md)
  — parallel-agent decomposition for M0-M7.
- [.chalk/references/vscode-extension/src/extension/hooks/](../../.chalk/references/vscode-extension/src/extension/hooks/)
  — reference scanner the launcher implementation is ported from.
- [.chalk/references/vscode-extension/src/extension/debug-stream.ts](../../.chalk/references/vscode-extension/src/extension/debug-stream.ts)
  — reference SSE client.
