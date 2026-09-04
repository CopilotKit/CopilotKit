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
    threadId: "main",
    updates: [
      UseAgentUpdate.OnMessagesChanged,
      UseAgentUpdate.OnRunStatusChanged,
    ],
    throttleMs: 100,
  });

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

`useAgent` returns `{ agent, isReady }`; `isRunning` lives on the agent
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

### Wait for the real agent before attaching to it

```tsx
const { agent, isReady } = useAgent({ agentId: "default" });

useEffect(() => {
  if (!isReady) return; // provisional stand-in — don't attach yet
  const sub = agent.subscribe({ onRunStartedEvent: handleRunStarted });
  return () => sub.unsubscribe();
}, [agent, isReady]);
```

Until the runtime `/info` sync resolves, `agent` is a provisional
stand-in. It is a fully-constructed `AbstractAgent`, so every call on it
is safe — but it is then **replaced**, and `agent` changes reference.
Anything keyed to the old instance goes with it.

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

`useAgent` calls `source.clone()` to build a per-thread clone and throws
`clone() must return a new, independent object` if the clone is the same
instance. This guards per-thread isolation.

Source: `packages/react-core/src/v2/hooks/use-agent.tsx:58-69`

### HIGH — Deriving app state from `agent` without guarding on `isReady`

Wrong:

```tsx
const { agent } = useAgent({ agentId: "default" });

// Correlation map for matching responses back to the row that asked.
const pending = useRef(new Map<string, string>());

useEffect(() => {
  pending.current = new Map(); // re-runs when `agent` is swapped
  const sub = agent.subscribe({ onRunFinishedEvent: resolvePending });
  return () => sub.unsubscribe();
}, [agent]);
```

Correct:

```tsx
const { agent, isReady } = useAgent({ agentId: "default" });

// Owned by the component, not by the agent — survives the swap.
const pending = useRef(new Map<string, string>());

useEffect(() => {
  if (!isReady) return;
  const sub = agent.subscribe({ onRunFinishedEvent: resolvePending });
  return () => sub.unsubscribe();
}, [agent, isReady]);
```

`agent` changes reference exactly once per mount, when `/info` resolves and
the provisional stand-in is swapped for the real instance. Any effect with
`agent` in its dependency array re-runs at that moment — so app state
initialized inside such an effect is silently reset partway through the
first interaction.

This bites hardest with Intelligence configured, because license
verification and thread-endpoint discovery lengthen the provisional window
past the first user action. In plain SSE mode the window usually closes
before anyone can interact, which is why the bug does not reproduce in
OSS-only development.

Never put per-component bookkeeping (correlation maps, in-flight request
records, refs) behind an `agent` dependency. Initialize it in the ref
itself and let the effect only manage the subscription.

Source: `packages/react-core/src/v2/hooks/use-agent.tsx:226-290,465-481`

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

### MEDIUM — Two components using the same `agentId` expecting isolated state

Wrong:

```tsx
function A() {
  useAgent({ agentId: "default" });
}

function B() {
  useAgent({ agentId: "default" });
}
```

Correct:

```tsx
function A() {
  useAgent({
    agentId: "chat-a",
    runtimeAgentId: "default",
    threadId: "thread-a",
  });
}

function B() {
  useAgent({
    agentId: "chat-b",
    runtimeAgentId: "default",
    threadId: "thread-b",
  });
}
```

Both hooks using the same `agentId` resolve to the same registered agent
instance. `threadId` does not create a new frontend agent or isolate state.

When multiple frontend surfaces need independent state while targeting the
same runtime agent, use `runtimeAgentId` with distinct local `agentId` values.
The local `agentId` identifies the frontend proxy, while `runtimeAgentId`
controls which runtime agent receives requests.

Source: `packages/react-core/src/v2/hooks/use-agent.tsx`;
`packages/core/src/core/core.ts` (`registerProxiedAgent`)
