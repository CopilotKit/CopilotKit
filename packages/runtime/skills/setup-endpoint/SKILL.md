---
name: setup-endpoint
description: >
  Mount a CopilotKit runtime on any JS server via createCopilotRuntimeHandler — the canonical
  fetch-based primitive that works on Cloudflare Workers, Bun, Deno, Vercel Edge, React Router
  v7 loader/action, TanStack Start server routes, and Next.js App Router. Express/Hono are
  supported only by delegating from their route handlers to the fetch primitive — the
  createCopilotExpressHandler and createCopilotHonoHandler adapters are discouraged. Covers
  basePath, multi-route vs single-route mode, CORS, and the /info, /agent/:id/run,
  /agent/:id/connect, /agent/:id/stop/:threadId, /transcribe, /threads/* route table.
type: core
library: copilotkit
library_version: "1.56.2"
requires: []
sources:
  - "CopilotKit/CopilotKit:packages/runtime/src/v2/runtime/core/fetch-handler.ts"
  - "CopilotKit/CopilotKit:packages/runtime/src/v2/runtime/core/hooks.ts"
  - "CopilotKit/CopilotKit:packages/runtime/src/v2/runtime/endpoints/express.ts"
  - "CopilotKit/CopilotKit:packages/runtime/src/v2/runtime/endpoints/hono.ts"
  - "CopilotKit/CopilotKit:packages/runtime/src/v2/runtime/endpoints/node.ts"
---

# CopilotKit Runtime Endpoint

`createCopilotRuntimeHandler` is the strongly-preferred primitive. It returns a
`(Request) => Promise<Response>` that works in every fetch-native runtime and can be
delegated to from Express/Hono/Node. Avoid `createCopilotExpressHandler` and
`createCopilotHonoHandler` in new code.

## Setup

Minimal runtime on any fetch server (Bun, Deno, Cloudflare Workers, Vercel Edge):

```typescript
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  BuiltInAgent,
  convertInputToTanStackAI,
} from "@copilotkit/runtime/v2";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";

const runtime = new CopilotRuntime({
  agents: {
    default: new BuiltInAgent({
      type: "tanstack",
      factory: ({ input, abortController }) => {
        const { messages, systemPrompts } = convertInputToTanStackAI(input);
        return chat({
          adapter: openaiText("gpt-4o"),
          messages,
          systemPrompts,
          abortController,
        });
      },
    }),
  },
});

export const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
  cors: true,
});

// Bun / Deno / Vercel Edge:
//   Bun.serve({ fetch: handler });
//   Deno.serve(handler);
// Cloudflare Workers:
//   export default { fetch: handler };
```

## Core Patterns

### React Router v7 framework mode

```typescript
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

const runtime = new CopilotRuntime({
  agents: {
    default: new BuiltInAgent({
      type: "tanstack",
      factory: ({ input, abortController }) => {
        const { messages, systemPrompts } = convertInputToTanStackAI(input);
        return chat({
          adapter: openaiText("gpt-4o"),
          messages,
          systemPrompts,
          abortController,
        });
      },
    }),
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

### Next.js App Router

```typescript
// app/api/copilotkit/[...slug]/route.ts
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  BuiltInAgent,
  convertInputToTanStackAI,
} from "@copilotkit/runtime/v2";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";

const runtime = new CopilotRuntime({
  agents: {
    default: new BuiltInAgent({
      type: "tanstack",
      factory: ({ input, abortController }) => {
        const { messages, systemPrompts } = convertInputToTanStackAI(input);
        return chat({
          adapter: openaiText("gpt-4o"),
          messages,
          systemPrompts,
          abortController,
        });
      },
    }),
  },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handler;
export const POST = handler;
export const OPTIONS = handler;
```

### Cloudflare Workers with env-sourced keys

```typescript
// worker.ts
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  BuiltInAgent,
  convertInputToTanStackAI,
} from "@copilotkit/runtime/v2";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";

interface Env {
  OPENAI_API_KEY: string;
}

export default {
  fetch(request: Request, env: Env) {
    const runtime = new CopilotRuntime({
      agents: {
        default: new BuiltInAgent({
          type: "tanstack",
          factory: ({ input, abortController }) => {
            const { messages, systemPrompts } = convertInputToTanStackAI(input);
            return chat({
              adapter: openaiText("gpt-4o", { apiKey: env.OPENAI_API_KEY }),
              messages,
              systemPrompts,
              abortController,
            });
          },
        }),
      },
    });
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api/copilotkit",
      cors: true,
    });
    return handler(request);
  },
};
```

### Delegate from Express / Hono to the fetch primitive

Do not use `createCopilotExpressHandler` / `createCopilotHonoHandler`.

```typescript
// Express
import express from "express";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";

const app = express();
const runtime = new CopilotRuntime({
  agents: {
    /* ... */
  } as any,
});
const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

app.all("/api/copilotkit/*", async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const webReq = new Request(url, {
    method: req.method,
    headers: req.headers as any,
    body: ["GET", "HEAD"].includes(req.method!) ? undefined : req,
    duplex: "half",
  } as any);
  const webRes = await handler(webReq);
  res.status(webRes.status);
  webRes.headers.forEach((v, k) => res.setHeader(k, v));
  const body = await webRes.arrayBuffer();
  res.end(Buffer.from(body));
});

app.listen(3000);
```

```typescript
// Hono — already speaks Request/Response
import { Hono } from "hono";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";

