# CopilotKit Client-Side Tools (React)

This skill builds on `copilotkit/provider-setup`. Tools registered via
`useFrontendTool` execute in the browser and are exposed to the agent over
AG-UI.

Hook signature:

```ts
useFrontendTool<T>(tool: ReactFrontendTool<T>, deps?: ReadonlyArray<unknown>);
```

The hook re-registers when `tool.name`, `tool.available`, or any entry in
`deps` changes. Closures inside `handler` capture React state at
registration time — pass `deps` when the handler references state.

## UI-kit detection rule

Before writing any `render` JSX, check the consumer's `package.json` for a
UI kit and reuse its primitives:

- `components/ui/*` (shadcn)
- `@mui/material` (MUI)
- `@chakra-ui/react` (Chakra)
- `antd` (Ant Design)
- `@mantine/core` (Mantine)

Only write raw JSX if no kit is present.

## Setup

```tsx
"use client";
import { useFrontendTool } from "@copilotkit/react-core/v2";
import { z } from "zod";

export function SearchToolHost() {
  useFrontendTool({
    name: "searchDocs",
    description: "Search the in-app documentation",
    parameters: z.object({ query: z.string() }),
    handler: async ({ query }, { signal }) => {
      const r = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
        signal,
      });
      return (await r.json()).results.join("\n");
    },
  });
  return null;
}
```

`zod` is a hard peer dependency — install it alongside `@copilotkit/react-core`.

## Core Patterns

### Handler with React state + deps

```tsx
const [cart, setCart] = useState<string[]>([]);

useFrontendTool(
  {
    name: "addItem",
    parameters: z.object({ id: z.string() }),
    handler: async ({ id }) => {
      setCart((c) => [...c, id]);
    },
  },
  [setCart],
);
```

### Forward `signal` into fetch (so `stopAgent` cancels in-flight calls)

```tsx
useFrontendTool({
  name: "search",
  parameters: z.object({ q: z.string() }),
  handler: async ({ q }, { signal }) => {
    const r = await fetch(`/search?q=${q}`, { signal });
    return r.text();
  },
});
```

### Render progress UI for a tool (reuse the consumer's UI kit)

```tsx
// Consumer has shadcn → use Card + Skeleton
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

useFrontendTool({
  name: "show",
  parameters: z.object({ id: z.string() }),
  handler: async ({ id }) => fetchItem(id),
  render: ({ status, parameters, result }) => (
    <Card>
      {status === "inProgress" ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <CardContent>{result}</CardContent>
      )}
    </Card>
  ),
});
```

### Programmatic invocation with string follow-up

`copilotkit.runTool` accepts `followUp: boolean | "generate" | string`.
A string is injected as a synthetic user message before the agent runs.

```tsx
import { useCopilotKit } from "@copilotkit/react-core/v2";

const { copilotkit } = useCopilotKit();

await copilotkit.runTool({
  name: "searchDocs",
  parameters: { query: "zod" },
  followUp: "Summarize these results in 3 bullets", // inject as user message, run agent
});
```

## Common Mistakes

### CRITICAL — Writing JSX from scratch for `render` when the app has a UI kit

Wrong:

```tsx
useFrontendTool({
  name: "show",
  parameters: z.object({ id: z.string() }),
  handler,
  render: ({ status }) => <div style={{ padding: 12 }}>…</div>,
});
```

Correct:

```tsx
// First check package.json for shadcn / @mui/* / @chakra-ui/* / antd / @mantine/*, then:
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

useFrontendTool({
  name: "show",
  parameters: z.object({ id: z.string() }),
  handler,
  render: ({ status, result }) => (
    <Card>
      {status === "inProgress" ? (
        <Skeleton />
      ) : (
        <CardContent>{result}</CardContent>
      )}
    </Card>
  ),
});
```

Consumers almost always have a UI kit. Raw JSX produces unbranded output
and skips the accessibility patterns their existing primitives encode.

Source: maintainer interview (Phase 2c)

### HIGH — Stale closure inside `handler`

Wrong:

```tsx
useFrontendTool({
  name: "addItem",
  parameters: z.object({ id: z.string() }),
  handler: async ({ id }) => {
    addTo(cart, id); // `cart` is captured at registration — goes stale
  },
});
```

Correct:

