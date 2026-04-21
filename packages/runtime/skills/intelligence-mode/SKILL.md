---
name: intelligence-mode
description: >
  Enable durable threads, realtime websocket transport, and managed multi-instance durability
  by pointing CopilotKitIntelligence at CopilotKit Cloud (api.cloud.copilotkit.ai). Intelligence
  is a Cloud-only hosted service — it is NOT self-hostable. Covers CopilotKitIntelligence
  client config ({ apiUrl, wsUrl, apiKey, organizationId }), the required identifyUser
  callback, lockTtlSeconds / lockHeartbeatIntervalSeconds clamps (3600 / 3000), the
  generateThreadNames default (true) that triggers a naming LLM call per new thread, the
  /threads/* route family that only exists in Intelligence mode, and the /info handshake
  that tells the frontend to flip transport.
type: core
library: copilotkit
library_version: "1.56.2"
requires:
  - copilotkit/setup-endpoint
  - copilotkit/agent-runners
sources:
  - "CopilotKit/CopilotKit:packages/runtime/src/v2/runtime/intelligence-platform/client.ts"
  - "CopilotKit/CopilotKit:packages/runtime/src/v2/runtime/core/runtime.ts"
  - "CopilotKit/CopilotKit:packages/runtime/src/v2/runtime/runner/intelligence.ts"
---

# CopilotKit Intelligence Mode

Intelligence is a hosted Cloud service. Pointing `apiUrl` / `wsUrl` at anything other than
`api.cloud.copilotkit.ai` will fail — the runtime internals that back Intelligence are
private (`ɵ`-prefixed methods). If you need on-prem durable threads, use SSE mode with a
persistent runner (`SqliteAgentRunner` or a custom one) instead.

Obtain `apiKey` and `organizationId` from the CopilotKit Cloud dashboard at
`cloud.copilotkit.ai`.

## Setup

```typescript
import {
  CopilotRuntime,
  CopilotKitIntelligence,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";

const intelligence = new CopilotKitIntelligence({
  apiUrl: "https://api.cloud.copilotkit.ai/api",
  wsUrl: "wss://api.cloud.copilotkit.ai/socket",
  apiKey: process.env.COPILOTKIT_CLOUD_API_KEY!,
  organizationId: process.env.COPILOTKIT_CLOUD_ORG_ID!,
});

const runtime = new CopilotRuntime({
  agents: {
    /* ... */
  } as any,
  intelligence,
  identifyUser: (request) => ({
    id: request.headers.get("x-user-id") ?? "anonymous",
  }),
  // Optional tuning:
  generateThreadNames: true, // default true — 1 LLM call per new thread
  lockTtlSeconds: 20, // clamped to ≤ 3600
  lockHeartbeatIntervalSeconds: 15, // clamped to ≤ 3000
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export default { fetch: handler };
```

When `intelligence` is set, the runtime auto-wires `IntelligenceAgentRunner` internally.
Do NOT pass `runner` — see the failure-modes section.

## Core Patterns

### Identify the user from an auth cookie

```typescript
import { CopilotRuntime } from "@copilotkit/runtime/v2";
import { parse } from "cookie";

const runtime = new CopilotRuntime({
  agents,
  intelligence,
  identifyUser: async (request) => {
    const cookies = parse(request.headers.get("cookie") ?? "");
    const session = cookies["session"];
    const user = await resolveSession(session); // your auth lib
    if (!user) throw new Response("Unauthorized", { status: 401 });
    return { id: user.id };
  },
});

async function resolveSession(token: string | undefined) {
  if (!token) return null;
  return { id: "user-123" };
}
```

### Disable thread-name generation to avoid a per-thread LLM call

```typescript
new CopilotRuntime({
  agents,
  intelligence,
  identifyUser: (req) => ({ id: req.headers.get("x-user-id")! }),
  generateThreadNames: false,
});
```

### Frontend — no config change

The frontend reads `GET /info` on mount. When the runtime reports `mode: "intelligence"`
and an `intelligence.wsUrl`, `CopilotKitCore` auto-switches from SSE to the websocket
transport. The React integration just points at the runtime URL:

```tsx
import { CopilotKitProvider } from "@copilotkit/react-core/v2";

