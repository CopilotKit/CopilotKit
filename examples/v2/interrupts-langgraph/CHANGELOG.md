# langgraph-js-starter

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
- Added stable React keys (`index:proverb`) to the proverb list so
  reconciliation doesn't flicker on insert/delete.
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
