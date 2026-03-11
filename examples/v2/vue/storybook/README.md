# Vue Storybook

Storybook workspace for `@copilotkitnext/vue` with strict parity intent against the React storybook.

## Parity policy

- Canonical reference: `examples/v2/react/storybook`.
- Mirror React story structure, naming, and scenario coverage.
- Keep story intent aligned to support visual and behavioral side-by-side checks.
- Keep story scaffolding close to React file/story ownership so changes are easy to diff across frameworks.
- No Vue-only story tracks until React parity is complete.

## Current status

- Vue storybook is scaffolded and running.
- Default Storybook starter examples were intentionally removed.
- Copilot-focused stories are in `stories/` and will be filled to full parity incrementally.

## Run

```bash
pnpm -C examples/v2/vue/storybook dev
```

## Build check

```bash
pnpm -C examples/v2/vue/storybook build
```
