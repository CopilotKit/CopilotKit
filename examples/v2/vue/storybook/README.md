# Vue Storybook

Storybook workspace for `@copilotkit/vue` with strict parity intent against the React storybook.

## Parity policy

- Canonical reference: `examples/v2/react/storybook`.
- Mirror React story structure, naming, and scenario coverage.
- Keep story intent aligned to support visual and behavioral side-by-side checks.
- Keep story scaffolding close to React file/story ownership so changes are easy to diff across frameworks.
- No Vue-only story tracks until React parity is complete.

## How stories are wired

- `.storybook/preview.ts` wraps every story in a real `CopilotKitProvider` backed by an in-memory `StoryAgent` (`stories/support/story-agent.ts`), with the Inspector disabled. Nothing talks to a runtime; chat stories stream canned replies locally. Configure per story with `parameters.copilotkit` (`agent`, `provider`, `threadId`, `isModalDefaultOpen`), or set it to `false` for stories that render their own provider.
- `.storybook/preview.css` plays the host app: shadcn-style tokens on `:root`/`.dark` that match CopilotKit's, so the canvas matches component surfaces in both themes. CopilotKit only emits `cpk:`-prefixed utilities, so host and demo markup in stories uses the plain classes defined there (or story-scoped CSS via `withStyles`), never unprefixed Tailwind.
- `stories/support/` holds the shared fixtures, layouts, `HostPage.vue` mock app, demo tool cards and offline media/microphone helpers.

## Run

```bash
pnpm -C examples/v2/vue/storybook dev
```

## Build check

```bash
pnpm -C examples/v2/vue/storybook build
```
