---
name: middleware
description: >
  Wire auth, logging, telemetry, and rate-limiting into the CopilotKit runtime via
  hooks.onRequest / onBeforeHandler / onResponse / onError on createCopilotRuntimeHandler
  (newer, route-aware, preferred) or the legacy beforeRequestMiddleware /
  afterRequestMiddleware on CopilotRuntime (backwards-compat, pre-routing). Covers throwing
  Response to short-circuit, route-aware authorization via onBeforeHandler({ route }), the
  non-blocking afterRequestMiddleware contract, and the discipline of delegating the
  auth/rate-limit/observability implementation to your server framework. This skill does NOT
  teach those cross-cutting concerns themselves.
type: core
library: copilotkit
library_version: "1.56.2"
requires:
  - copilotkit/setup-endpoint
sources:
  - "CopilotKit/CopilotKit:packages/runtime/src/v2/runtime/core/middleware.ts"
  - "CopilotKit/CopilotKit:packages/runtime/src/v2/runtime/core/hooks.ts"
  - "CopilotKit/CopilotKit:packages/runtime/src/v2/runtime/core/fetch-handler.ts"
---

# CopilotKit Runtime Middleware

Two coexisting middleware surfaces:

- **`hooks`** (preferred, newer) — pass to `createCopilotRuntimeHandler({ hooks })`.
  Route-aware via `onBeforeHandler({ route })`. Throw a `Response` to short-circuit.
- **`beforeRequestMiddleware` / `afterRequestMiddleware`** (legacy) — pass to
  `new CopilotRuntime({ ... })`. Runs before hooks in the same request. Pre-routing only.

Use **hooks** for new code.

## Setup

```typescript
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";

const runtime = new CopilotRuntime({
  agents: {
    /* ... */
  } as any,
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
  hooks: {
    onRequest: async ({ request }) => {
      const token = request.headers.get("authorization");
      if (!token) throw new Response("Unauthorized", { status: 401 });
    },
    onBeforeHandler: async ({ route, request }) => {
      if (route.method === "agent/run" && route.agentId === "admin") {
        const user = await verifyAdminToken(
          request.headers.get("authorization"),
        );
        if (!user) throw new Response("Forbidden", { status: 403 });
      }
    },
    onResponse: async ({ response }) => {
      const headers = new Headers(response.headers);
      headers.set("x-copilot-version", "2.0");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    },
    onError: async ({ error, route }) => {
      console.error("[copilotkit]", route?.method, error);
    },
  },
});

async function verifyAdminToken(
  header: string | null,
): Promise<{ id: string } | null> {
  if (!header) return null;
  // delegate to your auth lib
  return { id: "admin" };
}

export default { fetch: handler };
```

## Core Patterns

### Reject unauthenticated requests at the runtime boundary

```typescript
createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
  hooks: {
    onRequest: ({ request }) => {
      const token = request.headers.get("authorization");
      if (!token?.startsWith("Bearer ")) {
        throw new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
    },
  },
});
```

### Route-aware authorization

Use `onBeforeHandler` — the `route` object carries `method`, `agentId`, and (for thread/stop
methods) `threadId`.

```typescript
createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
  hooks: {
    onBeforeHandler: async ({ route, request }) => {
      if (route.method === "agent/run" && route.agentId === "billing") {
        const ok = await canAccessBilling(request);
        if (!ok) throw new Response("Forbidden", { status: 403 });
      }
    },
  },
});

async function canAccessBilling(request: Request): Promise<boolean> {
  // delegate to your policy engine
  return true;
}
```

### Rate-limit by calling an external limiter from the hook

Delegate to a dedicated lib — do not implement a rate limiter inline.

```typescript
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(60, "1 m"),
});

createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
  hooks: {
    onRequest: async ({ request }) => {
      const userId = request.headers.get("x-user-id") ?? "anon";
      const { success } = await ratelimit.limit(userId);
      if (!success) throw new Response("Too Many Requests", { status: 429 });
    },
  },
});
```

### Non-blocking telemetry on response

`afterRequestMiddleware` runs non-blocking (errors inside only log). Do not await heavy
work that the user's response waits on.

```typescript
import { CopilotRuntime } from "@copilotkit/runtime/v2";

const runtime = new CopilotRuntime({
  agents: {
    /* ... */
  } as any,
  afterRequestMiddleware: async ({ threadId, messages }) => {
    // fire-and-forget; do not await heavy work that blocks response
    void queue.enqueue({ type: "chat", threadId, messages });
  },
});
```

## Common Mistakes

### HIGH Returning a Response instead of throwing

Wrong:

```typescript
new CopilotRuntime({
  agents,
  beforeRequestMiddleware: async () =>
    new Response("Unauthorized", { status: 401 }),
});
```

Correct:

```typescript
new CopilotRuntime({
  agents,
  beforeRequestMiddleware: async ({ request }) => {
    if (!request.headers.get("authorization")) {
      throw new Response("Unauthorized", { status: 401 });
    }
  },
});
```

