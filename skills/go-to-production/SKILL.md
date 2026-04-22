---
name: go-to-production
description: >
  Pre-deploy checklist for CopilotKit v2 apps — persistent AgentRunner (not
  InMemory) behind horizontal scaling, CORS, showDevConsole off, debug off,
  credentials:'include' for cookie auth, env-sourced secrets on edge
  runtimes, publicApiKey / licenseToken, dev-only-prop audit
  (agents__unsafe_dev_only, selfManagedAgents). Pointer skill —
  does NOT teach auth, rate-limit, or observability (those are server-
  framework concerns wired via the middleware skill). Load before any first
  production deploy of a CopilotKit v2 app.
type: lifecycle
library: copilotkit
library_version: "1.56.2"
requires:
  - copilotkit/runtime
  - copilotkit/react-core
  - copilotkit/debug-and-troubleshoot
sources:
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/providers/CopilotKitProvider.tsx"
  - "CopilotKit/CopilotKit:packages/core/src/core/core.ts"
  - "CopilotKit/CopilotKit:examples/v2/runtime/node/src/index.ts"
  - "CopilotKit/CopilotKit:examples/v2/runtime/cf-workers/src/index.ts"
  - "CopilotKit/CopilotKit:docs/snippets/shared/troubleshooting/error-debugging.mdx"
  - "CopilotKit/CopilotKit:docs/snippets/shared/troubleshooting/debug-mode.mdx"
---

# CopilotKit v2 — Go-Live Checklist

Run through each section before deploying. This is a pointer skill — each
check delegates to the skill that owns the detail.

## Persistent Runner Checks

### Check: runner is NOT InMemoryAgentRunner under horizontal scale

Expected:

```ts
import { CopilotRuntime } from "@copilotkit/runtime/v2";
import { SqliteAgentRunner } from "@copilotkit/sqlite-runner";

new CopilotRuntime({
  agents,
  runner: new SqliteAgentRunner({ dbPath: "/var/data/threads.db" }),
});
```

Fail condition: runtime uses the default `InMemoryAgentRunner` (or passes
one explicitly) while the deployment has more than one replica or any
restart-surviving requirement.
Fix: switch to `SqliteAgentRunner` (single-host durable) or
CopilotKitIntelligence (multi-host durable). See `copilotkit/agent-runners`.

### Check: Intelligence mode points at cloud URLs if enabled

Expected:

```ts
// Node / server runtime — `env` here is Node's `process.env`:
new CopilotRuntime({
  agents,
  intelligence: {
    apiUrl: "https://api.cloud.copilotkit.ai",
    wsUrl: "wss://api.cloud.copilotkit.ai",
    licenseToken: process.env.COPILOTKIT_LICENSE_TOKEN,
  },
});
```

Fail condition: `apiUrl` points to a self-hosted URL — Intelligence is not
self-hostable.
Fix: use Cloud URLs or downgrade to SqliteAgentRunner for on-prem
durability. See `copilotkit/intelligence-mode`.

## CORS Checks

### Check: cross-origin deployments enable CORS on the fetch handler

Expected:

```ts
const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
  cors: true,
});
```

Fail condition: frontend and runtime are on different origins, and `cors`
is not enabled (or is not equivalently handled by a reverse proxy / CDN).
Fix: set `cors: true` on `createCopilotRuntimeHandler`, or handle CORS at
the proxy layer. See `copilotkit/setup-endpoint`.

## Debug Checks

### Check: showDevConsole is off in production

Expected:

```tsx
<CopilotKitProvider runtimeUrl="/api/copilotkit" showDevConsole="auto" />
```

Fail condition: `showDevConsole={true}` hardcoded — internal error details
render to end users.
Fix: use `"auto"` (the default), or gate on `NODE_ENV`.

### Check: debug prop is off (or dev-only)

Expected:

```tsx
<CopilotKitProvider
  runtimeUrl="/api/copilotkit"
  debug={process.env.NODE_ENV !== "production"}
/>
```

Fail condition: `debug={{ events: true, lifecycle: true, verbose: true }}`
shipped to prod — large log volume and verbose logs can include PII
payloads.
Fix: gate `debug` on environment, or omit it entirely.

### Check: runtime debug is off

Expected:

```ts
new CopilotRuntime({
  agents,
  debug: process.env.NODE_ENV !== "production",
});
```

