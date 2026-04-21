---
name: 0-to-working-chat
description: >
  End-to-end quickstart for CopilotKit v2 — scaffold, mount the runtime, mount
  the provider, render chat, add the first tool. Canonical framework order is
  React Router v7 framework mode → TanStack Start → Next.js App Router, plus
  an SPA-without-runtime branch. Every branch uses createCopilotRuntimeHandler
  (the fetch primitive) — avoid createCopilotExpressHandler /
  createCopilotHonoHandler. Factory Mode BuiltInAgent with TanStack AI is the
  preferred default. Load when bootstrapping a new CopilotKit v2 app, adding
  runtime to an existing React app, or deciding which framework branch to
  wire.
type: lifecycle
library: copilotkit
library_version: "1.56.2"
requires:
  - copilotkit/setup-endpoint
  - copilotkit/built-in-agent
  - copilotkit/provider-setup
  - copilotkit/chat-components
  - copilotkit/client-side-tools
sources:
  - "CopilotKit/CopilotKit:examples/v2/react-router/app/routes/api.copilotkit.$.tsx"
  - "CopilotKit/CopilotKit:examples/v2/react-router/app/routes/_index.tsx"
  - "CopilotKit/CopilotKit:examples/v2/runtime/node/src/index.ts"
  - "CopilotKit/CopilotKit:examples/v2/runtime/cf-workers/src/index.ts"
  - "CopilotKit/CopilotKit:packages/cli/src/commands/create.ts"
  - "CopilotKit/CopilotKit:docs/snippets/shared/troubleshooting/common-issues.mdx"
---

## Setup

One agent, one tool, one chat. The React Router v7 framework-mode branch is
the canonical example — pick it first unless you're on a different stack.

### Step 1 — Scaffold

```bash
npx copilotkit create -f react-router my-app
cd my-app
pnpm install
```

### Step 2 — Mount the runtime (React Router v7 framework mode — DEFAULT)

Create a catch-all resource route `app/routes/api.copilotkit.$.tsx`. React
Router v7 framework mode runs its own server — mounting the runtime as a
loader+action in a resource route is the canonical pattern. Do NOT spin up
a sidecar Express or Hono server.

```tsx
import type { Route } from "./+types/api.copilotkit.$";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
  BuiltInAgent,
  convertInputToTanStackAI,
} from "@copilotkit/runtime/v2";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";

const tanstackAgent = new BuiltInAgent({
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
});

const runtime = new CopilotRuntime({
  agents: { default: tanstackAgent },
  runner: new InMemoryAgentRunner(),
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

### Step 3 — Provider + chat + tool (`app/routes/_index.tsx`)

```tsx
import { useState } from "react";
import {
  CopilotKitProvider,
  CopilotChat,
  useFrontendTool,
} from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import { z } from "zod";

function RegisterTools() {
  useFrontendTool({
    name: "getCurrentLocation",
    description: "Return the user's current location name.",
    parameters: z.object({}),
    handler: async () => ({ city: "San Francisco", country: "US" }),
  });
  return null;
}

export default function Index() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" showDevConsole="auto">
      <RegisterTools />
      <div className="h-screen">
        <CopilotChat
          agentId="default"
          className="h-full"
          attachments={{ enabled: true }}
        />
      </div>
    </CopilotKitProvider>
  );
}
```

That's the quickstart. Run `pnpm dev`; visit the app; the chat connects to
`/api/copilotkit/info`, the agent runs, the tool fires.

## Core Patterns

### TanStack Start branch

No dedicated helper — mount `createCopilotRuntimeHandler` in a Start server
route's Request handler.

```ts
// app/routes/api/copilotkit.$.ts
import { createAPIFileRoute } from "@tanstack/react-start/api";
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

export const APIRoute = createAPIFileRoute("/api/copilotkit/$")({
  GET: ({ request }) => handler(request),
  POST: ({ request }) => handler(request),
});
```

### Next.js App Router branch

```ts
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
```

### Cloudflare Workers branch (edge runtime — env binding for secrets)

Hoist the runtime + handler to module scope and construct them lazily on
first request. Workers isolates reuse module globals across requests, so
a `let`-cached instance persists in-memory runner state within the isolate
(this does NOT span isolates — for durable cross-isolate state, pair with
`SqliteAgentRunner` or Intelligence). Constructing `new CopilotRuntime(...)`
inside `fetch(request, env)` on every call wastes CPU and throws away the
in-memory thread state.

```ts
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  BuiltInAgent,
} from "@copilotkit/runtime/v2";

interface Env {
  OPENAI_API_KEY: string;
}

// Module-scoped cache. `env` arrives per-request, so we initialize lazily
// the first time we see it. Subsequent requests in the same isolate reuse.
let cachedHandler: ((request: Request) => Response | Promise<Response>) | null =
  null;

