---
name: scale-to-multi-agent
description: >
  Upgrade a single-agent CopilotKit v2 app to multi-agent with per-panel
  useAgent({ agentId }), agent-scoped tools / renderers / context, key-remount
  when swapping agents in one chat slot, and thread-switcher UIs via
  useThreads. No useAgents() hook exists — discover the agent list via
  copilotkit.subscribe({ onAgentsChanged }). Load when moving from one agent
  to many, when agentId filters start appearing on tools, or when building a
  side-by-side multi-panel chat.
type: lifecycle
library: copilotkit
library_version: "1.56.2"
requires:
  - copilotkit/setup-endpoint
  - copilotkit/built-in-agent
  - copilotkit/agent-access
  - copilotkit/switching-agents
  - copilotkit/threads
  - copilotkit/client-side-tools
  - copilotkit/chat-components
sources:
  - "CopilotKit/CopilotKit:dev-docs/architecture/multi-agent.md"
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/hooks/use-agent.tsx"
  - "CopilotKit/CopilotKit:packages/core/src/core/agent-registry.ts"
  - "CopilotKit/CopilotKit:examples/v2/react-router/app/routes/_index.tsx"
---

## Setup

Register multiple agents on the runtime, pass `agentId` to each
`<CopilotChat>`, and scope tools/context to the agent that should see them.

### Server — declare agents

```tsx
// app/routes/api.copilotkit.$.tsx
import type { Route } from "./+types/api.copilotkit.$";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  BuiltInAgent,
  convertInputToTanStackAI,
} from "@copilotkit/runtime/v2";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";

const makeAgent = (system: string) =>
  new BuiltInAgent({
    type: "tanstack",
    factory: ({ input, abortController }) => {
      const { messages } = convertInputToTanStackAI(input);
      return chat({
        adapter: openaiText("gpt-4o"),
        systemPrompts: [system],
        messages,
        abortController,
      });
    },
  });

const runtime = new CopilotRuntime({
  agents: {
    research: makeAgent("You are a research assistant."),
    coding: makeAgent("You are a coding assistant."),
  },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export async function loader({ request }: Route.LoaderArgs) {
  return handler(request);
}
export async function action({ request }: Route.ActionArgs) {
  return handler(request);
}
```

### Client — one panel per agent, agent-scoped tools

```tsx
import {
  CopilotKitProvider,
  CopilotChat,
  useFrontendTool,
} from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import { z } from "zod";

function Tools() {
  // Scoped to coding agent only:
  useFrontendTool({
    agentId: "coding",
    name: "applyEdit",
    description: "Apply a text edit to the active buffer.",
    parameters: z.object({ path: z.string(), content: z.string() }),
    handler: async ({ path, content }) => {
      await editor.writeFile(path, content);
      return { ok: true };
    },
  });

  // Scoped to research agent only:
  useFrontendTool({
    agentId: "research",
    name: "searchDocs",
    description: "Search internal docs.",
    parameters: z.object({ query: z.string() }),
    handler: async ({ query }) => ({ results: await search(query) }),
  });
  return null;
}

export default function App() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit">
      <Tools />
      <div className="grid grid-cols-2 h-screen">
        <CopilotChat agentId="research" className="h-full" />
        <CopilotChat agentId="coding" className="h-full" />
      </div>
    </CopilotKitProvider>
  );
}
```

## Core Patterns

### Swapping agents in ONE chat slot — always key-remount

```tsx
import { useState } from "react";
import { CopilotChat } from "@copilotkit/react-core/v2";

function SwitcherChat() {
  const [agentId, setAgentId] = useState<"research" | "coding">("research");
  return (
    <>
      <button onClick={() => setAgentId("research")}>Research</button>
      <button onClick={() => setAgentId("coding")}>Coding</button>
      <CopilotChat key={agentId} agentId={agentId} className="h-full" />
    </>
  );
}
```

Without the `key={agentId}`, WeakMap per-thread clones cache by `threadId`
and the prior agent's messages leak into the new panel.

### Discovering available agents (no useAgents hook)

```tsx
import { useEffect, useState } from "react";
import { useCopilotKit } from "@copilotkit/react-core/v2";
import type { AbstractAgent } from "@copilotkit/react-core/v2";

function AgentSwitcher() {
  const { copilotkit } = useCopilotKit();
  const [agents, setAgents] = useState<Record<string, AbstractAgent>>({});
  useEffect(() => {
    const sub = copilotkit.subscribe({
      onAgentsChanged: ({ agents }) => setAgents(agents),
    });
    return () => sub.unsubscribe();
  }, [copilotkit]);

  return (
    <select>
      {Object.keys(agents).map((id) => (
        <option key={id}>{id}</option>
      ))}
    </select>
  );
}
```

