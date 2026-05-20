# CopilotKit Suggestions (React)

This skill builds on `copilotkit/provider-setup` and
`copilotkit/chat-components`. Suggestions render via
`CopilotChatSuggestionView` which `<CopilotChat>` mounts automatically.

Two sides:

- `useConfigureSuggestions(config, deps?)` — register dynamic (LLM) or
  static suggestions.
- `useSuggestions({ agentId })` — read current suggestions + trigger
  reload / clear.

## Setup

### Dynamic suggestions (LLM-generated)

```tsx
"use client";
import { useConfigureSuggestions } from "@copilotkit/react-core/v2";
import { useMemo } from "react";

export function DynamicSuggestionsHost({ page }: { page: string }) {
  const instructions = useMemo(
    () => `Suggest 3 follow-up questions about the "${page}" page.`,
    [page],
  );

  useConfigureSuggestions(
    {
      instructions,
      minSuggestions: 2,
      maxSuggestions: 4,
      available: "always",
    },
    [page],
  );

  return null;
}
```

### Static suggestions

```tsx
"use client";
import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

export function StaticStarters() {
  useConfigureSuggestions({
    suggestions: [
      { title: "Summarize this page", message: "Summarize the current page." },
      { title: "Explain like I'm 5", message: "Explain this in simple terms." },
    ],
    available: "before-first-message",
  });
  return null;
}
```

## Core Patterns

### Read and refresh suggestions from any component

```tsx
import { useSuggestions } from "@copilotkit/react-core/v2";

export function RefreshButton() {
  const { suggestions, reloadSuggestions, clearSuggestions, isLoading } =
    useSuggestions({ agentId: "default" });
  return (
    <div>
      <button onClick={reloadSuggestions} disabled={isLoading}>
        {isLoading ? "Loading…" : "Refresh"}
      </button>
      <button onClick={clearSuggestions}>Clear</button>
      <span>{suggestions.length} suggestions</span>
    </div>
  );
}
```

### Feature-flag the suggestions config

```tsx
const enabled = useFeatureFlag("suggestions");
useConfigureSuggestions(
  enabled ? { instructions: "Suggest 3 follow-ups" } : null,
);
```

### Agent-scoped dynamic suggestions

```tsx
useConfigureSuggestions({
  instructions: "Suggest follow-ups for the research agent.",
  consumerAgentId: "research",
});
```

## Common Mistakes

### MEDIUM — Using `available: "disabled"` expecting reload to still fire

Wrong:

```tsx
useConfigureSuggestions({
  instructions: "Suggest 3 follow-ups",
  available: "disabled",
});
// Then calling reloadSuggestions() — no-op
```

Correct:

```tsx
const enabled = useFeatureFlag("suggestions");
useConfigureSuggestions(
  enabled ? { instructions: "Suggest 3 follow-ups" } : null,
);
```

`available: "disabled"` is normalized to a `null` config — the same as
passing `null`/`undefined`. Reloads become no-ops. Pass `null` (or gate on
a condition) when you want to fully disable suggestions.

Source: `packages/react-core/src/v2/hooks/use-configure-suggestions.tsx:59-62`

### MEDIUM — Inline config object without `deps`

Wrong:

```tsx
useConfigureSuggestions({ instructions: `about ${currentPage}` });
// Config re-serialized every render — reload may or may not fire depending on cache equality
```

Correct:

```tsx
useConfigureSuggestions({ instructions: `about ${currentPage}` }, [
  currentPage,
]);
```

`useConfigureSuggestions` uses a serialized-config cache keyed off the
JSON-stringified value. Without `deps`, React invariance + inline objects
produce unstable identities that thrash the cache. Always pass `deps` that
cover the values interpolated into the config.

Source: `packages/react-core/src/v2/hooks/use-configure-suggestions.tsx:166-171`

### MEDIUM — Calling `reloadSuggestions` mid-run

Wrong:

```tsx
<button onClick={() => reloadSuggestions()}>Refresh</button>
// Fires during agent streaming → competes with the running agent
```

Correct:

```tsx
import { useAgent, UseAgentUpdate } from "@copilotkit/react-core/v2";

const { agent } = useAgent({
  agentId: "default",
  updates: [UseAgentUpdate.OnRunStatusChanged],
});
const isRunning = agent.isRunning;
<button
  disabled={isRunning}
  onClick={() => {
    if (!isRunning) reloadSuggestions();
  }}
>
  Refresh
</button>;
```

The internal auto-reload skips when `isRunning`, but the user-triggered
`reloadSuggestions()` does not guard itself. Guard the caller, or the
suggestion generation races the active agent run.

Source: `packages/react-core/src/v2/hooks/use-configure-suggestions.tsx:121-124`

### MEDIUM — Expecting `maxSuggestions` above 3 without setting it

Wrong:

```tsx
useConfigureSuggestions({ instructions: "…" });
// Then surprised the UI only shows 3 pills even when the LLM returned 8
```

Correct:

```tsx
useConfigureSuggestions({
  instructions: "…",
  minSuggestions: 1,
  maxSuggestions: 6,
});
```

`minSuggestions` and `maxSuggestions` default to 1 and 3 respectively. Set
them explicitly when you want a different count.

Source: `packages/core/src/types.ts` (DynamicSuggestionsConfig defaults)
