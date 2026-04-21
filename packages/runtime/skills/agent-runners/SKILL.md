---
name: agent-runners
description: >
  Pick an AgentRunner for the CopilotRuntime — InMemoryAgentRunner (default, ephemeral,
  globalThis-keyed), SqliteAgentRunner from @copilotkit/sqlite-runner (file-backed via the
  better-sqlite3 peer), or a custom subclass of the AgentRunner abstract base. Covers the
  run/connect/isRunning/stop contract, the "Thread already running" 409 semantics, the mutual
  exclusion between passing `runner` and setting `intelligence` (Intelligence mode auto-wires
  IntelligenceAgentRunner and rejects a user-supplied runner), and why the default in-memory
  runner is unsafe for production. Does NOT persist messages — only agent run state (use
  Intelligence mode for durable message history).
type: core
library: copilotkit
library_version: "1.56.2"
requires:
  - copilotkit/setup-endpoint
sources:
  - "CopilotKit/CopilotKit:packages/runtime/src/v2/runtime/runner/agent-runner.ts"
  - "CopilotKit/CopilotKit:packages/runtime/src/v2/runtime/runner/in-memory.ts"
  - "CopilotKit/CopilotKit:packages/sqlite-runner/src/sqlite-runner.ts"
  - "CopilotKit/CopilotKit:packages/runtime/src/v2/runtime/core/runtime.ts"
---

# CopilotKit Agent Runners

`AgentRunner` is the abstraction that owns thread run state — active runs, the event stream
replay, and stop semantics. Pick one per `CopilotRuntime` instance.

- `InMemoryAgentRunner` — default; globalThis-keyed Map; lost on restart.
- `SqliteAgentRunner` — file-backed; requires `better-sqlite3` peer.
- `IntelligenceAgentRunner` — auto-wired by `CopilotIntelligenceRuntime`. You do NOT
  construct this directly and you cannot pass `runner` alongside `intelligence`.
- Custom — subclass `AgentRunner` for Redis / Postgres / any backend.

## Setup

Default (in-memory, dev only):

```typescript
import { CopilotRuntime } from "@copilotkit/runtime/v2";

// Equivalent to passing `runner: new InMemoryAgentRunner()`
const runtime = new CopilotRuntime({
  agents: {
    /* ... */
  } as any,
});
```

Production (file-backed SQLite):

```typescript
import { CopilotRuntime } from "@copilotkit/runtime/v2";
import { SqliteAgentRunner } from "@copilotkit/sqlite-runner";

const runtime = new CopilotRuntime({
  agents: {
    /* ... */
  } as any,
  runner: new SqliteAgentRunner({ dbPath: "./data/threads.db" }),
});
```

Installation for the SQLite runner (the `better-sqlite3` peer is required):

```bash
pnpm add @copilotkit/sqlite-runner better-sqlite3
```

## Core Patterns

### The AgentRunner contract

```typescript
import { AgentRunner } from "@copilotkit/runtime/v2";
import type {
  AgentRunnerRunRequest,
  AgentRunnerConnectRequest,
  AgentRunnerIsRunningRequest,
  AgentRunnerStopRequest,
} from "@copilotkit/runtime/v2";
import { Observable } from "rxjs";
import type { BaseEvent } from "@ag-ui/client";

class MyRunner extends AgentRunner {
  run(request: AgentRunnerRunRequest): Observable<BaseEvent> {
    // Start a new run for request.threadId. Throw `new Error("Thread already running")`
    // if a run is in flight. Stream events from agent.run(request.input).
    return new Observable<BaseEvent>();
  }
  connect(request: AgentRunnerConnectRequest): Observable<BaseEvent> {
    // Replay events for an active run, or historic runs for request.threadId.
    return new Observable<BaseEvent>();
  }
  async isRunning(request: AgentRunnerIsRunningRequest): Promise<boolean> {
    return false;
  }
  async stop(request: AgentRunnerStopRequest): Promise<boolean | undefined> {
    return true;
  }
}
```

### Handle double-submit on the client

Both `InMemoryAgentRunner` and `SqliteAgentRunner` throw
`"Thread already running"` on concurrent `run()` calls for the same `threadId`. How
that surfaces to the client depends on the runtime mode:

- **Intelligence mode** — the Intelligence platform returns HTTP `409` when a lock is
  held. The client core maps this to `CopilotKitCoreErrorCode.AGENT_THREAD_LOCKED`
  and fires `onError({ code: "agent_thread_locked", ... })`. Handle this in
  `<CopilotKitProvider onError>`.
- **SSE mode** (default, in-memory / SQLite runners) — the runner throws
  synchronously and the handler returns a plain `500` JSON body like
  `{ "error": "Failed to run agent", "message": "Thread already running" }`.
  There is no typed `agent_thread_locked` code — match on the message text or
  just guard on the client with a busy flag.

```tsx
// client — Intelligence mode (typed code)
import { CopilotKitProvider } from "@copilotkit/react-core/v2";

<CopilotKitProvider
  onError={({ code }) => {
    if (code === "agent_thread_locked") {
      alert("Agent is busy — wait for the current response to finish.");
    }
  }}
/>;
```

