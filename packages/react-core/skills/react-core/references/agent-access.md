# CopilotKit Agent Access (React)

This skill builds on `copilotkit/provider-setup`. `useAgent` reads from the
same registry the provider populates from `/info`.

Two complementary surfaces:

- `useAgent` — imperative access to an agent instance, subscribe to
  messages/state/run-status changes.
- `useAgentContext` — declarative push of app state to every agent run.

## Setup

```tsx
"use client";
import {
  useAgent,
  useAgentContext,
  UseAgentUpdate,
} from "@copilotkit/react-core/v2";
import { useMemo } from "react";

export function ChatDriver({
  route,
  userId,
}: {
  route: string;
  userId: string;
}) {
  const { agent } = useAgent({
    agentId: "default",
    updates: [
      UseAgentUpdate.OnMessagesChanged,
      UseAgentUpdate.OnRunStatusChanged,
    ],
    throttleMs: 100,
  });

  // Thread-scoped private agent (all three required):
  // const { agent: threadAgent } = useAgent({
  //   agentId: "chat-1",
  //   runtimeAgentId: "default",
  //   threadId: "main",
  // });

  const context = useMemo(() => ({ route, userId }), [route, userId]);
  useAgentContext({ description: "app context", value: context });

  return (
    <div>
      {agent.isRunning ? "…thinking" : "idle"} — {agent.messages.length}{" "}
      messages
    </div>
  );
}
```

## Core Patterns

### Send a message and stream the response

```tsx
const { agent } = useAgent({ agentId: "default" });
const { copilotkit } = useCopilotKit();

async function ask(text: string) {
  agent.addMessage({ id: crypto.randomUUID(), role: "user", content: text });
  await copilotkit.runAgent({ agent });
}
```

### Subscribe only to run-status to reduce re-renders

```tsx
const { agent } = useAgent({
  agentId: "default",
  updates: [UseAgentUpdate.OnRunStatusChanged],
});
const isRunning = agent.isRunning;
```

`useAgent` returns `{ agent }` only; `isRunning` lives on the agent
itself. Subscribing to `OnRunStatusChanged` forces a re-render when the
value flips, so reading `agent.isRunning` stays live.

### Share app state with every agent run (global)

```tsx
const value = useMemo(
  () => ({ cartItems: cart.items, currentRoute: router.pathname }),
  [cart.items, router.pathname],
);
useAgentContext({ description: "user cart + route", value });
```

### Abort the run

```tsx
const { agent } = useAgent({ agentId: "default" });
<button onClick={() => agent.abortRun()}>Stop</button>;
```

## Common Mistakes

### CRITICAL — Custom `AbstractAgent.clone()` that returns `this`

Wrong:

```tsx
class MyAgent extends AbstractAgent {
  clone() {
    return this; // wrong — same instance is reused across threads
  }
}
```

Correct:

```tsx
class MyAgent extends AbstractAgent {
  clone() {
    const next = new MyAgent(this.config);
    next.state = { ...this.state };
    return next;
  }
}
```

`useAgent` with `threadId` registers a private proxied agent via
`CopilotKitCore.registerProxiedAgent` (`agentId` → `runtimeAgentId`) with
`threadId` pinned, rather than cloning. The per-thread instance is owned by
that registration (see the `registerProxiedAgent` effect). `clone()` is only
relevant for custom `AbstractAgent` subclasses used directly — it must still
return a new, independent object.

Source: `packages/react-core/src/v2/hooks/use-agent.tsx:237-252`

### HIGH — Mutating `agent.messages` directly

Wrong:

```tsx
agent.messages.push({ id, role: "user", content: "hi" });
```

Correct:

```tsx
agent.addMessage({ id: crypto.randomUUID(), role: "user", content: "hi" });
// or:
agent.setMessages([...agent.messages, newMessage]);
```

AG-UI fires `onMessagesChanged` subscribers via `addMessage` /
`setMessages`. Direct array mutation bypasses subscribers and the UI never
re-renders.

Source: `packages/react-core/src/v2/hooks/use-agent.tsx` (throughout)

