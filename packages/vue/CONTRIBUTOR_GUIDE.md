# Contributor guide: keeping Vue in sync with React

Use this guide when changing `@copilotkit/vue`. It describes how to trace a
React feature into Vue, choose the right kind of translation, and keep behavior,
tests, and documentation aligned. General setup, branching, commits, and PR
guidance live in the [root contributing guide](../../CONTRIBUTING.md).

There is no blanket promise of one-to-one API or test parity. React is the
behavioral reference; Vue should match its behavior with the smallest
Vue-native differences.

## File responsibilities

| File                       | Reader                     | Purpose                                                                                       |
| -------------------------- | -------------------------- | --------------------------------------------------------------------------------------------- |
| [`README.md`](./README.md) | npm users                  | Installation, concise usage, and package-facing examples.                                     |
| `CONTRIBUTOR_GUIDE.md`     | Human contributors         | Practical workflow for keeping Vue aligned with React.                                        |
| [`AGENTS.md`](./AGENTS.md) | Contributors and agents    | Short, required rules for package scope, reactivity, validation, and ownership.               |
| [`PARITY.md`](./PARITY.md) | Contributors and reviewers | Detailed translation policy, test-port rules, intentional divergences, and the living matrix. |

Use this guide for orientation. Use `AGENTS.md` for package constraints and
`PARITY.md` for the rule or matrix row that applies to the feature. Do not copy
those documents' full policy or coverage table here.

## React references and Vue architecture

React is the canonical behavioral reference in:

- `packages/react-core/`
- `packages/react-ui/`
- `packages/react-textarea/`

Vue is one published package, not a parallel `vue-core` plus `vue-ui` split.
Current V2 code is primarily under `packages/vue/src/v2/`. The root
[`src/index.ts`](./src/index.ts) also exposes V1 compatibility wrappers from
`src/hooks/` and `src/components/copilot-provider/`, so check the public barrel
before adding or moving an export. Framework-agnostic behavior comes from
`@copilotkit/core`.

Headless React hooks and providers generally translate to Vue composables,
providers, or types. Render props and render-oriented hooks generally translate
to composable state plus named or scoped slots. Slots are the primary Vue
customization model; approved programmatic renderer APIs cover cases such as
ordered registration or agent scoping.

## Short sync workflow

1. Find the React implementation, public types, dedicated tests, and the matching
   row in [`PARITY.md`](./PARITY.md). Search the canonical package trees and
   `packages/vue/src` by public symbol or component name. A matching filename is
   only a starting point.
2. Read the React tests before writing Vue code. Record the boundary and behavior
   they assert so the Vue counterpart tests the same thing.
3. Classify the feature with the [translation decision tree](./PARITY.md#translation-decision-tree)
   and [near-100% rule](./PARITY.md#near-100-translation-rule). If a new or
   expanded Vue API may be needed, discuss that divergence before implementing it.
4. Implement in the existing Vue source area, keep the relevant barrel exports
   aligned, and add the Vue counterpart at the same behavioral boundary. For
   strict ports, follow the detailed [test translation policy](./PARITY.md#test-translation-policy);
   for slot APIs, follow the [slot-suite policy](./PARITY.md#slot-system-suite-translation-policy).
5. Update the relevant `PARITY.md` matrix row in the same code change. Use
   `matched`, `partial`, or `intentional-divergence` honestly. Add package usage
   notes to `README.md`; route long-form docs and runnable examples to their
   owners below.

## Expected framework differences versus behavior changes

Expected Vue differences include `ref`/`computed`/`watch` instead of React state
and effects, Vue lifecycle hooks, templates instead of JSX, and slots instead of
render props. These are translation mechanics.

Behavioral differences are different precedence or fallback, missing edge-case
handling, changed lifecycle or error semantics, or unsafe reactive proxies at a
clone or serialization boundary. Treat those as parity work, not as an automatic
framework exception. Document intentional differences in [`PARITY.md`](./PARITY.md)
and preserve the package reactivity rules in [`AGENTS.md`](./AGENTS.md).

## Documentation and Showcase ownership

Package README content is concise. CopilotKit guides, API reference, and reusable
snippets belong under [`showcase/shell-docs/src/content/`](../../showcase/shell-docs/src/content/);
the top-level `docs/` path is only a symlink. Follow the repository's
[documentation guidance](../../.claude/docs/documentation.md), including
`docs_mode` and `getDocsFolder()` when framework-owned docs are involved.

For showcase-driven docs, edit source inputs such as manifests, shared/root MDX,
snippets, demos, source regions, or sparse overrides. Do not edit generated
`showcase/shell-docs/src/data/frameworks/` files. Authored framework docs live in
their MDX tree and `meta.json`.

Runnable Vue journeys belong to the [`showcase/vue` host](../../showcase/vue/).
Feature coverage and catalog ownership belong to
[`showcase/shared/frontend-registry.json`](../../showcase/shared/frontend-registry.json)
and the existing Showcase generation and validation workflows. Read
[`showcase/AGENTS.md`](../../showcase/AGENTS.md) before changing a Showcase cell.
The Vue Storybook under [`examples/v2/vue/storybook`](../../examples/v2/vue/storybook)
is useful for component development, but is not the canonical integration or
long-form documentation owner.

## Nx validation

Run package tasks through Nx:

```bash
pnpm nx run @copilotkit/vue:lint
pnpm nx run @copilotkit/vue:check-types
pnpm nx run @copilotkit/vue:test
```

Run the build when changing exports, bundling, CSS, declarations, or integration
behavior:

```bash
pnpm nx run @copilotkit/vue:build
```

If the change includes the Vue Showcase host, use its current targets from the
[host README](../../showcase/vue/README.md): `test`, `build`, and
`consumer-check-types`. If it includes shell-docs, follow its
[validation commands](../../showcase/shell-docs/README.md#validate-changes).
