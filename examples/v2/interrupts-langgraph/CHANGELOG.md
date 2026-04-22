# langgraph-js-starter

## 0.1.7 — 2026-04-21

### Fixed

- Hardened `emit_unknown_tools_notice` and `intercept_frontend_tools`
  against OpenAI tool_call invariant violations and prior-stash
  clobbering.
- `useCopilotAction` deps on `setThemeColor` and `getWeather`.
- `next lint` removal in Next 16 — replaced with direct ESLint invocation.
- `route.ts` LANGSMITH warn now gates on NODE_ENV like DEPLOYMENT_URL.
- `route.ts` log prefixes distinguish runtime-construction from dispatch
  failures.
- `parseInterruptPayload` single-return-value, caller-owned log.

### Changed

- LICENSE copyright attribution: `2025-2026 CopilotKit` (was: individual).
- README: fixed broken `pnpm --filter` example in troubleshooting;
  replaced inline `echo > .env` with `cp .env.example .env` + edit;
  corrected project-structure diagram comment to reference
  `pnpm-workspace.yaml`.
- `apps/web/tsconfig.json`: dropped dead `.next/dev/types/**` include.
- `apps/web/.env.example`: clarified that LANGSMITH\_\* vars forward to the
  agent.
- Root `.gitignore`: ignore `dist/`.
- `turbo.json`: add `start` task.
- `apps/web/project.json`: `cache: false` on `build` target for Nx parity
  with package.json.
- `apps/agent/tsconfig.json`: set `noEmit: true` so direct `tsc`
  invocation matches script-driven builds.

## 0.1.6 — 2026-04-21

### Changed

- Added `turbo.json` at the starter root so `turbo run dev/build/lint`
  works when the starter is extracted standalone (root scripts delegate
  to turbo; missing config previously broke extraction).
- Added `pnpm-workspace.yaml` so pnpm v9+ reliably links
  `workspace:*` deps on standalone extraction; the `workspaces` array in
  the root `package.json` is not honored by pnpm on its own.
- Bumped the agent `tsconfig.json` `target` from `es2016` to `ES2022`
  (with explicit `lib: ["ES2022"]`, no DOM) to match the declared
  Node 20+ runtime baseline.
- Added `build` and `lint` scripts to `apps/agent/package.json`
  (`tsc -p tsconfig.json --noEmit` — identical to what `project.json`
  declares) so `turbo run build/lint` and nx targets agree.
- Filled in the empty agent `description` and `author` fields.
- Added `LANGSMITH_TRACING=true` (commented) to `apps/web/.env.example`
  to match the agent's `.env.example`.
- Added `"baseUrl": "."` to `apps/web/tsconfig.json` so the `@/*` path
  alias resolves reliably across IDEs and tooling.
- Removed Python-specific entries (`venv/`, `__pycache__/`, `*.pyc`)
  from `apps/agent/.gitignore` — leftovers from a forked Python
  LangGraph starter; this is a TypeScript project.
- Added a copyright year to `LICENSE` (MIT convention requires one).

### Versioning

- Root, `apps/agent`, and `apps/web` all bumped from `0.1.5` to `0.1.6`
  in lockstep per the starter's shared-version convention.

## 0.1.5 — 2026-04-17

### Renamed

- Renamed directory from `interrupts-langraph` to `interrupts-langgraph`
  (spelling fix). The rename itself is code-neutral; hardening described
  below.

### Changed

- Tightened types in the agent graph (no `as any`, structural message
  narrowing) and added an explicit `bindTools` capability guard.
- `shouldContinue` now evaluates ALL tool calls on an AIMessage and
  routes to `tool_node` whenever ANY call targets a registered backend
  tool. Previously a mixed batch (frontend action + backend tool) could
  silently drop the backend call. Each unknown tool-call name emits its
  own `console.warn`; routing then keeps the batch on `tool_node` when
  any known backend tool is present (ToolNode will emit an error
  ToolMessage for unknown tool names; the graph then loops back to
  `chat_node` with that error in context) and falls through to `END`
  otherwise.
- Validated the interrupt payload on the web side via
  `parseInterruptPayload`; malformed payloads now render a cancellation
  fallback instead of crashing the renderer. Arrays are explicitly
  rejected (previously passed the `typeof === "object"` check and were
  coerced to the `Record` lookup path).
- Validated the resumed interrupt value on the agent side via a zod
  schema (`ApprovalResumeSchema`); an out-of-band Client resuming with
  the wrong shape now fails loudly at the tool boundary instead of
  silently branching to "cancelled".
- `deleteProverb` on the web side now uses a functional `setState`
  updater so concurrent state writes don't race.
- React key for the proverb list is `${index}-${proverb}` (index + content
  composite). Chosen because plain `proverb` collides on duplicates and
  plain `index` destabilizes rows during agent-driven inserts. Migrating
  the underlying state to `{id, text}` objects is the proper long-term
  fix and is deferred.
- Removed the unused `starterAgent` alias; extracted the model name
  to a `MODEL` constant for single-point swaps.
- Wrapped `handleRequest` with a structured error response in the web
  runtime route (`apps/web/src/app/api/copilotkit/route.ts`), so
  unhandled exceptions surface as a structured 500 JSON response rather
  than the raw Next.js error page.
- Corrected port references in the README (8125 everywhere).
- Replaced the placeholder Next metadata with a real title/description.

### Dependencies

- `@types/node` ^20 → ^22.19.11
- `typescript` ^5 → ^5.9.3
- `zod` ^3.24.4 → ^3.25.76
- Agent `@langchain/langgraph` → `1.1.5` (previously pinned via a root
  `overrides` entry at `1.0.2`; the override has been removed and the
  version is now declared directly on `apps/agent/package.json`).
- Agent `@langchain/core` → `^1.1.26`.
- Dropped the dead `@langchain/core` override from the starter root; it
  had no effect inside the monorepo pnpm workspace and would cap the
  agent's `^1.1.26` requirement if the starter were extracted.
- Removed root `overrides` entry for `@langchain/langgraph` (was `1.0.2`);
  the agent owns its own version now.

### Versioning

- Sub-app versions synced to the root: `apps/agent` `0.0.1` → `0.1.5` and
  `apps/web` `0.1.0` → `0.1.5`. Convention: sub-app versions track the
  root starter version so changelog entries and `package.json` reads
  stay consistent across the workspace.

## 0.1.1 – 0.1.4

Internal only (dependency sync / tooling bumps).
