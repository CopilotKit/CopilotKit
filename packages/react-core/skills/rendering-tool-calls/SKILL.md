---
name: rendering-tool-calls
description: >
  Register per-tool renderers via useRenderTool (primary), useComponent
  (render-only tool), useDefaultRenderTool (sanctioned wildcard fallback).
  useRenderToolCall is a resolver — NOT a registration hook. Status values
  are camelCase 'inProgress' | 'executing' | 'complete'. InProgress
  parameters are Partial<T>. Same UI-kit-detection rule as client-side-tools.
  Load when showing progress UI, result cards, or a generic card for any
  tool the agent calls.
type: framework
framework: react
library: copilotkit
library_version: "1.56.2"
requires:
  - copilotkit/provider-setup
  - copilotkit/client-side-tools
sources:
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/hooks/use-render-tool.tsx"
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/hooks/use-render-tool-call.tsx"
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/hooks/use-default-render-tool.tsx"
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/hooks/use-component.tsx"
---

# CopilotKit Rendering Tool Calls (React)

This skill builds on `copilotkit/provider-setup` and
`copilotkit/client-side-tools`.

Four hooks, distinct roles:

| Hook                   | Role                                                              |
| ---------------------- | ----------------------------------------------------------------- |
| `useRenderTool`        | Primary registration hook for a named tool's progress/result UI   |
| `useComponent`         | Register a NEW render-only tool (agent calls it just to render)   |
| `useDefaultRenderTool` | Sanctioned wildcard fallback for tools without a dedicated render |
| `useRenderToolCall`    | Resolver — returns a function. For custom chat surfaces only      |

Status is camelCase: `"inProgress" | "executing" | "complete"`. The
`RenderToolProps` discriminated union narrows `parameters` per state.

## UI-kit detection rule

Before writing raw JSX, check the consumer's `package.json` for shadcn /
MUI / Chakra / Ant / Mantine and reuse those primitives.

## Setup

```tsx
"use client";
import { useRenderTool } from "@copilotkit/react-core/v2";
import { z } from "zod";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function SearchRenderer() {
  useRenderTool({
    name: "searchDocs",
    parameters: z.object({ query: z.string() }),
    render: ({ status, parameters, result }) => {
      if (status === "inProgress") return <Skeleton className="h-16 w-full" />;
      if (status === "executing") {
        return (
          <Card>
            <CardContent>Searching "{parameters.query}"…</CardContent>
          </Card>
        );
      }
      return (
        <Card>
          <CardContent>{result}</CardContent>
        </Card>
      );
    },
  });
  return null;
}
```

## Core Patterns

### Wildcard fallback with the built-in card

```tsx
import { useDefaultRenderTool } from "@copilotkit/react-core/v2";

useDefaultRenderTool(); // renders the built-in expandable tool-call card
```

### Custom wildcard fallback

```tsx
import { useDefaultRenderTool } from "@copilotkit/react-core/v2";

useDefaultRenderTool({
  render: ({ name, status, parameters, result }) => {
    // parameters is unknown — narrow by tool name
    if (name === "search") {
      const args = parameters as { q: string };
      return <SearchCard q={args.q} status={status} result={result} />;
    }
    return <GenericCard name={name} status={status} />;
  },
});
```

### Render-only tool (the agent's only reason to call it is to render)

```tsx
import { useComponent } from "@copilotkit/react-core/v2";
import { z } from "zod";

useComponent({
  name: "productCard",
  parameters: z.object({ productId: z.string() }),
  render: ({ productId }) => <ProductCard id={productId} />,
});
// `useComponent` registers a NEW tool called "productCard".
// The agent calls it to render; there is no handler to run.
```

### Custom chat surface (resolver hook)

`useRenderToolCall` is for building your own message list, NOT for
registering renderers.

```tsx
import { useRenderToolCall } from "@copilotkit/react-core/v2";
import { useAgent } from "@copilotkit/react-core/v2";

export function CustomToolList() {
  const { agent } = useAgent({ agentId: "default" });
  const renderToolCall = useRenderToolCall();

  const toolCalls = agent.messages.flatMap((m) =>
    "toolCalls" in m ? (m.toolCalls ?? []) : [],
  );

  return (
    <>
      {toolCalls.map((tc) => (
        <div key={tc.id}>{renderToolCall({ toolCall: tc })}</div>
      ))}
    </>
  );
}
```

## Common Mistakes

### CRITICAL — Using `useRenderToolCall` for registration

Wrong:

```tsx
useRenderToolCall({
  name: "search",
  args: z.object({ q: z.string() }),
  render: ({ status, args }) => <Card>…</Card>,
});
```

Correct:

```tsx
useRenderTool({
  name: "search",
  parameters: z.object({ q: z.string() }),
  render: ({ status, parameters }) => <Card>…</Card>,
});
```