### Thread switcher via useThreads

```tsx
import { useThreads } from "@copilotkit/react-core/v2";

function ThreadSidebar({ agentId }: { agentId: string }) {
  const { threads, isLoading, hasMoreThreads, fetchMoreThreads } = useThreads({
    agentId,
  });
  if (isLoading) return <div>Loading…</div>;
  return (
    <ul>
      {threads.map((t) => (
        <li key={t.id}>{t.title ?? t.id}</li>
      ))}
      {hasMoreThreads ? <button onClick={fetchMoreThreads}>More</button> : null}
    </ul>
  );
}
```

`useThreads` requires Intelligence mode on the runtime. In SSE mode it
errors with "Runtime URL is not configured". See `copilotkit/threads`.

### Agent-scoped context (rare — context is intentionally global)

```tsx
import { useEffect } from "react";
import { useCopilotKit, useAgentContext } from "@copilotkit/react-core/v2";

function ResearchContext({ value }: { value: string }) {
  // Default: context is global, every agent sees it.
  useAgentContext({ description: "Active project name", value });
  return null;
}

function ScopedContext() {
  // Rare escape hatch for true per-agent context:
  const { copilotkit } = useCopilotKit();
  useEffect(() => {
    const { id } = copilotkit.addContext({
      agentId: "research",
      description: "Research-only hint",
      value: "priority=high",
    });
    return () => copilotkit.removeContext({ id });
  }, [copilotkit]);
  return null;
}
```

## Common Mistakes

### CRITICAL custom AbstractAgent clone() returning this

Wrong:

```ts
class MyAgent {
  clone() {
    return this;
  }
}
```

Correct:

```ts
class MyAgent {
  clone() {
    return new MyAgent({ ...this.config, state: { ...this.state } });
  }
}
```

`useAgent` clones per-thread; returning `this` shares state across
threads and throws a cloning assertion at runtime.

Source: packages/react-core/src/v2/hooks/use-agent.tsx:58-69

### HIGH reaching for useAgents() / useAvailableAgents()

Wrong:

```tsx
function AgentSwitcher() {
  const agents = useAgents(); // does not exist
  return (
    <select>
      {agents.map((a) => (
        <option key={a.id}>{a.name}</option>
      ))}
    </select>
  );
}
```

Correct:

```tsx
function AgentSwitcher() {
  const { copilotkit } = useCopilotKit();
  const [agents, setAgents] = useState<Record<string, AbstractAgent>>({});
  useEffect(() => {
    const sub = copilotkit.subscribe({
      onAgentsChanged: ({ agents }) => setAgents(agents),
    });
    return () => sub.unsubscribe();
  }, [copilotkit]);
  return (
    <select>
      {Object.keys(agents).map((id) => (
        <option key={id}>{id}</option>
      ))}
    </select>
  );
}
```

There is no `useAgents` hook in v2 — the client discovers agents via the
core subscriber only. Agents trained on generic-SDK patterns hallucinate
this hook.

Source: packages/core/src/core/agent-registry.ts:502; packages/core/src/core/core.ts:127,360

### HIGH swapping agentId on one CopilotChat without a key

Wrong:

```tsx
<CopilotChat agentId={activeAgent} />
```

Correct:

```tsx
<CopilotChat key={activeAgent} agentId={activeAgent} />
```

Without the key, per-thread clone WeakMaps remain cached by `threadId` and
prior agent state leaks into the new panel.

Source: examples/v2/react-router/app/routes/\_index.tsx:38-39

### MEDIUM tools registered without agentId leak across panels

Wrong:

```tsx
useFrontendTool({
  name: "applyEdit",
  parameters: z.object({ path: z.string(), content: z.string() }),
  handler,
});
```

Correct:

```tsx
useFrontendTool({
  agentId: "coding",
  name: "applyEdit",
  parameters: z.object({ path: z.string(), content: z.string() }),
  handler,
});
```

Omitting `agentId` attaches the tool to every agent — the research agent
sees `applyEdit` and may call it in scenarios it shouldn't.

Source: packages/react-core/src/v2/hooks/use-frontend-tool.tsx

### MEDIUM expecting useCoAgent semantics in v2

Wrong:

```tsx
const { state, setState, running } = useCoAgent({ name: "research" });
```

Correct:

```tsx
const { agent, isRunning } = useAgent({ agentId: "research" });
const state = agent.state;
agent.setState({ ...agent.state, foo: "bar" });
await copilotkit.runAgent({ agent });
```

v2 `useAgent` returns `{ agent, messages, state, isRunning }`. State
mutation is via `agent.setState`; `copilotkit.runAgent({ agent })` triggers
a run. No state-returning callback.

Source: packages/react-core/src/v2/hooks/use-agent.tsx:11-51
