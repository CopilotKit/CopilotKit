# @copilotkit/studio

A local-only web app for inspecting and iterating on CopilotKit **frontend tool
components** (`useCopilotAction` with `render`). Launched via `npx`; reached
from the existing in-page popup inspector via "Open in Web Inspector".

> **Status:** M1 — real AST scanner + file watcher. Sandbox iframe, fixture
> loading, arg form, SSE timeline, and popup handoff (M2-M6) ship via the
> parallel-agent wave tracked in
> [`.chalk/plans/web-inspector-execution.md`][execution-plan].
>
> [execution-plan]: ../../.chalk/plans/web-inspector-execution.md

---

## What works in M1

- **AST-based scanner** (`src/launcher/scanner.ts`) using
  [`oxc-parser`](https://oxc.rs/). Replaces M0's regex with a real walk
  that handles import aliases, multi-line config objects, and nested object
  shapes.
- **All render-bearing hooks** detected — not just v1 `useCopilotAction`
  (M0) but also v2 `useRenderTool`, `useRenderToolCall`,
  `useDefaultRenderTool`, and `useFrontendTool`.
- **Schema extraction** from the hook's `parameters` argument:
  - v1 array literals (`parameters: [{ name, type, required, attributes,
enum, ... }, ...]`) → fully recursive `ParameterDescriptor[]` with
    object / array nesting.
  - v2 Zod calls (`parameters: z.object({...})`) → recurses through
    `.optional()`, `.nullable()`, `.nullish()`, `.describe(...)`,
    `z.array(<inner>)`, `z.object({...})`, `z.enum([...])`,
    `z.literal("...")`, and primitive leaves (`z.string()`, `z.number()`,
    `z.boolean()`, etc.).
  - Anything else (`buildSchema()`, identifier references, runtime-built
    shapes) collapses to a single `type: "opaque"` parameter — the form
    renderer in M4 drops to a JSON editor for these.
- **Enclosing component lookup** — every `ToolDescriptor` carries the React
  function name that contains the hook call, derived from a sibling AST
  walk. Useful for grouping in the SPA.
- **chokidar file watcher** — 300 ms debounce, identity-hash dedup at the
  delta layer so format-on-save no-op edits don't generate wire noise.
  Watches `**/*.{ts,tsx}` under the project root; excludes `node_modules`,
  `dist`, `.next`, `.turbo`, `.git`, `out`, `coverage`, and the rest of the
  standard skip set.
- **Project-root walk-up** (`src/launcher/project-root.ts`) — `--root` is
  optional now. The CLI walks upward from `cwd` looking for the nearest
  `package.json` with a `@copilotkit/*` dependency. Falls back to a clear
  error + non-zero exit when nothing matches.
- **Registry deltas** over the launcher WS — adds / removes / modifies all
  ride a single `registry.delta` event; the SPA's `applyDelta` reconciles
  state without a full snapshot.
- **`scan.error` events** for files that fail to parse — surface in the SPA
  as a non-fatal banner instead of crashing the scanner.

## What is _not_ in M1 (handed off to later agents)

- Sibling `*.fixture.json` loading (M2).
- Sandbox iframe + `InspectorSandboxHost` (M3 — lives in
  `packages/react-core`).
- Arg form / `descriptor → form` renderer (M4).
- SSE timeline (M5).
- Popup handoff button (M6 — lives in `packages/web-inspector`).
- npm packaging refinement (M7).

---

## Smoke test

Pick a directory containing render-bearing hook call sites. The
`examples/v1/` tree is the easiest target — it has ~42 v1-style hook sites:

```sh
pnpm install

# Explicit root
pnpm exec tsx apps/studio/bin/studio.ts --root examples/v1

# Or walk-up from cwd (anywhere inside the CopilotKit repo or any
# project that depends on @copilotkit/*)
cd examples/v1/state-machine
pnpm exec tsx /path/to/CopilotKit/apps/studio/bin/studio.ts
```

You should see something like:

```
[studio] Listening on http://localhost:4123
[studio] Scanning /abs/path/CopilotKit/examples/v1 ...
[studio] Scan complete: 42 tools across 301 files.
[studio] Watching /abs/path/CopilotKit/examples/v1 for changes.
[studio] Open http://localhost:4123 in your browser.
```

The browser opens to a list of every detected hook call site plus its
source file, line, and the parameter shape extracted from its config.

Edit a `useCopilotAction(...)` in one of the watched files — rename it,
add a parameter, change a description — and the SPA reflects the change
within ~500ms (delta arrives via WebSocket).

### Useful targets

| Target                      | Why                                                |
| --------------------------- | -------------------------------------------------- |
| `examples/v1`               | ~42 v1-style `useCopilotAction` sites.             |
| `examples/v1/state-machine` | Tight, focused subset with 9 tools.                |
| `examples/v2/react/demo`    | v2 `useFrontendTool` + Zod schemas across 4 sites. |

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
hook is therefore unaffected.

---

## Layout

```
apps/studio/
  bin/
    studio.ts                   ← npx entry: arg parsing + walk-up + launcher boot
  src/
    launcher/                   ← Node-side (runs in the npx process)
      index.ts                  ← orchestrator: HTTP + WS + scan + watcher + deltas
      scanner.ts                ← oxc-parser AST walk → ToolDescriptor[]
      schema-extraction.ts      ← v1 + Zod parameter extraction
      hook-registry.ts          ← canonical hook list (port of vscode-extension)
      map-hooks-to-components.ts ← enclosing-component lookup
      ast-utils.ts              ← byte-offset ↔ line/column helpers
      file-watcher.ts           ← chokidar wrapper, 300ms debounce
      project-root.ts           ← walk-up package.json detection
      ws-server.ts              ← ws://localhost:NNNN/__inspector/ws
      http-server.ts            ← serves built SPA assets + dev placeholder
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
- [.chalk/references/vscode-extension/src/extension/hooks/](../../.chalk/references/vscode-extension/src/extension/hooks/)
  — reference scanner the M1 implementation is ported from.