`useRenderToolCall` takes no arguments — it returns a resolver function for
custom chat surfaces. Passing config to it does nothing. `useRenderTool` is
the registration hook.

Source: `packages/react-core/src/v2/hooks/index.ts:2,7`;
`packages/react-core/src/v2/hooks/use-render-tool.tsx:37-40`

### CRITICAL — Using hyphenated `"in-progress"` status

Wrong:

```tsx
render: ({ status, parameters, result }) => {
  if (status === "in-progress") return <Spinner />;
  if (status === "executing") return <RunningCard args={parameters} />;
  return <ResultCard result={result} />;
};
```

Correct:

```tsx
render: ({ status, parameters, result }) => {
  if (status === "inProgress") return <Spinner />;
  if (status === "executing") return <RunningCard args={parameters} />;
  return <ResultCard result={result} />;
};
```

Real status values are camelCase: `"inProgress" | "executing" | "complete"`.
Hyphenated branches never match — users see no progress UI and the fallback
path fires.

Source: `packages/react-core/src/v2/hooks/use-render-tool.tsx:8-35`

### CRITICAL — Writing JSX from scratch when the app has a UI kit

Wrong:

```tsx
useRenderTool({
  name: "search",
  parameters: z.object({ q: z.string() }),
  render: () => <div className="my-badge">…</div>,
});
```

Correct:

```tsx
import { Badge } from "@/components/ui/badge";

useRenderTool({
  name: "search",
  parameters: z.object({ q: z.string() }),
  render: () => <Badge variant="secondary">…</Badge>,
});
```

Check consumer `package.json` for shadcn / MUI / Chakra / Ant / Mantine
first. Raw JSX ignores their design system.

Source: maintainer interview (Phase 2c)

### HIGH — Dereferencing required fields from `Partial<T>` during `inProgress`

Wrong:

```tsx
render: ({ status, parameters }) => (
  <span>{parameters.user.id.toUpperCase()}</span>
);
// `parameters` is Partial<T> during inProgress — `parameters.user` may be undefined.
```

Correct:

```tsx
render: ({ status, parameters }) =>
  status === "inProgress" ? (
    <Skeleton />
  ) : (
    <span>{parameters.user.id.toUpperCase()}</span>
  );
```

During streaming, `RenderToolInProgressProps` has
`parameters: Partial<InferSchemaOutput<S>>`. Fields are `undefined` until
the stream completes. Narrow with `status === "inProgress"` first.

Source: `packages/react-core/src/v2/hooks/use-render-tool.tsx:8-14`

### HIGH — Using `useComponent` to decorate an existing tool

Wrong:

```tsx
useFrontendTool({ name: "search", parameters, handler });
useComponent({
  name: "search", // creates a SECOND tool named "search" — collision
  parameters: z.object({ q: z.string() }),
  render: ({ q }) => <SearchCard q={q} />,
});
```

Correct:

```tsx
useFrontendTool({ name: "search", parameters, handler });
useRenderTool({
  name: "search",
  parameters: z.object({ q: z.string() }),
  render: ({ status, parameters, result }) => {
    if (status === "inProgress") return <Skeleton />;
    if (status === "executing") return <div>Searching {parameters.q}…</div>;
    return <div>{result}</div>;
  },
});

// useComponent is only for render-only tools the agent invokes:
useComponent({
  name: "productCard",
  parameters: z.object({ productId: z.string() }),
  render: ({ productId }) => <ProductCard id={productId} />,
});
```

`useComponent` synthesizes a NEW tool whose only job is to render —
description is auto-prefixed with "Use this tool to display the …
component". It does NOT decorate an existing tool. The misleading name
trap: agents read "useComponent" as "register a component for this tool"
and end up with two tools colliding on the same name.

Source: `packages/react-core/src/v2/hooks/use-component.tsx:59-88`

### HIGH — Hand-rolling `useRenderTool({ name: "*" })` instead of `useDefaultRenderTool`

Wrong:

```tsx
useRenderTool({
  name: "*",
  render: ({ parameters }) => <pre>{JSON.stringify(parameters)}</pre>,
});
```

Correct:

```tsx
// Use the built-in default card:
useDefaultRenderTool();

// Or customize, with the correct DefaultRenderProps typing (parameters: unknown):
useDefaultRenderTool({
  render: ({ name, status, parameters, result }) => {
    if (name === "search") {
      const args = parameters as { q: string };
      return <SearchCard q={args.q} status={status} />;
    }
    return <GenericCard name={name} status={status} />;
  },
});
```

The sanctioned wildcard API is `useDefaultRenderTool`. It wraps
`useRenderTool({ name: "*" })` with the correct `DefaultRenderProps`
typing (`parameters: unknown`) and provides a built-in default card when
no `render` is passed. Hand-rolling loses the default card and invites
the untyped-args footgun.

Source: `packages/react-core/src/v2/hooks/use-default-render-tool.tsx:15-64`