export function App({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit">
      {children}
    </CopilotKitProvider>
  );
}
```

## Common Mistakes

### CRITICAL Missing identifyUser

Wrong:

```typescript
new CopilotRuntime({ agents, intelligence });
```

Correct:

```typescript
new CopilotRuntime({
  agents,
  intelligence,
  identifyUser: (req) => ({ id: req.headers.get("x-user-id")! }),
});
```

`identifyUser` is required on `CopilotIntelligenceRuntimeOptions` — omitting it is a
TypeScript error and (if suppressed) crashes handlers at request time. Every thread is
scoped to a user ID.

Source: `packages/runtime/src/v2/runtime/core/runtime.ts:156-160`.

### CRITICAL Pointing apiUrl / wsUrl at a self-hosted server

Wrong:

```typescript
new CopilotKitIntelligence({
  apiUrl: "https://internal.myco.com/intelligence/api",
  wsUrl: "wss://internal.myco.com/intelligence/socket",
  apiKey,
  organizationId,
});
```

Correct:

```typescript
new CopilotKitIntelligence({
  apiUrl: "https://api.cloud.copilotkit.ai/api",
  wsUrl: "wss://api.cloud.copilotkit.ai/socket",
  apiKey: process.env.COPILOTKIT_CLOUD_API_KEY!,
  organizationId: process.env.COPILOTKIT_CLOUD_ORG_ID!,
});
// For on-prem durability without Intelligence: SSE mode + SqliteAgentRunner.
```

Intelligence is NOT self-hostable. The `ɵ`-prefixed runtime internals and REST/WebSocket
contract are private. Self-hosting attempts will fail at handshake or WebSocket upgrade.
The alternative for on-prem durable threads is SSE mode + `SqliteAgentRunner` (see the
`copilotkit/agent-runners` skill).

Source: `packages/runtime/src/v2/runtime/intelligence-platform/client.ts:246-708`;
maintainer Phase 4 (Cloud-only).

### HIGH Setting runner alongside intelligence

Wrong:

```typescript
import { SqliteAgentRunner } from "@copilotkit/sqlite-runner";

new CopilotRuntime({
  agents,
  intelligence,
  runner: new SqliteAgentRunner({ dbPath: "./threads.db" }),
});
```

Correct:

```typescript
new CopilotRuntime({
  agents,
  intelligence,
  identifyUser,
});
```

`CopilotIntelligenceRuntimeOptions` excludes `runner` at the type level. Intelligence
forces its own `IntelligenceAgentRunner` tied to the Cloud WebSocket; a user-supplied
runner is rejected.

Source: `packages/runtime/src/v2/runtime/core/runtime.ts:149-173,285-294`.

### HIGH Calling /threads against an SSE-mode runtime

Wrong:

```typescript
// SSE-only runtime (no `intelligence` configured)
await fetch("/api/copilotkit/threads");
```

Correct:

```typescript
// Enable Intelligence mode first, OR don't call thread routes.
// Client-side, the useThreads hook errors with "Runtime URL is not configured" when
// the runtime isn't in Intelligence mode.
```

The `/threads`, `/threads/subscribe`, `PATCH /threads/:id`, `POST /threads/:id/archive`,
`DELETE /threads/:id`, and `/threads/:id/messages` routes only register when the runtime
is an `IntelligenceRuntime`. In SSE mode they return 404.

Source: `dev-docs/architecture/setup-intelligence.md:173-188`.

### LOW Over-clamping lockTtlSeconds

Wrong:

```typescript
new CopilotRuntime({
  agents,
  intelligence,
  identifyUser,
  lockTtlSeconds: 86400, // "I want 1-day lock"
});
```

Correct:

```typescript
new CopilotRuntime({
  agents,
  intelligence,
  identifyUser,
  lockTtlSeconds: 3600, // max is 1 hour
});
// Rethink long-running workflows if 1 hour is insufficient.
```

`lockTtlSeconds` is silently `Math.min(value, 3600)`; `lockHeartbeatIntervalSeconds` is
`Math.min(value, 3000)`. Requests over the cap are clamped without warning.

Source: `packages/runtime/src/v2/runtime/core/runtime.ts:281-307`.

### MEDIUM generateThreadNames unset expecting no LLM cost

Wrong:

```typescript
new CopilotRuntime({ agents, intelligence, identifyUser });
// assumes no extra LLM spend
```

Correct:

```typescript
new CopilotRuntime({
  agents,
  intelligence,
  identifyUser,
  generateThreadNames: false,
});
```

`generateThreadNames` defaults to `true`. Every newly created thread triggers an extra
LLM call on the Cloud side to generate a short name, billed against your Cloud quota.

Source: `packages/runtime/src/v2/runtime/core/runtime.ts` (generateThreadNames default).

## See also

- `copilotkit/agent-runners` — Intelligence forces `IntelligenceAgentRunner`
- `copilotkit/setup-endpoint` — `/threads/*` routes flip on with Intelligence
- `copilotkit/threads` (react-core) — `useThreads` depends on Intelligence routes
