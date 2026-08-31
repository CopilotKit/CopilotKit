# CopilotKit Intelligence Mode

Published version: https://docs.copilotkit.ai/premium/connect-your-runtime

Intelligence currently ships as a managed cloud service. The only supported `apiUrl` /
`wsUrl` today is the CopilotKit-managed cloud Intelligence instance — the `ɵ`-prefixed
runtime internals and REST/WebSocket contract that back Intelligence are still
stabilizing. `organizationId` is not part of `CopilotKitIntelligenceConfig` today — the key
alone scopes the project — and is reserved for future self-hosted deployments. If you
need on-prem durable threads today, use SSE mode with a persistent runner
(`SqliteAgentRunner` or a custom one) instead.

Obtain `apiKey` from the CopilotKit Intelligence dashboard, or let `copilotkit project select`
provision a project-scoped key into `.env` as `INTELLIGENCE_API_KEY`.

### URL format

**Omit `apiUrl` and `wsUrl`.** Both default to the managed platform
(`https://api.intelligence.copilotkit.ai` and
`wss://realtime.intelligence.copilotkit.ai`), so `apiKey` is the only URL-related
config you need. Never invent or guess these values — leaving them unset is always
correct against the managed service.

If you do set them (non-production or a future self-hosted deployment), the client
prepends `/api/...` and the Intelligence websocket layer derives `/runner` or
`/client` suffixes internally. Pass the bare base URLs — do NOT append `/api`,
`/socket`, `/runner`, or `/client` yourself:

```typescript
// Correct — bare base URLs, and note the two planes are DIFFERENT hosts
apiUrl: "https://api.intelligence.copilotkit.ai",
wsUrl:  "wss://realtime.intelligence.copilotkit.ai",

// Wrong — adding /api produces /api/api/... on every REST call; /socket/runner is not a real path
apiUrl: "https://api.intelligence.copilotkit.ai/api",
wsUrl:  "wss://realtime.intelligence.copilotkit.ai/socket",
```

`apiUrl` and `wsUrl` are **separate hosts** (`api.…` vs `realtime.…`), so you cannot
produce one from the other by swapping the scheme. Deriving `wsUrl` as
`apiUrl.replace(/^http/, "ws")` yields `wss://api.intelligence.copilotkit.ai`, which
serves no socket — and the resulting failure is a silent hang, not an error, because
the socket layer treats an unreachable host as a retryable reconnect. For the same
reason, override the two together or not at all: setting one alone leaves the other
plane on the managed host, which the client warns about at construction.

Source: `packages/runtime/src/v2/runtime/intelligence-platform/client.ts:41-46, 259,
356-357, 437, 468, 682-708`.

## Setup

```typescript
import {
  CopilotRuntime,
  CopilotKitIntelligence,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";

const intelligence = new CopilotKitIntelligence({
  // apiUrl / wsUrl default to cloud-hosted CopilotKit Intelligence — leave them unset.
  apiKey: process.env.INTELLIGENCE_API_KEY!,
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

`identifyUser` is for user identification only — it does NOT forward thrown `Response`s.
`resolveIntelligenceUser` (`handlers/shared/resolve-intelligence-user.ts:14-24`) wraps the
call in try/catch and converts any thrown value (including `Response`) into a generic
`errorResponse("Failed to identify user", 500)`. Gate auth in `hooks.onRequest`
(see the `middleware` skill) and keep `identifyUser` focused on returning an id:

```typescript
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { parse } from "cookie";

