# AGENTS.md - `@copilotkit/vue` workflow guide

This file defines contributor workflow for keeping `@copilotkit/vue` aligned with upstream `@copilotkit/react`.

## Scope

- Scope is limited to `packages/vue/**`.
- Keep upstream changes outside the Vue package to a minimum until the Vue port is merged.

## Parity source of truth

- React remains the canonical behavioral reference: `packages/react-core/`, `packages/react-ui/`, and `packages/react-textarea/`.
- Use [PARITY.md](./PARITY.md) as the canonical Vue-side parity policy, architectural translation guide, strict test-port rulebook, and living React-to-Vue implementation/test matrix.
- Keep [README.md](./README.md) focused on user-facing package documentation.

## Required parity workflow

When porting a React feature:

1. Identify impacted React implementation and tests.
2. Classify whether the feature is near-100% translatable using [PARITY.md](./PARITY.md).
3. If it is near-100% translatable, mirror the React suite/file structure and keep matching `describe` and `it` text word-for-word for the mirrored cases.
4. If API divergence seems necessary or likely, discuss it with the user before introducing a Vue-specific translation.
5. Implement Vue behavior in `packages/vue/src/**`.
6. Add or update equivalent Vue tests with parity-friendly discoverability.
7. Update the relevant matrix rows in [PARITY.md](./PARITY.md) in the same change.
8. Document intentional divergences in [PARITY.md](./PARITY.md).
9. Do not add fallback or shallower test paths to force green status for near-100% parity suites; keep strict parity boundary and let failures be explicit.
10. For strict parity/e2e suites, follow [PARITY.md](./PARITY.md) test conventions: Testing Library-first query style, no `wrapper.get(...)`-first ports, and no unnecessary `h(...)` render-function harnesses.
11. If Vue-only coverage is needed in a strict parity file, keep all React-mirrored cases first with word-for-word naming, then place Vue-only cases in a separate trailing `describe(...)` block labeled as Vue-specific semantics.
12. Keep slots as the primary Vue customization model. `renderCustomMessages` is the approved secondary provider-level parity surface for ordered and agent-scoped custom message registration; do not invent alternative provider-slot registration APIs.
13. Do not port React `StrictMode` identity assertions literally into Vue by adding runtime remount caches/workarounds; validate Vue lifecycle invariants under rerender/remount instead.

## Validation gates

Run after meaningful changes:

1. `pnpm nx run @copilotkit/vue:lint`
2. `pnpm nx run @copilotkit/vue:check-types`
3. `pnpm nx run @copilotkit/vue:test`

When touching integration/build behavior:

1. `pnpm nx run @copilotkit/vue:build`

## Documentation placement

- Parity rules, architectural translation decisions, strict translatability criteria, checklist, and mapping matrix: [PARITY.md](./PARITY.md).
- Public package usage and API examples: [README.md](./README.md).
- User-facing visual docs/examples: `examples/v2/vue/storybook/**`.
