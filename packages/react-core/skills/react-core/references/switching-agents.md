# CopilotKit Switching Agents (React)

This skill builds on `copilotkit/agent-access`, `copilotkit/client-side-tools`,
and `copilotkit/rendering-tool-calls`.

Three main patterns:

1. **Parallel panels** — one `useAgent({ agentId })` per surface.
2. **Slot swap** — `<CopilotChat key={agentId} agentId={agentId} />`.
3. **Discovery** — subscribe to `onAgentsChanged` (no `useAgents()` hook).

## Setup

```tsx
"use client";
import { CopilotChat } from "@copilotkit/react-core/v2";
import { useState } from "react";

export function AgentSwitcherChat() {
  const [activeAgent, setActiveAgent] = useState("research");

  return (
    <div>
      <div>
        <button onClick={() => setActiveAgent("research")}>Research</button>
        <button onClick={() => setActiveAgent("coding")}>Coding</button>
      </div>

      {/* key={activeAgent} forces remount so thread state doesn't leak */}
      <CopilotChat key={activeAgent} agentId={activeAgent} />
    </div>
  );
}
```

## Core Patterns

### Side-by-side chat panels

```tsx
<div className="grid grid-cols-2 gap-4">
  <CopilotChat agentId="research" threadId="research-main" />
  <CopilotChat agentId="coding" threadId="coding-main" />
</div>
```

### Agent-scoped tool

```tsx
import { useFrontendTool } from "@copilotkit/react-core/v2";
import { z } from "zod";

useFrontendTool({
  name: "saveFindings",
  agentId: "research", // ← only the research agent sees this tool
  parameters: z.object({ summary: z.string() }),
  handler: async ({ summary }) => {
    await fetch("/api/findings", { method: "POST", body: summary });
  },
});
```

### Agent-scoped renderer

```tsx
import { useRenderTool } from "@copilotkit/react-core/v2";
import { z } from "zod";

useRenderTool({
  name: "search",
  agentId: "research", // ← only applies to research's "search" tool
  parameters: z.object({ q: z.string() }),
  render: ({ status, parameters, result }) => {
    if (status === "inProgress") return <div>Preparing...</div>;
    if (status === "executing") return <div>Searching {parameters.q}</div>;
    return <div>{result}</div>;
  },
});
```

### Discover available agents (no `useAgents` hook)

```tsx
"use client";
import { useCopilotKit } from "@copilotkit/react-core/v2";
import { useEffect, useState } from "react";

export function useAvailableAgents() {
  const { copilotkit } = useCopilotKit();
  const [ids, setIds] = useState<string[]>(() =>
    Object.keys(copilotkit.agents ?? {}),
  );

  useEffect(() => {
    const subscription = copilotkit.subscribe({
      onAgentsChanged: ({ agents }) => {
        setIds(Object.keys(agents ?? {}));
      },
    });
    return () => subscription.unsubscribe();
  }, [copilotkit]);

  return ids;
}
```

## Common Mistakes

### HIGH — Switching `agentId` on a persisted `<CopilotChat>` without `key`

Wrong:

```tsx
<CopilotChat agentId={activeAgent} />
```

Correct:

```tsx
<CopilotChat key={activeAgent} agentId={activeAgent} />
```

Without remount via `key`, prior thread state and in-flight runs leak into
the new agent's view. The remount pattern gives each agent a clean slate.

Source: `examples/v2/react-router/app/routes/_index.tsx:38-39`

### MEDIUM — Omitting `agentId` when multiple agents share a tool name

Wrong:

```tsx
// Both research and coding agents have a "search" tool — unscoped wins globally
useRenderToolCall({
  name: "search",
  args: z.object({ q: z.string() }),
  render,
});
```

Correct:

```tsx
useRenderTool({
  name: "search",
  agentId: "research",
  parameters: z.object({ q: z.string() }),
  render: researchSearchRender,
});
useRenderTool({
  name: "search",
  agentId: "coding",
  parameters: z.object({ q: z.string() }),
  render: codingSearchRender,
});
```

Unscoped renderers apply to every agent. When two agents have a tool with
the same name and only one has a renderer, the unscoped renderer wins
globally and the other agent never gets its intended renderer.

Source: `packages/react-core/src/v2/hooks/use-render-tool-call.tsx:145-154`

### MEDIUM — Tools registered without `agentId` leak across panels

Wrong:

```tsx
useFrontendTool({
  name: "saveFindings",
  parameters: z.object({ summary: z.string() }),
  handler,
});
// Both research and coding agents now see saveFindings.
```

Correct:

```tsx
useFrontendTool({
  name: "saveFindings",
  agentId: "research",
  parameters: z.object({ summary: z.string() }),
  handler,
});
```

Omitting `agentId` attaches the tool to every agent. In a multi-agent UI
this leaks the handler across panels. Scope tools explicitly when they
should only apply to one agent.

Source: `packages/react-core/src/v2/hooks/use-frontend-tool.tsx`

### MEDIUM — Using `useAgents()` (does not exist)

Wrong:

```tsx
import { useAgents } from "@copilotkit/react-core/v2"; // not exported
const agents = useAgents();
```

Correct:

```tsx
import { useCopilotKit } from "@copilotkit/react-core/v2";
import { useEffect, useState } from "react";

function useAvailableAgents() {
  const { copilotkit } = useCopilotKit();
  const [ids, setIds] = useState<string[]>(() =>
    Object.keys(copilotkit.agents ?? {}),
  );
  useEffect(() => {
    const sub = copilotkit.subscribe({
      onAgentsChanged: ({ agents }) => setIds(Object.keys(agents ?? {})),
    });
    return () => sub.unsubscribe();
  }, [copilotkit]);
  return ids;
}
```

There is no `useAgents` hook in v2. Discover agents by subscribing to
`onAgentsChanged` on the core client.

Source: `packages/react-core/src/v2/hooks/index.ts` (no `useAgents` export)

## References

- [Agent switcher recipes](switching-agents-recipes.md) — dropdown, tabs, keyboard shortcuts