```tsx
useFrontendTool(
  {
    name: "addItem",
    parameters: z.object({ id: z.string() }),
    handler: async ({ id }) => {
      addTo(cart, id);
    },
  },
  [cart],
);
```

`useFrontendTool` only re-registers when `name`, `available`, or `deps`
change. Without `deps`, closures over React state freeze at first mount.

Source: `packages/react-core/src/v2/hooks/use-frontend-tool.tsx:45`

### HIGH — Ignoring `signal` in async handlers

Wrong:

```tsx
useFrontendTool({
  name: "search",
  parameters: z.object({ q: z.string() }),
  handler: async ({ q }) => (await fetch(`/search?q=${q}`)).text(),
});
```

Correct:

```tsx
useFrontendTool({
  name: "search",
  parameters: z.object({ q: z.string() }),
  handler: async ({ q }, { signal }) =>
    (await fetch(`/search?q=${q}`, { signal })).text(),
});
```

`stopAgent` / `agent.abortRun` abort via `AbortSignal`. A handler that
doesn't forward `signal` keeps fetching after cancel, racing the next turn.

Source: `packages/core/src/types.ts:24-30`

### HIGH — Assuming `followUp` defaults to `false`

Wrong:

```tsx
useFrontendTool({
  name: "logAnalyticsEvent",
  parameters: z.object({ name: z.string() }),
  handler: async ({ name }) => {
    analytics.track(name);
  },
  // followUp omitted → defaults to TRUE. Agent re-runs after every analytics call.
});
```

Correct:

```tsx
useFrontendTool({
  name: "logAnalyticsEvent",
  parameters: z.object({ name: z.string() }),
  handler: async ({ name }) => {
    analytics.track(name);
  },
  followUp: false, // side-effect tool — don't re-invoke the agent
});
```

For agent-invoked tools, run-handler checks `tool?.followUp !== false` — so
`undefined` AND `true` both fire a follow-up `runAgent`. Only explicit
`false` suppresses it. Pure side-effect tools must opt out or they loop.

Source: `packages/core/src/core/run-handler.ts:607`

### HIGH — Missing `zod` peer dependency

Wrong:

```bash
pnpm install @copilotkit/react-core
# zod missing — CopilotKitProvider fails to load
```

Correct:

```bash
pnpm install @copilotkit/react-core zod
```

`zod` is a hard peer of `@copilotkit/react-core` and is imported at
provider module scope. Without it the provider module throws on load.

Source: `packages/react-core/package.json` (peerDependencies)

### MEDIUM — Duplicate tool name across hooks

Wrong:

```tsx
// ComponentA
useFrontendTool({ name: "save", parameters, handler: saveA });
// ComponentB mounted in same tree:
useFrontendTool({ name: "save", parameters, handler: saveB });
// console.warn: "Tool 'save' already exists … Overriding"
```

Correct:

```tsx
useFrontendTool({
  name: "save",
  agentId: "research",
  parameters,
  handler: saveA,
});
useFrontendTool({
  name: "save",
  agentId: "coding",
  parameters,
  handler: saveB,
});
```

Tool names must be globally unique per `agentId`. Second mount warns and
replaces the first. Scope with `agentId` when multiple agents need their
own "save" handler.

Source: `packages/react-core/src/v2/hooks/use-frontend-tool.tsx:17-22`

### MEDIUM — Passing `"generate"` or a string to `useFrontendTool`'s `followUp`

Wrong:

```tsx
useFrontendTool({
  name: "searchDocs",
  parameters: z.object({ q: z.string() }),
  handler,
  followUp: "Summarize these results" as any, // silently truthy on registered tools
});
```

Correct:

```tsx
// Registered tools — boolean only:
useFrontendTool({
  name: "searchDocs",
  parameters: z.object({ q: z.string() }),
  handler,
  followUp: true,
});

// For string follow-ups, call runTool programmatically:
const { copilotkit } = useCopilotKit();
await copilotkit.runTool({
  name: "searchDocs",
  parameters: { q: "zod" },
  followUp: "Summarize these results", // injects user message, runs agent
});
```

`FrontendTool.followUp` is typed `boolean`. Strings are silently truthy
(treated as `true`). The `"generate"` and custom-string modes only work
on `copilotkit.runTool({ followUp })`.

Source: `packages/core/src/types.ts:39`; `packages/core/src/core/run-handler.ts:47,763,848-863`
