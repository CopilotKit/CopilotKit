# AGENTS.md - `@copilotkit/vue` workflow guide

This file defines contributor workflow for `@copilotkit/vue`. The package is a thin Vue adapter over `@copilotkit/core`, and its public API stays aligned with `@copilotkit/react-core`.

## Scope

- Vue bindings, components, and slots live in `packages/vue/**`. Behavior that React, Vue, or Angular share lives in `packages/core/**`. See [Client logic lives in core](../../AGENTS.md#client-logic-lives-in-core).
- The documented integration exceptions are Vue docs and runnable examples under `showcase/**`, plus their registry, generated-catalog, and validation-workflow plumbing described in [Documentation ownership](#documentation-ownership).

## Parity source of truth

- `@copilotkit/core` is the source of the logic. Vue does not copy behavior from React. It calls the same core code that React calls.
- React (`packages/react-core/`) remains the reference for the public API shape: names, props, slots, and hook results.
- Use [PARITY.md](./PARITY.md) as the canonical Vue-side parity policy, architectural translation guide, strict test-port rulebook, and living React-to-Vue implementation/test matrix.
- Keep [README.md](./README.md) as the slim npm-facing package entry point.

## Required parity workflow

When adding a feature or porting one from React:

1. Identify impacted React implementation and tests. If the logic is still in `react-core`, move it into `@copilotkit/core` first, and make React and Vue both use it.
2. Classify whether the feature is near-100% translatable using [PARITY.md](./PARITY.md).
3. If it is near-100% translatable, mirror the React suite/file structure and keep matching `describe` and `it` text word-for-word for the mirrored cases.
4. If API divergence seems necessary or likely, discuss it with the user before introducing a Vue-specific translation.
5. Implement the Vue binding in `packages/vue/src/**`: subscribe to core state, render it, and pass events back to core. Do not add rules, state machines, or side effects in Vue that core can own.
6. Test the behavior in `packages/core`. Add or update Vue tests that check the binding, with parity-friendly discoverability.
7. Update the relevant matrix rows in [PARITY.md](./PARITY.md) in the same change.
8. Document intentional divergences in [PARITY.md](./PARITY.md).
9. Do not add fallback or shallower test paths to force green status for near-100% parity suites; keep strict parity boundary and let failures be explicit.
10. For strict parity/e2e suites, follow [PARITY.md](./PARITY.md) test conventions: Testing Library-first query style, no `wrapper.get(...)`-first ports, and no unnecessary `h(...)` render-function harnesses.
11. If Vue-only coverage is needed in a strict parity file, keep all React-mirrored cases first with word-for-word naming, then place Vue-only cases in a separate trailing `describe(...)` block labeled as Vue-specific semantics.
12. Keep slots as the primary Vue customization model. `renderCustomMessages` is the approved secondary provider-level parity surface for ordered and agent-scoped custom message registration; do not invent alternative provider-slot registration APIs.
13. Do not port React `StrictMode` identity assertions literally into Vue by adding runtime remount caches/workarounds; validate Vue lifecycle invariants under rerender/remount instead.

## Vue reactivity boundary

- Externally supplied payloads that may cross serialization or `structuredClone` boundaries must remain raw; Vue reactive proxies are not clone-safe.
- Treat messages, attachment sources, agent state, forwarded props, runtime properties, interrupt payloads, user callback results, and AG-UI event payloads as agent-bound when they may later be passed to core or emitted through AG-UI.
- When a reactive container must not proxy nested values, prefer `shallowRef()`. Plain `ref()` is fine for UI-only primitives and local UI state. If unsure, add a Vue-specific test that checks `isProxy(value) === false` and `structuredClone(value)` does not throw before the value crosses into core.

## Validation gates

Run after meaningful changes:

1. `pnpm nx run @copilotkit/vue:lint`
2. `pnpm nx run @copilotkit/vue:check-types`
3. `pnpm nx run @copilotkit/vue:test`

When touching integration/build behavior:

1. `pnpm nx run @copilotkit/vue:build`

## Documentation ownership

- Canonical long-form Vue guides and API reference live in `showcase/shell-docs/src/content/`.
- Runnable Vue examples live in `showcase/vue/`; feature coverage is owned by `showcase/shared/frontend-registry.json`, generated frontend catalogs, and Showcase validation workflows. See [PARITY.md](./PARITY.md#package-boundary-and-documentation-placement) for the canonical policy.
- [PARITY.md](./PARITY.md) records parity governance and intentional differences; it is not a duplicate coverage catalog.