### HIGH — Registering non-serializable values via `useAgentContext`

Wrong:

```tsx
useAgentContext({
  description: "user",
  value: {
    name: "Alice",
    lastLogin: new Date(),
    onLogout: () => logout(), // dropped silently
  },
});
```

Correct:

```tsx
useAgentContext({
  description: "user",
  value: { name: "Alice", lastLogin: new Date().toISOString() },
});
```

`useAgentContext` runs the value through `JSON.stringify`. Functions are
dropped, `Date` coerces to an ISO string (which the agent has to parse), and
circular references throw.

Source: `packages/react-core/src/v2/hooks/use-agent-context.tsx:30-35`

### MEDIUM — Expecting lifecycle callbacks to be throttled

Wrong:

```tsx
useAgent({
  agentId: "default",
  throttleMs: 300,
  // expecting onRunInitialized / onRunFinalized / onRunFailed to also be throttled
});
```

Correct:

```tsx
// Only OnMessagesChanged / OnStateChanged / OnRunStatusChanged are throttled.
// Lifecycle callbacks always fire immediately — handle them synchronously.
useAgent({ agentId: "default", throttleMs: 300 });
```

`throttleMs` only applies to the three subscribed updates enumerated in
`UseAgentUpdate`. Lifecycle callbacks bypass the throttler.

Source: `packages/react-core/src/v2/hooks/use-agent.tsx:36-48`

### MEDIUM — Unstable context value identity

Wrong:

```tsx
useAgentContext({ description: "cart", value: { items: cart.items } });
```

Correct:

```tsx
const value = useMemo(() => ({ items: cart.items }), [cart.items]);
useAgentContext({ description: "cart", value });
```

A fresh object literal on every render invalidates the `useMemo` inside
`useAgentContext` that serializes the value, causing constant
remove/re-add churn in the core context store.

Source: `packages/react-core/src/v2/hooks/use-agent-context.tsx:30-35`

### MEDIUM — Expecting `useAgentContext` or `copilotkit.addContext` to scope context per agent

Wrong:

```tsx
useAgentContext({ agentId: "research", description: "paper list", value });
// or the imperative form:
copilotkit.addContext({
  description: "paper list",
  value: JSON.stringify(value),
  agentId: "research",
});
```

Correct:

```tsx
// Context is global — every agent run sees every registered entry.
useAgentContext({ description: "paper list", value });

// When only one agent should key off a value, branch inside its prompt
// or tool logic instead of trying to scope the context entry.
```

Context is intentionally global and there is no per-agent scoping hook.
`useAgentContext` has no `agentId` parameter, and `copilotkit.addContext`
destructures only `{ description, value }` — any `agentId` passed is
silently dropped. Treat context as "state of the world" that every agent
sees.

Source: `packages/react-core/src/v2/hooks/use-agent-context.tsx` (no `agentId` parameter); `packages/core/src/core/context-store.ts:26-31`

### MEDIUM — Two components using the same `runtimeAgentId` + `threadId` expecting isolation

Wrong:

```tsx
function A() {
  const { agent } = useAgent({ agentId: "chat-a", runtimeAgentId: "default", threadId: "t1" });
}
function B() {
  const { agent } = useAgent({ agentId: "chat-b", runtimeAgentId: "default", threadId: "t1" });
}
```

Correct:

```tsx
function A() {
  useAgent({ agentId: "chat-a", runtimeAgentId: "default", threadId: "a" });
}
function B() {
  useAgent({ agentId: "chat-b", runtimeAgentId: "default", threadId: "b" });
}
```

Thread-scoped agents are registered via `CopilotKitCore.registerProxiedAgent`
under a distinct local `agentId` routing to `runtimeAgentId` with `threadId`
pinned. Two consumers that share the same `runtimeAgentId` and `threadId`
— even with different local `agentId`s — address the same backend thread.
Give each surface a distinct `threadId` when isolation is intentional.

Source: `packages/react-core/src/v2/hooks/use-agent.tsx:237-252`