const runtime = new CopilotRuntime({
  agents,
  intelligence,
  // identifyUser returns the id; auth rejection is hooked elsewhere.
  identifyUser: async (request) => {
    const cookies = parse(request.headers.get("cookie") ?? "");
    const user = await resolveSession(cookies["session"]); // your auth lib
    return { id: user?.id ?? "anonymous" };
  },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
  hooks: {
    onRequest: async ({ request }) => {
      const cookies = parse(request.headers.get("cookie") ?? "");
      const user = await resolveSession(cookies["session"]);
      // onRequest DOES forward thrown Responses — use it for auth rejection.
      if (!user) throw new Response("Unauthorized", { status: 401 });
    },
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
import { CopilotKit } from "@copilotkit/react-core/v2";

export function App({ children }: { children: React.ReactNode }) {
  return <CopilotKit runtimeUrl="/api/copilotkit">{children}</CopilotKit>;
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

### CRITICAL Deriving wsUrl from apiUrl, adding /api or /socket suffixes, or pointing at an unsupported self-hosted server

Wrong:

```typescript
new CopilotKitIntelligence({
  apiUrl: "https://api.intelligence.copilotkit.ai",
  // Scheme-swapped from apiUrl — WRONG HOST. Serves no socket; hangs instead of erroring.
  wsUrl: apiUrl.replace(/^http/, "ws"),
  apiKey,
});

new CopilotKitIntelligence({
  apiUrl: "https://api.intelligence.copilotkit.ai/api", // double /api prefix
  wsUrl: "wss://realtime.intelligence.copilotkit.ai/socket", // /socket is not a real path
  apiKey,
});

new CopilotKitIntelligence({
  apiUrl: "https://internal.myco.com/intelligence", // self-hosting is not yet supported
  wsUrl: "wss://internal.myco.com/intelligence",
  apiKey,
});

new CopilotKitIntelligence({
  // Only one plane overridden — wsUrl silently stays on the managed host. Warns, then hangs.
  apiUrl: "https://api.intelligence.copilotkit.ai",
  apiKey,
});
```

Correct:

```typescript
new CopilotKitIntelligence({
  // No apiUrl / wsUrl — they default to the managed platform.
  apiKey: process.env.INTELLIGENCE_API_KEY!,
});
// For on-prem durability without Intelligence: SSE mode + SqliteAgentRunner.
```

Three failure modes to avoid:

1. The API and realtime planes are **different hosts**, so `wsUrl` cannot be derived
   from `apiUrl`. A scheme-only swap keeps the API host (and port) and produces a URL
   that serves no socket. This one is expensive to debug: a wrong `apiUrl` fails fast
   with an HTTP error, while a wrong `wsUrl` sits in `connecting` until the settle
   timeout and reports only "did not settle in time".
2. The client prepends `/api/...` to every REST call (`#request` at line 356-357) and
   the websocket layer derives `/runner` / `/client` suffixes from `wsUrl` internally.
   Passing `apiUrl: ".../api"` produces double-prefixed `/api/api/threads`; passing
   `wsUrl: ".../socket"` produces a broken `.../socket/runner` upgrade path.
3. Self-hosting Intelligence is not yet supported. The `ɵ`-prefixed runtime internals
   and REST/WebSocket contract are still stabilizing. `organizationId` is not a constructor
   option today; it is reserved for future self-hosted instances. For on-prem durable
   threads today, use SSE mode +
   `SqliteAgentRunner` (see `copilotkit/agent-runners`).

Source: `packages/runtime/src/v2/runtime/intelligence-platform/client.ts:41-46, 68-69,
259, 356-357, 437, 682-708`.

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
forces its own `IntelligenceAgentRunner` tied to the Intelligence service WebSocket; a user-supplied
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
`DELETE /threads/:id`, and `/threads/:id/messages` routes always resolve in the router,
but the handlers call `requireIntelligenceRuntime(runtime)` first and return HTTP 422
("Missing CopilotKitIntelligence configuration. Thread operations require a
CopilotKitIntelligence instance to be provided in CopilotRuntime options.") when the
runtime isn't an `IntelligenceRuntime`.

Source: `packages/runtime/src/v2/runtime/handlers/intelligence/threads.ts:37-48`;
route table in `dev-docs/architecture/setup-intelligence.md:179-183`.

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
LLM call on the Intelligence service side to generate a short name, billed against your Intelligence quota.

Source: `packages/runtime/src/v2/runtime/core/runtime.ts` (generateThreadNames default).

## See also

- `copilotkit/agent-runners` — Intelligence forces `IntelligenceAgentRunner`
- `copilotkit/setup-endpoint` — `/threads/*` routes flip on with Intelligence
- `copilotkit/threads` (react-core) — `useThreads` depends on Intelligence routes