const app = new Hono();
const runtime = new CopilotRuntime({
  agents: {
    /* ... */
  } as any,
});
const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

app.all("/api/copilotkit/*", (c) => handler(c.req.raw));

export default app;
```

### Route table

Multi-route mode (default) exposes: `GET /info`, `POST /agent/:agentId/run`,
`GET /agent/:agentId/connect`, `POST /agent/:agentId/stop/:threadId`, `POST /transcribe`,
`GET/POST /threads`, `GET /threads/subscribe`, `PATCH /threads/:threadId`,
`POST /threads/:threadId/archive`, `DELETE /threads/:threadId`,
`GET /threads/:threadId/messages`. Thread routes are only wired when Intelligence mode
is configured.

Single-route mode exposes a single `POST basePath` that accepts
`{ method, params, body }` envelopes — use when behind a strict reverse proxy.

## Common Mistakes

### CRITICAL Using createCopilotExpressHandler / createCopilotHonoHandler in new code

Wrong:

```typescript
import { createCopilotExpressHandler } from "@copilotkit/runtime/v2/express";
app.use(
  "/api/copilotkit",
  createCopilotExpressHandler({ runtime, basePath: "/api/copilotkit" }),
);
```

Correct:

```typescript
import { createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";
const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});
app.all("/api/copilotkit/*", async (req, res) => {
  const webReq = new Request(new URL(req.url, `http://${req.headers.host}`), {
    method: req.method,
    headers: req.headers as any,
    body: ["GET", "HEAD"].includes(req.method!) ? undefined : req,
    duplex: "half",
  } as any);
  const webRes = await handler(webReq);
  res.status(webRes.status);
  webRes.headers.forEach((v, k) => res.setHeader(k, v));
  res.end(Buffer.from(await webRes.arrayBuffer()));
});
```

The Express and Hono adapters are a discouraged surface — the maintainer flags them as
"avoid at all costs." They pull in heavier dependencies, add framework binding, and make
it harder to port. The fetch handler works from any Express/Hono route.

Source: `packages/runtime/src/v2/runtime/core/fetch-handler.ts:1-27`; maintainer Phase 4d.

### CRITICAL Instantiating Express handler without basePath

Wrong:

```typescript
app.use(createCopilotExpressHandler({ runtime }));
```

Correct:

```typescript
const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});
app.all("/api/copilotkit/*", (req, res) => {
  /* delegate as shown above */
});
```

`normalizeBasePath` throws `"basePath must be provided for Express endpoint"` at mount time
and crashes the server.

Source: `packages/runtime/src/v2/runtime/endpoints/express.ts:161`.

### HIGH Using framework adapter on Workers / Bun / Deno

Wrong:

```typescript
// Cloudflare Worker
import { createCopilotHonoHandler } from "@copilotkit/runtime/v2/hono";
export default app;
```

Correct:

```typescript
import { createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";
const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});
export default { fetch: (req: Request) => handler(req) };
```

Adapters bundle Node polyfills unnecessarily in fetch-native runtimes.

Source: `packages/runtime/src/v2/runtime/core/fetch-handler.ts:1-27`.

### HIGH Returning a Response from beforeRequestMiddleware

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
const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
  hooks: {
    onRequest: ({ request }) => {
      if (!request.headers.get("authorization")) {
        throw new Response("Unauthorized", { status: 401 });
      }
    },
  },
});
```

Only `Request | void` returns are honored. Any other return is ignored. Responses must be
thrown.

Source: `packages/runtime/src/v2/runtime/core/fetch-handler.ts:148-156`.

### MEDIUM Calling multi-route paths against a single-route handler

Wrong:

```typescript
// handler = createCopilotRuntimeHandler({ mode: "single-route", ... })
fetch("/api/copilotkit/agent/x/run", {
  method: "POST",
  body: JSON.stringify(input),
});
```

Correct:

```typescript
fetch("/api/copilotkit", {
  method: "POST",
  body: JSON.stringify({
    method: "agent/run",
    params: { agentId: "x" },
    body: input,
  }),
});
// On the client, pair with <CopilotKitProvider useSingleEndpoint />.
```

Single-route expects a POST envelope with `{ method, params, body }`; URL-pattern calls 404.

Source: `packages/runtime/src/v2/runtime/core/fetch-handler.ts:86-90,350-401`.

### MEDIUM Double-layering CORS in Express

Wrong:

```typescript
import cors from "cors";
app.use(cors());
app.use(
  createCopilotExpressHandler({ runtime, basePath, cors: { origin: "..." } }),
);
```

Correct:

```typescript
// Pick one — handler's cors option OR your own cors(), not both:
const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
  cors: { origin: "https://my.app" },
});
app.all("/api/copilotkit/*", (req, res) => {
  /* delegate as above */
});
```

Both layers add CORS headers and the duplicates break strict browser enforcement.

Source: `packages/runtime/src/v2/runtime/endpoints/express.ts:100-143`.

### HIGH Mixing v1 and v2 import paths

Wrong:

```typescript
import { CopilotRuntime } from "@copilotkit/runtime";
import { createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";
```

Correct:

```typescript
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
```

Both v1 and v2 APIs compile together but route through different implementations. Always
use the `/v2` subpath in v2 code.

Source: `packages/runtime/src/v2/index.ts`.

## See also

- `copilotkit/middleware` — hook lifecycle into this handler
- `copilotkit/agent-runners` — pair with a persistent runner for production
- `copilotkit/intelligence-mode` — thread routes flip on when Intelligence is configured
