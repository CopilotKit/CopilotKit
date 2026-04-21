---
name: rendering-activity-messages
description: >
  Register renderers for non-chat activity messages (MCP Apps outputs,
  generative UI surfaces, custom activity types) via ReactActivityMessageRenderer
  entries passed to CopilotKitProvider and consumed via useRenderActivityMessage.
  User-provided renderers precede built-ins (MCPAppsActivityType,
  OpenGenerativeUIActivityType) and can override them. Silent-fail when
  content schema mismatches — safeParse returns null with only a console.warn.
  Resolver order: (activityType, agentId) > (activityType, unscoped) > '*'
  > null. Load when rendering non-chat agent output: workflow progress,
  MCP-app cards, custom tool dashboards.
type: framework
framework: react
library: copilotkit
library_version: "1.56.2"
requires:
  - copilotkit/provider-setup
sources:
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/hooks/use-render-activity-message.tsx"
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/types/react-activity-message-renderer.ts"
---

# CopilotKit Rendering Activity Messages (React)

This skill builds on `copilotkit/provider-setup`. Activity-message
renderers are registered as entries in the `renderActivityMessages` array
prop on `CopilotKitProvider` and resolved at render time by
`useRenderActivityMessage` (consumed internally by chat components).

User renderers are placed first in the array so they override the built-in
`MCPAppsActivityType` and `OpenGenerativeUIActivityType` renderers for the
same `activityType`.

Resolver order:

1. `(activityType, agentId)` match
2. `(activityType, unscoped)` match
3. `'*'` wildcard
4. `null`

## Setup

```tsx
"use client";
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import type { ReactActivityMessageRenderer } from "@copilotkit/react-core/v2";
import { z } from "zod";
import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

const progressRenderer: ReactActivityMessageRenderer<{
  percent: number;
  label: string;
}> = {
  activityType: "progress",
  content: z.object({ percent: z.number().min(0).max(1), label: z.string() }),
  render: ({ content }) => (
    <Card>
      <CardContent>
        <div>{content.label}</div>
        <Progress value={content.percent * 100} />
      </CardContent>
    </Card>
  ),
};

export function Providers({ children }: { children: React.ReactNode }) {
  const renderers = useMemo(() => [progressRenderer], []);
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      renderActivityMessages={renderers}
    >
      {children}
    </CopilotKitProvider>
  );
}
```

## Core Patterns

### Agent-scoped renderer

```tsx
const researchProgress: ReactActivityMessageRenderer<{ step: string }> = {
  activityType: "research-step",
  agentId: "research",
  content: z.object({ step: z.string() }),
  render: ({ content }) => <ResearchStepBadge step={content.step} />,
};
```

### Override a built-in (MCP Apps)

Place your renderer for the same `activityType` — user renderers are
evaluated before built-ins.

```tsx
const customMcpRenderer: ReactActivityMessageRenderer<unknown> = {
  activityType: "mcp-app", // MCPAppsActivityType
  content: z.unknown(),
  render: ({ content, message }) => <CustomMCPCard payload={content} />,
};
```

### Using the hook directly (custom chat surface)

```tsx
import { useRenderActivityMessage } from "@copilotkit/react-core/v2";
import type { ActivityMessage } from "@ag-ui/core";

export function ActivityList({ messages }: { messages: ActivityMessage[] }) {
  const { renderActivityMessage } = useRenderActivityMessage();
  return (
    <div>
      {messages.map((m) => (
        <div key={m.id}>{renderActivityMessage(m)}</div>
      ))}
    </div>
  );
}
```

## Common Mistakes

### HIGH — Incompatible content schema

Wrong:

```tsx
// Renderer expects `pct`
const r: ReactActivityMessageRenderer<{ pct: number }> = {
  activityType: "progress",
  content: z.object({ pct: z.number() }),
  render: ({ content }) => <Bar value={content.pct} />,
};
// But the server emits { percent: 0.5 } — mismatched field name
```

Correct:

```tsx
const r: ReactActivityMessageRenderer<{ percent: number }> = {
  activityType: "progress",
  content: z.object({ percent: z.number() }),
  render: ({ content }) => <Bar value={content.percent} />,
};
```

`safeParse` is called on every incoming activity message. Mismatched
schemas return `null` with only a `console.warn("Failed to parse content
for activity message …")` — the UI renders nothing and the failure is
silent unless you read the console.

Source: `packages/react-core/src/v2/hooks/use-render-activity-message.tsx:44-50`

### MEDIUM — Side effects in `render`

Wrong:

```tsx
render: ({ content }) => {
  trackEvent(content); // fires on every re-render
  return <Badge>{content.label}</Badge>;
};
```

Wrong (Rules of Hooks violation):

```tsx
render: ({ content }) => {
  // `render` is invoked as a plain function by the resolver — NOT as a
  // React component — so calling hooks directly inside it is illegal.
  useEffect(() => trackEvent(content), [content]);
  return <Badge>{content.label}</Badge>;
};
```

Correct:

```tsx
function TrackedBadge({ content }: { content: { label: string } }) {
  useEffect(() => {
    trackEvent(content);
  }, [content]);
  return <Badge>{content.label}</Badge>;
}

// In the renderer:
render: ({ content }) => <TrackedBadge content={content} />;
```

Activity-message renderers re-render on every message-list tick. Side
effects in the render body fire repeatedly. Hooks cannot be called
directly inside `render` because the resolver invokes it as a plain
function; hoist the effect into a wrapper component that React mounts as
a real element.

Source: `packages/react-core/src/v2/hooks/use-render-activity-message.tsx`

### MEDIUM — Building the `renderActivityMessages` array inline

Wrong:

```tsx
<CopilotKitProvider
  runtimeUrl="/api/copilotkit"
  renderActivityMessages={[progressRenderer, customMcpRenderer]}
/>
```

Correct:

```tsx
const renderers = useMemo(() => [progressRenderer, customMcpRenderer], []);
<CopilotKitProvider
  runtimeUrl="/api/copilotkit"
  renderActivityMessages={renderers}
/>;
```

The provider uses `useStableArrayProp` and console-errors when a new array
identity appears every render. Memoize or hoist the array to module
scope.

Source: `packages/react-core/src/v2/providers/CopilotKitProvider.tsx` (useStableArrayProp)