```tsx
// client — any mode: guard with a busy flag so double-submit is impossible
import { useAgent } from "@copilotkit/react-core/v2";
import { useState } from "react";

function Composer() {
  const agent = useAgent({ agentId: "default" });
  const [busy, setBusy] = useState(false);

  async function send(text: string) {
    if (busy) return;
    setBusy(true);
    try {
      await agent?.addMessage({ role: "user", content: text });
    } finally {
      setBusy(false);
    }
  }

  return null;
}
```

## Common Mistakes

### HIGH Shipping InMemoryAgentRunner to production

Wrong:

```typescript
// production:
new CopilotRuntime({ agents: { default: agent } });
```

Correct:

```typescript
import { SqliteAgentRunner } from "@copilotkit/sqlite-runner";

new CopilotRuntime({
  agents: { default: agent },
  runner: new SqliteAgentRunner({ dbPath: "./data/threads.db" }),
});
// Or upgrade to Intelligence mode for managed durability.
```

The default runner is `new InMemoryAgentRunner()`. It keeps state in a `globalThis`-keyed
Map — threads are lost on restart, and horizontally-scaled instances see divergent state.

Source: `packages/runtime/src/v2/runtime/runner/in-memory.ts:63-96`.

### HIGH Setting runner alongside intelligence option

Wrong:

```typescript
new CopilotRuntime({
  agents,
  intelligence,
  runner: new SqliteAgentRunner({ dbPath: "./data/threads.db" }),
});
```

Correct:

```typescript
new CopilotRuntime({
  agents,
  intelligence,
  identifyUser: (req) => ({ id: req.headers.get("x-user-id")! }),
});
```

`CopilotIntelligenceRuntimeOptions` does not declare a `runner` field — Intelligence mode
auto-wires `IntelligenceAgentRunner` pointed at the Cloud socket. Excess-property checks will
flag a `runner:` key on an Intelligence-shaped options object as a type error, and at runtime
the auto-wired Intelligence runner wins regardless of what you pass.

Source: `packages/runtime/src/v2/runtime/core/runtime.ts:149-173,285-294`.

### HIGH Forgetting the better-sqlite3 peer

Wrong:

```bash
pnpm add @copilotkit/sqlite-runner
```

Correct:

```bash
pnpm add @copilotkit/sqlite-runner better-sqlite3
```

`@copilotkit/sqlite-runner` imports `better-sqlite3` at the top of its module, so if the peer
is missing, `import { SqliteAgentRunner } from "@copilotkit/sqlite-runner"` itself fails at
module load with `Cannot find module 'better-sqlite3'` — long before the constructor runs.
(The constructor has a friendlier multi-line install hint as a belt-and-suspenders fallback,
but in practice you will see the bare module-resolution error first.) It is a peer dependency,
not a direct dep.

Source: `packages/sqlite-runner/src/sqlite-runner.ts:18`, `:55-66`.

### HIGH Default SqliteAgentRunner with :memory: dbPath

Wrong:

```typescript
new SqliteAgentRunner();
```

Correct:

```typescript
new SqliteAgentRunner({ dbPath: "./data/threads.db" });
```

The default `dbPath` is `":memory:"` — SQLite's in-memory mode. Data is lost at restart,
defeating the reason to use the file-backed runner.

Source: `packages/sqlite-runner/src/sqlite-runner.ts:48-54`.

### MEDIUM Concurrent run() on the same threadId

Wrong:

```tsx
// Double-click send button → two POST /agent/:id/run to the same thread
<button onClick={() => agent.addMessage({ role: "user", content })}>
  Send
</button>
```

Correct:

```tsx
const [busy, setBusy] = useState(false);
<button
  disabled={busy}
  onClick={async () => {
    setBusy(true);
    try {
      await agent.addMessage({ role: "user", content });
    } finally {
      setBusy(false);
    }
  }}
>
  Send
</button>;
```

Both runners throw `"Thread already running"` on concurrent runs. Debounce on the client.
In Intelligence mode you can additionally handle `code === "agent_thread_locked"` in
`<CopilotKitProvider onError>`; SSE mode surfaces only a generic 500 with that message.

Source: `packages/runtime/src/v2/runtime/runner/in-memory.ts:110`;
`packages/core/src/intelligence-agent.ts:368-369`.

### HIGH In-memory runner + horizontal scaling

Wrong:

```typescript
// 3 Fly.io / Cloud Run instances, each with its own InMemoryAgentRunner
new CopilotRuntime({ agents });
```

Correct:

```typescript
// Either sticky-session a single instance per thread, or use shared state:
new CopilotRuntime({
  agents,
  runner: new SqliteAgentRunner({ dbPath: process.env.THREADS_DB! }),
});
// Best: Intelligence mode for managed multi-instance durability.
```

`InMemoryAgentRunner`'s `globalThis` store is per-process — multi-instance deploys see
totally different thread state per worker, making reconnects and `GET /connect` non-deterministic.

Source: `packages/runtime/src/v2/runtime/runner/in-memory.ts:63-96`.

## References

- [InMemoryAgentRunner — internals and hot-reload note](references/in-memory.md)
- [SqliteAgentRunner — schema, retention, ops](references/sqlite.md)
- [Custom runner — Redis/Postgres skeleton](references/custom-runner.md)

## See also

- `copilotkit/intelligence-mode` — managed durability alternative (Cloud-only)
- `copilotkit/setup-endpoint` — runner is passed via the CopilotRuntime constructor
- `copilotkit/scale-to-multi-agent` — horizontal scaling considerations