Fail condition: `debug: true` or `{ verbose: true }` shipped — Pino logs
expand in volume and may include tool-call payloads.
Fix: gate on environment. See `copilotkit/debug-and-troubleshoot`.

## Credentials / Auth Checks

### Check: cookie-based auth sets credentials:'include'

Expected:

```tsx
<CopilotKitProvider
  runtimeUrl="https://api.myapp.com/copilotkit"
  credentials="include"
/>
```

Fail condition: cross-origin runtime with cookie-session auth, no
`credentials="include"` — browsers strip cookies and `/info` plus the SSE
stream go unauthenticated.
Fix: add `credentials="include"`, and set CORS on the runtime to allow
credentials. See `copilotkit/provider-setup`.

### Check: auth / rate-limit / observability wired through middleware

Expected:

```ts
new CopilotRuntime({
  agents,
  hooks: {
    onBeforeHandler: async ({ request }) => {
      const session = await getSession(request);
      if (!session) return new Response("Unauthorized", { status: 401 });
    },
  },
});
```

Fail condition: ad-hoc auth checks inside tool handlers instead of hook /
middleware.
Fix: centralize auth in `hooks.onBeforeHandler` or
`beforeRequestMiddleware`. CopilotKit does NOT ship auth, rate-limit, or
observability — use your server framework's tooling. See
`copilotkit/middleware`.

## License Checks

### Check: publicApiKey is env-sourced, not hardcoded

Expected:

```tsx
<CopilotKitProvider publicApiKey={import.meta.env.VITE_CPK_PUBLIC_API_KEY} />
```

Fail condition: key inlined as a string literal in committed source.
Fix: read from build-time env (`VITE_*`, `NEXT_PUBLIC_*`, etc.) and inject
via CI. `publicLicenseKey` is also accepted as an alias
(`publicApiKey ?? publicLicenseKey`); prefer `publicApiKey` for
consistency with the HTTP header (`X-CopilotCloud-Public-Api-Key`) and
Cloud dashboard label.

### Check: runtime licenseToken is env-sourced

Expected (Node / server runtime):

```ts
new CopilotRuntime({
  agents,
  licenseToken: process.env.COPILOTKIT_LICENSE_TOKEN,
});
```

On Cloudflare Workers, `env` here refers to the Worker binding argument
passed to `fetch(request, env)` — not a module-global.

Fail condition: license token hardcoded in source or absent in prod.
Fix: inject via environment variable. See `copilotkit/setup-endpoint`.

## Env-Sourced Secrets Checks

### Check: edge runtimes use env binding, not process.env

Expected (Cloudflare Workers — runtime hoisted to module scope, lazy init):

```ts
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  BuiltInAgent,
} from "@copilotkit/runtime/v2";

interface Env {
  OPENAI_API_KEY: string;
}

let cachedHandler: ((r: Request) => Response | Promise<Response>) | null = null;

function getHandler(env: Env) {
  if (cachedHandler) return cachedHandler;
  const runtime = new CopilotRuntime({
    agents: {
      // Thread env.OPENAI_API_KEY explicitly — `process.env` is undefined on
      // Workers, so BuiltInAgent's env-var fallback never fires.
      default: new BuiltInAgent({
        model: "openai/gpt-4o",
        apiKey: env.OPENAI_API_KEY,
      }),
    },
  });
  cachedHandler = createCopilotRuntimeHandler({
    runtime,
    basePath: "/api/copilotkit",
    cors: true,
  });
  return cachedHandler;
}

export default {
  fetch(request: Request, env: Env) {
    return getHandler(env)(request);
  },
};
```

Fail condition: Workers / Vercel Edge code reads `process.env.*` — those
runtimes don't expose it. Also: constructing `new CopilotRuntime(...)`
inside `fetch(request, env)` on every request wastes CPU and drops
in-memory runner state.
Fix: use the platform's env argument (Workers `env`, Vercel Edge
`request.env`), and hoist the runtime + handler to module scope. Workers
isolates reuse module globals across requests (in-isolate only — for
cross-isolate durability pair with `SqliteAgentRunner` or Intelligence).
See `copilotkit/0-to-working-chat`.

## Dev-Only-Prop Audit

### Check: no agents\_\_unsafe_dev_only in shipped client code

Expected:

```tsx
<CopilotKitProvider runtimeUrl="/api/copilotkit" />
// or
<CopilotKitProvider publicApiKey="ck_pub_..." />
```

