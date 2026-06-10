# Contributor Guide — `@copilotkit/vue`

How to work on the Vue package and keep it aligned with React.

## File Responsibilities

| File | Audience | Purpose |
|------|----------|---------|
| `README.md` | npm users | Installation, quickstart, API examples |
| `CONTRIBUTOR_GUIDE.md` | Human contributors | Package workflow, validation, conventions |
| `AGENTS.md` | AI agents | Short entrypoint with hard requirements |
| `PARITY.md` | Both | Detailed parity policy, translation rules, test-port conventions, and the living React-to-Vue matrix |

## Architecture

React is the canonical behavioral reference (`packages/react-core/`, `packages/react-ui/`, `packages/react-textarea/`). Vue mirrors the same feature set within a single package (`packages/vue/`).

Key structural decisions:

- **Slots-first customization**: Named/scoped slots on `CopilotChat` and `CopilotChatMessageView` are the primary rendering extension point. Programmatic renderers (`renderCustomMessages`, `renderToolCalls`) are a secondary API for reuse and agent scoping.
- **Composables over hooks**: Vue composables (`useFrontendTool`, `useAgentContext`, etc.) map 1:1 to React hooks by name and behavior.
- **Single package**: No `vue-ui`/`vue-core` split. Everything lives in `packages/vue/`.

## When to Compare Against React

Always. Before implementing or modifying a feature:

1. Find the React equivalent in `packages/react-core/` or `packages/react-ui/`.
2. Read its tests and behavior.
3. Decide whether the feature is near-100% translatable (same semantics, Vue idioms for rendering) or requires intentional divergence.
4. If divergence is needed, document it in `PARITY.md` before or alongside the implementation.

## When Vue Intentionally Diverges

Vue diverges from React where framework idioms demand it:

- **Slots vs. render props**: React uses render-prop arrays; Vue uses named slots.
- **Reactivity**: Vue uses `ref`/`computed`/`watch` instead of `useState`/`useEffect`/`useMemo`.
- **Lifecycle**: Vue uses `onMounted`/`onBeforeUnmount`; React uses `useEffect` cleanup. Vue validates lifecycle invariants directly rather than relying on `StrictMode` double-mount patterns.
- **Template vs. JSX**: Vue components prefer SFC `<template>` blocks where practical; render functions (`h(...)`) are used for dynamic/programmatic cases.

These are expected and do not need per-case justification. Divergences in **behavior** (precedence, fallback logic, feature scope) require explicit documentation in `PARITY.md`.

## Validation Commands

Run after meaningful changes:

```bash
pnpm nx run @copilotkit/vue:lint        # oxlint
pnpm nx run @copilotkit/vue:check-types # tsc --noEmit
pnpm nx run @copilotkit/vue:test        # vitest
```

When touching build output or exports:

```bash
pnpm nx run @copilotkit/vue:build
```

## Parity Workflow Summary

1. Identify impacted React implementation and tests.
2. Classify translatability per `PARITY.md` decision tree.
3. Mirror React test file structure and `describe`/`it` naming for translatable features.
4. Implement in `packages/vue/src/`.
5. Update the relevant matrix rows in `PARITY.md` in the same commit.
6. Document intentional divergences in `PARITY.md`.

For full rules (strict test-port conventions, naming policies, Vue-only test placement), see [PARITY.md](./PARITY.md).