The middleware contract returns `Request | void`. Returning a Response corrupts the
request object — `fetch-handler.ts:140-147` assigns any truthy return value back to
`request`, so the router then tries to read `request.method` / `request.headers.get(...)`
from the Response and downstream handling blows up. Always `throw` a Response to
short-circuit; never return one.

Source: `packages/runtime/src/v2/runtime/core/fetch-handler.ts:140-156`.

### MEDIUM Defaulting to beforeRequestMiddleware when hooks are preferred

Wrong:

```typescript
new CopilotRuntime({
  agents,
  beforeRequestMiddleware: async ({ request, path }) => {
    if (path.includes("/agent/admin/")) {
      /* check admin auth */
    }
  },
});
```

Correct:

```typescript
const runtime = new CopilotRuntime({ agents });
const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
  hooks: {
    onBeforeHandler: ({ route, request }) => {
      if (route.method === "agent/run" && route.agentId === "admin") {
        /* ... */
      }
    },
  },
});
```

Both surfaces coexist. For new code the hook API on `createCopilotRuntimeHandler` is
preferred — `onBeforeHandler` receives typed `route` info, so you don't string-match paths.

Source: `packages/runtime/src/v2/runtime/core/hooks.ts:84-117`; maintainer Phase 4c.

### MEDIUM Route-specific auth in global beforeRequestMiddleware

Wrong:

```typescript
new CopilotRuntime({
  agents,
  beforeRequestMiddleware: async ({ path, request }) => {
    if (path.includes("/agent/admin/")) {
      /* ... */
    }
  },
});
```

Correct:

```typescript
createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
  hooks: {
    onBeforeHandler: ({ route, request }) => {
      if (route.method === "agent/run" && route.agentId === "admin") {
        /* ... */
      }
    },
  },
});
```

`beforeRequestMiddleware` fires before routing, so no route info exists yet — string-matching
paths is fragile. `onBeforeHandler` fires after routing with typed `route.method`, `route.agentId`.

Source: `packages/runtime/src/v2/runtime/core/hooks.ts:94-103`.

### MEDIUM Blocking on afterRequestMiddleware

Wrong:

```typescript
new CopilotRuntime({
  agents,
  afterRequestMiddleware: async ({ response, threadId, messages }) => {
    await heavyAnalytics(response, threadId, messages);
  },
});
```

Correct:

```typescript
new CopilotRuntime({
  agents,
  afterRequestMiddleware: async ({ response, threadId, messages }) => {
    void queue.enqueue({ type: "chat", threadId, messages, response });
  },
});
```

The `afterRequestMiddleware` callback receives
`{ runtime, response, path, messages?, threadId?, runId? }` — all these fields are always
available (`messages`/`threadId`/`runId` are populated from the SSE stream when present,
undefined otherwise). The hook runs non-blocking via `.catch()` so errors only log and any
heavy awaited work can be lost on process exit — fire-and-forget is the intended shape.

Source: `packages/runtime/src/v2/runtime/core/fetch-handler.ts:225-234`.

### MEDIUM Passing a webhook URL string as middleware

Wrong:

```typescript
new CopilotRuntime({
  agents,
  beforeRequestMiddleware: "https://hooks.example/auth" as any,
});
```

Correct:

```typescript
new CopilotRuntime({
  agents,
  beforeRequestMiddleware: async ({ request }) => {
    await fetch("https://hooks.example/auth", {
      method: "POST",
      body: request.headers.get("authorization") ?? "",
    });
  },
});
```

Webhook-URL middleware is dead code in v2 — the runtime logs
`"Unsupported beforeRequestMiddleware value – skipped"` and does nothing. Only function
middleware is wired.

Source: `packages/runtime/src/v2/runtime/core/middleware.ts:72-87`.

### HIGH Implementing auth / rate-limit inside CopilotKit middleware

Wrong:

```typescript
new CopilotRuntime({
  agents,
  beforeRequestMiddleware: async ({ request }) => {
    // hand-rolling a token-bucket rate limiter inline with Redis calls...
  },
});
```

Correct:

```typescript
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(60, "1 m"),
});

new CopilotRuntime({
  agents,
  beforeRequestMiddleware: async ({ request }) => {
    const { success } = await ratelimit.limit(
      request.headers.get("x-user-id") ?? "anon",
    );
    if (!success) throw new Response("Too Many Requests", { status: 429 });
  },
});
```

Auth, rate-limiting, and observability are server-framework concerns. CopilotKit middleware
is the hook to invoke them, not a replacement.

Source: maintainer interview (Phase 2c).

## See also

- `copilotkit/setup-endpoint` — `hooks` are passed to `createCopilotRuntimeHandler`
- `copilotkit/go-to-production` — production checklist lists auth/rate-limit wiring
- `copilotkit/debug-and-troubleshoot` — `onError` telemetry pattern