function getHandler(env: Env) {
  if (cachedHandler) return cachedHandler;
  const runtime = new CopilotRuntime({
    agents: {
      // Simple Mode: the runtime wires the adapter and reads the API key
      // from the `OPENAI_API_KEY` env binding.
      default: new BuiltInAgent({ model: "openai/gpt-4o" }),
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

### SPA-without-runtime branch (no server)

Point the provider at CopilotKit Cloud via `publicApiKey` — no backend,
no `runtimeUrl`. This is the ONLY production-safe SPA path. See
`copilotkit/spa-without-runtime` for the full treatment.

```tsx
import { CopilotKitProvider, CopilotChat } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";

export default function App() {
  return (
    <CopilotKitProvider publicApiKey={import.meta.env.VITE_CPK_PUBLIC_API_KEY}>
      <CopilotChat agentId="default" className="h-full" />
    </CopilotKitProvider>
  );
}
```

## Common Mistakes

### CRITICAL Express or Hono sidecar when on React Router v7 framework mode

Wrong:

```ts
// server.js — spun up alongside the RR v7 app
import express from "express";
import { createCopilotExpressHandler } from "@copilotkit/runtime/v2/express";
const app = express();
app.use(
  "/api/copilotkit",
  createCopilotExpressHandler({ runtime, basePath: "/api/copilotkit" }),
);
app.listen(3001);
```

Correct:

```tsx
// app/routes/api.copilotkit.$.tsx
export async function loader({ request }: Route.LoaderArgs) {
  return handler(request);
}
export async function action({ request }: Route.ActionArgs) {
  return handler(request);
}
```

RR v7 framework mode already runs its own server; a sidecar Express/Hono app
duplicates servers and breaks unified routing/SSR. Same principle applies to
Next.js (use `route.ts`) and TanStack Start (use an APIRoute). Maintainer
guidance: avoid the Express/Hono adapters.

Source: examples/v2/react-router/app/routes/api.copilotkit.$.tsx

### CRITICAL using @copilotkitnext/ scope for non-Angular packages

Wrong:

```ts
import { CopilotKitProvider } from "@copilotkitnext/react-core";
import { CopilotRuntime } from "@copilotkitnext/runtime";
```

Correct:

```ts
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import { CopilotRuntime } from "@copilotkit/runtime/v2";
// Only Angular uses the @copilotkitnext/ scope:
// import { ... } from "@copilotkitnext/angular";
```

Every CopilotKit package except Angular uses `@copilotkit/`. Agents
over-generalize from the Angular example and hallucinate the scope for
react-core / runtime / etc.

Source: packages/angular/package.json; all other packages/\*/package.json

### HIGH missing leading slash in runtimeUrl

Wrong:

```tsx
<CopilotKitProvider runtimeUrl="api/copilotkit" />
```

Correct:

```tsx
<CopilotKitProvider runtimeUrl="/api/copilotkit" />
```

Without the leading slash the URL resolves relative to the current page —
breaks on any nested route.

Source: docs/snippets/shared/troubleshooting/common-issues.mdx:38-42

### HIGH forgetting the styles.css import

Wrong:

```tsx
import { CopilotChat } from "@copilotkit/react-core/v2";
```

Correct:

```tsx
import { CopilotChat } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
```

Without the stylesheet, the chat renders unstyled/broken — no layout, no
spacing, no theme.

Source: examples/v2/react-router/app/routes/\_index.tsx:3

### HIGH agentId mismatch between client and server

Wrong:

```ts
// server
new CopilotRuntime({ agents: { default: agent } });
// client
<CopilotChat agentId="main" />
```

Correct:

```tsx
<CopilotChat agentId="default" />
// or rename the server key to "main" so both sides match
```

Mismatched IDs surface as `agent_not_found` on first run. Keep the string
identical on both sides.

Source: packages/core/src/core/core.ts:80

### HIGH reading process.env on Cloudflare Workers

Wrong:

```ts
// Module-scoped — `process.env` is undefined on Workers:
const agent = new BuiltInAgent({
  type: "tanstack",
  factory: ({ input, abortController }) =>
    chat({
      adapter: openaiText("gpt-4o"), // no access to process.env.OPENAI_API_KEY
      messages: convertInputToTanStackAI(input).messages,
      abortController,
    }),
});
```

Correct: use Simple Mode and let the runtime read `OPENAI_API_KEY` from
the `env` binding (see the Cloudflare Workers branch above), or thread
`env.OPENAI_API_KEY` in through a closure if you genuinely need Factory
Mode.

Workers don't expose `process.env`. Secrets arrive via the `env` binding
argument to `fetch(request, env)`.

Source: examples/v2/runtime/cf-workers/src/index.ts:7-17

### HIGH raw Node http with createCopilotRuntimeHandler

Wrong:

```ts
const h = createCopilotRuntimeHandler({ runtime });
server.on("request", h);
```

Correct:

```ts
import { createCopilotNodeHandler } from "@copilotkit/runtime/v2/node";

const node = createCopilotNodeHandler(
  createCopilotRuntimeHandler({
    runtime,
    basePath: "/api/copilotkit",
    cors: true,
  }),
);
server.on("request", node);
```

`createCopilotRuntimeHandler` takes a Web `Request`; Node's
`IncomingMessage` shape is different. `createCopilotNodeHandler` adapts the
fetch handler for `http.Server` — for frameworks (RR v7 / Start / Next.js)
use the fetch handler directly.

Source: examples/v2/runtime/node/src/index.ts:1-21
