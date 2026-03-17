# AGENTS.md - `@copilotkitnext/vue` parity guide

This file defines how agents should keep `@copilotkitnext/vue` aligned with upstream `@copilotkitnext/react`.

## Scope and goal

- Scope: `packages/v2/vue/**`.
- Primary goal: preserve **semantic parity** with React for core hooks/providers/types.
- Secondary goal: keep Vue idiomatic where framework mechanics require it, while minimizing public API drift.

## Canonical source of truth

- Treat `packages/v2/react` as the canonical behavioral reference.
- For non-chat core APIs, parity means:
  - same intent,
  - same runtime semantics,
  - same edge-case handling,
  - equivalent test coverage.
- Do not mirror React line-by-line; mirror behavior.

## Package boundary rules

- `@copilotkitnext/vue` follows the same single-package direction as `@copilotkitnext/react`.
- Core hooks/providers/types and UI-facing rendering primitives should live in this package.
- Keep scope aligned with React's package surface; avoid introducing a parallel `vue-ui` package split.
- Vue-specific public documentation should not be added to the shared `docs/` V2 reference unless the repo adopts an explicit Vue section there.
- For the current Vue port, package-level guidance lives in `packages/v2/vue/README.md` and user-facing Vue API/component docs should live in Vue Storybook under `examples/v2/vue/storybook`.

## API compatibility policy

- Keep public API names and shapes as close to React as possible.
- If Vue requires a difference, choose the smallest possible divergence and document it.
- Prefer explicit type exports from `.ts` files and re-export from package barrels.
- Keep provider/hook/type barrels aligned with React export intent.

## Vue-specific translation principles

- Providers:
  - use default slots by default;
  - preserve React provider semantics (inheritance, precedence, defaults).
- Reactivity:
  - prefer safe, explicit reactivity over clever shortcuts;
  - avoid passing Vue reactive proxies into APIs that clone/serialize unless normalized.
- Hook dependencies:
  - use Vue `WatchSource`-based dependencies to mirror React deps behavior.
- Tool rendering:
  - preserve wildcard/specific/agent-scoped semantics from React.
  - keep slots as the primary public customization model;
  - when a programmatic renderer registration path exists, prefer Vue SFC/components over handwritten `h(...)` render functions where both are viable;
  - keep raw render functions mainly for renderer-bridge glue or places where template/SFC conversion is genuinely awkward.
- Chat render parity contract:
  - follow the architectural decision in `packages/v2/vue/README.md` section `Architectural Decision: Render APIs -> Slots`;
  - follow the architectural decision in `packages/v2/vue/README.md` section `Architectural Decision: Render Hooks -> Composable State + Slots`;
  - translate React render props/hooks into Vue named/scoped slots deterministically;
  - for render-oriented React hooks, prefer a Vue composable that owns behavior/state plus slot-based rendering at the chat/component boundary;
  - keep headless/data-oriented React hooks as normal Vue composables;
  - prefer Vue emits for component-level UI interactions and do not expose a duplicated callback prop plus emit for the same public interaction;
  - keep callback functions inside slot payloads for imperative slotted actions;
  - only keep public callback props for true command-style flows that must be awaited by the child (current exception: `CopilotChatView.onFinishTranscribeWithAudio`);
  - do not require Vue consumers to write `h(...)` render functions or TSX for the primary usage path;
  - do not re-introduce provider-level `render*` props in Vue unless the ADR is explicitly changed.

## Testing parity strategy

- Follow an integration-first strategy using real `CopilotKitCore` behavior where practical.
- Maintain parity test coverage for:
  - providers (`CopilotKitProvider`, chat configuration provider),
  - hooks (`useAgent`, `useAgentContext`, `useSuggestions`, `useConfigureSuggestions`, `useFrontendTool`, `useHumanInTheLoop`),
  - type helpers (`defineToolCallRenderer`).
- Keep shared test utilities for agent simulation and provider mounting to reduce drift and duplication.
- Parity requirement is semantic, not snapshot/structure identity.

## Build and dependency alignment

- Keep bundling/externalization intent aligned with React package behavior.
- Keep shared dependency versions aligned with sibling packages (`core`, `react`, `angular`) unless an intentional repo-wide upgrade occurs.
- Avoid introducing dynamic type-import workarounds when a direct typed import pattern used by React is available.
- For web inspector behavior, mirror React's runtime loading strategy and use test-time mocks in Vue tests.
- For icons, import only from `src/components/icons/index.ts` and do not import from `lucide-vue-next` directly in feature components.

## Validation gates (required)

Run all three after meaningful changes:

1. `pnpm -C packages/v2/vue lint`
2. `pnpm -C packages/v2/vue check-types`
3. `pnpm -C packages/v2/vue test`

When touching package integration/build behavior, also run:

- `pnpm -C packages/v2/vue build`
- `pnpm nx run-many -t build --projects=packages/v2/vue`

## Documentation placement

- Do not add Vue-only hook/component pages to `docs/content/docs/reference/v2/**`.
- Keep package usage notes, parity constraints, and architectural decisions in `packages/v2/vue/README.md`.
- When a Vue API needs public-facing documentation or examples, add it to Vue Storybook first.

## Parity update workflow

When React changes:

1. Identify impacted React hooks/providers/types and tests.
2. Apply the README ADRs:
   - `Render APIs -> Slots` for render-prop/render-array surfaces
   - `Render Hooks -> Composable State + Slots` for render-oriented hooks
3. Port behavior to Vue with minimal API drift.
4. Port/add equivalent Vue tests for the changed behavior.
5. Run validation gates.
6. If divergence remains, document the reason and keep it explicit and minimal.
