# AGENTS.md - Vue storybook parity rules

## Scope

- Scope: `examples/v2/vue/storybook/**`.
- Goal: visual and story-structure parity with `examples/v2/react/storybook/**`.

## Source of truth

- Treat React story names, grouping, and scenario intent as canonical.
- Mirror stories one-by-one with equivalent Vue components as they are ported.
- Keep story file ownership close to React so each Vue story maps directly to its React counterpart.

## Parity constraints

- Do not add Vue-only stories, controls, or showcase flows unless React has an equivalent.
- Story titles should stay aligned with React naming to preserve comparison clarity.
- Avoid introducing Vue-only scaffold abstractions that make React↔Vue story diffs harder to follow.

## Implementation guidance

- Start with placeholder/minimal parity stories when a Vue component exists but is incomplete.
- Upgrade each story to full behavior parity as the corresponding Vue primitive lands.
- Prefer stable, deterministic props/data so visual comparisons remain consistent.

## Story Completion Checklist (Blocking)

For each ported user-visible Vue feature, story parity is complete only if all items below are true.

1. There is a Vue story that maps to the corresponding React story intent.
2. Story title/grouping is aligned with React naming.
3. Core interaction states are represented (default, active/loading, error/fallback where applicable).
4. Slot/customization behavior is demonstrated when the feature uses Vue slots.
5. Story data is deterministic and stable for side-by-side React↔Vue comparison.
6. Story build and dev both succeed (`storybook build`, `storybook dev`).

## Validation

Run after meaningful changes:

1. `pnpm -C examples/v2/vue/storybook dev`
2. `pnpm -C examples/v2/vue/storybook build`