Fail condition: any `agents__unsafe_dev_only={{ ... }}` prop in shipped
client code — registers agents in the browser and leaks credentials.
Fix: move agent construction to the server (runtime) or use
`publicApiKey` (Cloud). See `copilotkit/spa-without-runtime`.

### Check: no selfManagedAgents in shipped client code

Fail condition: any `selfManagedAgents={{ ... }}` prop. It's an alias of
`agents__unsafe_dev_only` — same leak.
Fix: same as above.

### Check: publicApiKey / publicLicenseKey are env-sourced and consistent

Both props are supported — `publicApiKey` is canonical and wins when both
are set (`resolvedPublicKey = publicApiKey ?? publicLicenseKey`). Prefer
`publicApiKey` in new code. The only fail condition here is a hardcoded
string literal — see "Check: publicApiKey is env-sourced, not hardcoded"
above. See `copilotkit/v1-to-v2-migration` for v1 → v2 rename details.

## Common Production Mistakes

### CRITICAL InMemoryAgentRunner behind horizontal scaling

Wrong:

```ts
// Kubernetes 3 replicas, default runner
new CopilotRuntime({ agents });
```

Correct:

```ts
new CopilotRuntime({
  agents,
  runner: new SqliteAgentRunner({ dbPath: "/var/data/threads.db" }),
});
```

Thread state is per-instance in InMemory; the load balancer may send a
follow-up request to a different replica → `agent_thread_locked` on one
replica and empty state on another.

Source: packages/runtime/src/v2/runtime/runner/in-memory.ts; packages/core/src/core/core.ts:96

### CRITICAL showDevConsole=true in prod

Wrong:

```tsx
<CopilotKitProvider showDevConsole={true} />
```

Correct:

```tsx
<CopilotKitProvider showDevConsole="auto" />
```

Exposes internal error details (stack traces, troubleshooting links) to
end users.

Source: docs/snippets/shared/troubleshooting/error-debugging.mdx:22-24

### HIGH shipping debug:{verbose:true} in prod

Wrong:

```tsx
<CopilotKitProvider debug={{ events: true, lifecycle: true, verbose: true }} />
```

Correct:

```tsx
<CopilotKitProvider debug={process.env.NODE_ENV !== "production"} />
```

`verbose` expands event payloads into logs — can include PII. Large log
volume as a secondary concern.

Source: docs/snippets/shared/troubleshooting/debug-mode.mdx:145-149

### HIGH forgetting credentials:'include' with cookie auth

Wrong:

```tsx
<CopilotKitProvider runtimeUrl="https://api.myapp.com/copilotkit" />
```

Correct:

```tsx
<CopilotKitProvider
  runtimeUrl="https://api.myapp.com/copilotkit"
  credentials="include"
/>
```

Cross-origin browsers strip cookies by default; `/info` and SSE stream go
unauthenticated.

Source: packages/react-core/src/v2/providers/CopilotKitProvider.tsx:118-120

### HIGH process.env secrets on Cloudflare Workers

Wrong:

```ts
const agent = new BuiltInAgent({ apiKey: process.env.OPENAI_API_KEY });
```

Correct: see `copilotkit/0-to-working-chat` (Cloudflare branch) — use
the `env` binding argument.

Source: examples/v2/runtime/cf-workers/src/index.ts:7-17

## Pre-Deploy Summary

- [ ] Runner is persistent (SQLite or Intelligence) for >1 replica
- [ ] CORS enabled (or proxied) on cross-origin runtime
- [ ] `showDevConsole` is `"auto"` (or omitted)
- [ ] `debug` on provider and runtime is off or dev-gated
- [ ] `credentials="include"` set if runtime is cross-origin and uses cookies
- [ ] Auth / rate-limit / observability wired via `hooks` or middleware
- [ ] `publicApiKey` / `licenseToken` sourced from env vars (not hardcoded)
- [ ] Edge runtimes read secrets from env binding, not `process.env`
- [ ] Cloudflare Workers: runtime + handler hoisted to module scope, not
      re-created per-request
- [ ] `agents__unsafe_dev_only` and `selfManagedAgents` absent from bundle
- [ ] Error codes handled: `agent_thread_locked`, `runtime_info_fetch_failed`,
      `agent_run_failed` (see `copilotkit/debug-and-troubleshoot`)
