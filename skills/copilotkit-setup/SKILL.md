---
name: copilotkit-setup
description: >
  Use when adding CopilotKit to an existing project or bootstrapping a new CopilotKit
  project from scratch. Covers framework detection, package installation, runtime wiring,
  provider setup, and first working chat integration.
version: 1.1.2
---

# CopilotKit Setup

## Prerequisites

### Live Documentation (MCP)

This plugin includes an MCP server (`copilotkit-docs`) that provides `search-docs` and `search-code` tools for querying live CopilotKit documentation and source code.

- **Claude Code:** Auto-configured by the plugin's `.mcp.json` -- no setup needed.
- **Codex:** Requires manual configuration. See the [copilotkit-debug skill](../copilotkit-debug/SKILL.md#mcp-setup) for setup instructions.

### Environment

Before starting setup, verify:

1. **Node.js >= 18** (required for `fetch` globals used by the runtime)
2. **An AI provider API key** (one of: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`)
3. **A React-based frontend** (Next.js App Router, Next.js Pages Router, Vite + React, or Angular)
4. **A backend capable of running the runtime** (same Next.js app via API routes, or a standalone Express/Hono server)

## Framework Detection

Before generating any code, detect the project's framework by checking files in the project root. See `references/framework-detection.md` for the full decision tree.

**Quick summary:**

| Signal File                                        | Framework            |
| -------------------------------------------------- | -------------------- |
| `next.config.{js,ts,mjs}` + `app/` directory       | Next.js App Router   |
| `next.config.{js,ts,mjs}` + `pages/` directory     | Next.js Pages Router |
| `angular.json`                                     | Angular              |
| `vite.config.{js,ts}` + React deps in package.json | Vite + React         |

## Setup Workflow

### Step 1: Install packages

All packages use the `@copilotkit` namespace. The v2 API lives as subpath exports on the published packages.

**Frontend + backend in the same Next.js app:**

```bash
npm install @copilotkit/react-core @copilotkit/runtime hono
```

**Frontend only:**

```bash
npm install @copilotkit/react-core
```

**Backend runtime only:**

```bash
npm install @copilotkit/runtime hono
```

For standalone Express backends, install Express adapter dependencies instead of `hono`:

```bash
npm install @copilotkit/runtime express dotenv zod
npm install -D @types/express tsx typescript
```

(`createCopilotExpressHandler` enables CORS internally, so you do not need to
install `cors` yourself. `dotenv` and `zod` are used by the example asset.)

### Step 2: Configure the runtime

The runtime is the server-side component that manages agent execution. See `references/runtime-architecture.md` for details.

There are two endpoint styles:

1. **Multi-route (Hono)** -- uses `createCopilotHonoHandler`. Requires a catch-all route (`[[...slug]]` in Next.js). Each operation (run, connect, stop, info, transcribe, threads) gets its own HTTP path.
2. **Single-route (Hono or Express)** -- uses `createCopilotHonoHandler({ ..., mode: "single-route" })` or `createCopilotExpressHandler({ ..., mode: "single-route" })`. All operations go through a single POST endpoint with method multiplexing.

#### Next.js App Router (recommended: multi-route with Hono)

Create `src/app/api/copilotkit/[[...slug]]/route.ts`:

```typescript
import {
  CopilotRuntime,
  createCopilotHonoHandler,
  InMemoryAgentRunner,
  BuiltInAgent,
} from "@copilotkit/runtime/v2";
import { handle } from "hono/vercel";

const agent = new BuiltInAgent({
  model: "openai/gpt-4o",
  prompt: "You are a helpful AI assistant.",
});

const runtime = new CopilotRuntime({
  agents: {
    default: agent,
  },
  runner: new InMemoryAgentRunner(),
});

const app = createCopilotHonoHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handle(app);
export const POST = handle(app);
// PATCH/DELETE are used by thread operations (useThreads); export them too
// so the multi-route handler can serve them when you enable Intelligence/threads.
export const PATCH = handle(app);
export const DELETE = handle(app);
```

#### Next.js App Router (alternative: single-route)

Create `src/app/api/copilotkit/route.ts`:

```typescript
import {
  CopilotRuntime,
  createCopilotHonoHandler,
  InMemoryAgentRunner,
  BuiltInAgent,
} from "@copilotkit/runtime/v2";
import { handle } from "hono/vercel";

const agent = new BuiltInAgent({
  model: "openai/gpt-4o",
  prompt: "You are a helpful AI assistant.",
});

const runtime = new CopilotRuntime({
  agents: {
    default: agent,
  },
  runner: new InMemoryAgentRunner(),
});

const app = createCopilotHonoHandler({
  runtime,
  basePath: "/api/copilotkit",
  mode: "single-route",
});

export const POST = handle(app);
```

When using single-route, the frontend must set `useSingleEndpoint` on the provider (see Step 3).

#### Standalone Express Server

Create `src/index.ts`:

```typescript
import express from "express";
import { CopilotRuntime, BuiltInAgent } from "@copilotkit/runtime/v2";
import { createCopilotExpressHandler } from "@copilotkit/runtime/v2/express";

const agent = new BuiltInAgent({
  model: "openai/gpt-4o",
});

const runtime = new CopilotRuntime({
  agents: {
    default: agent,
  },
});

const app = express();

app.use(
  "/api/copilotkit",
  createCopilotExpressHandler({
    runtime,
    basePath: "/",
    mode: "single-route",
  }),
);

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(
    `CopilotKit runtime listening at http://localhost:${port}/api/copilotkit`,
  );
});
```

For multi-route Express, omit the `mode` option (multi-route is the default) -- `createCopilotExpressHandler` is the same factory for both styles (imported from `@copilotkit/runtime/v2/express`).

#### Standalone Hono Server (non-Vercel)

```typescript
import {
  CopilotRuntime,
  createCopilotHonoHandler,
  BuiltInAgent,
} from "@copilotkit/runtime/v2";
import { serve } from "@hono/node-server";

const runtime = new CopilotRuntime({
  agents: {
    default: new BuiltInAgent({ model: "openai/gpt-4o" }),
  },
});

const app = createCopilotHonoHandler({
  runtime,
  basePath: "/api/copilotkit",
});

serve({ fetch: app.fetch, port: 8787 });
```

Requires `@hono/node-server`:

```bash
npm install hono @hono/node-server
```

### Step 3: Set up the frontend provider

Wrap your application with `CopilotKit` from `@copilotkit/react-core/v2`.

> **Which provider component?** Always use `CopilotKit` imported from `@copilotkit/react-core/v2`. It is the compatibility bridge across v1 and v2 and a strict superset of the other provider APIs. Do **not** use `CopilotKit` from the package root (`@copilotkit/react-core`, legacy v1) or `CopilotKitProvider` from `/v2` (a subset of the functionality).

**Important:** Import the stylesheet in your root layout:

```typescript
import "@copilotkit/react-core/v2/styles.css";
```

#### Next.js App Router

In `src/app/page.tsx` (or a client component):

```tsx
"use client";

import { CopilotKit, CopilotChat } from "@copilotkit/react-core/v2";

export default function Home() {
  return (
    // useSingleEndpoint={false} matches the multi-route backend above.
    // The v1-compat CopilotKit bridge defaults useSingleEndpoint to true,
    // which would 404 against multi-route endpoints.
    <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      <div style={{ height: "100vh" }}>
        <CopilotChat />
      </div>
    </CopilotKit>
  );
}
```

#### Connecting to an external runtime

When the runtime runs on a separate server (e.g., Express on port 4000):

```tsx
<CopilotKit runtimeUrl="http://localhost:4000/api/copilotkit" useSingleEndpoint>
  {children}
</CopilotKit>
```

Set `useSingleEndpoint` when the backend uses single-route endpoints (`createCopilotHonoHandler` or `createCopilotExpressHandler` with `mode: "single-route"`).

#### CopilotKit key props

| Prop                | Type                                                       | Description                                                                                                          |
| ------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `runtimeUrl`        | `string`                                                   | URL of the CopilotKit runtime endpoint                                                                               |
| `useSingleEndpoint` | `boolean`                                                  | Set to `true` when using single-route endpoints                                                                      |
| `headers`           | `Record<string, string> \| (() => Record<string, string>)` | Custom headers sent with every request. The function form is evaluated per-request (useful for dynamic auth tokens). |
| `credentials`       | `RequestCredentials`                                       | Fetch credentials mode (e.g., `"include"` for cookies)                                                               |
| `publicLicenseKey`  | `string`                                                   | CopilotKit Intelligence public license key (`publicApiKey` is a deprecated alias)                                    |
| `showDevConsole`    | `boolean`                                                  | Show the dev console. Omit it to get the default behavior (shown on `localhost` only)                                |
| `renderToolCalls`   | `ReactToolCallRenderer[]`                                  | Custom renderers for tool call UI                                                                                    |
| `frontendTools`     | `ReactFrontendTool[]`                                      | Frontend-defined tools (declarative alternative to `useFrontendTool`)                                                |
| `onError`           | `(event) => void`                                          | Global error handler                                                                                                 |

### Step 4: Add a chat UI component

CopilotKit provides three pre-built chat layouts (all imported from `@copilotkit/react-core/v2`):

| Component        | Usage                            |
| ---------------- | -------------------------------- |
| `CopilotChat`    | Inline chat, fills its container |
| `CopilotSidebar` | Collapsible sidebar panel        |
| `CopilotPopup`   | Floating popup widget            |

Example with sidebar:

```tsx
import { CopilotKit, CopilotSidebar } from "@copilotkit/react-core/v2";

<CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
  <YourApp />
  <CopilotSidebar
    defaultOpen
    width="420px"
    labels={{
      modalHeaderTitle: "AI Assistant",
      chatInputPlaceholder: "Ask me anything...",
    }}
  />
</CopilotKit>;
```

### Step 5: Set environment variables

Provider API keys are secrets. Store them in environment variables -- never hardcode them in source or commit them to version control. Create a `.env.local` (Next.js) or `.env` file:

```
OPENAI_API_KEY=<your-openai-api-key>
```

Make sure your `.gitignore` excludes env files (`.env`, `.env.local`, `.env*.local`) so keys are never committed. In production, supply keys through your platform's secret manager (Vercel/Netlify environment variables, AWS Secrets Manager, etc.) rather than a checked-in file.

The `BuiltInAgent` automatically resolves API keys from these environment variables based on the model prefix:

- `openai/*` models read `OPENAI_API_KEY`
- `anthropic/*` models read `ANTHROPIC_API_KEY`
- `google/*` models read `GOOGLE_API_KEY`

If you need to pass `apiKey` explicitly, always source it from the environment (`apiKey: process.env.OPENAI_API_KEY`) -- never inline a literal key.

### Step 6: Connect to CopilotKit Intelligence (telemetry)

CopilotKit uses telemetry to understand adoption, improve the product, and provide better support. Connecting to CopilotKit Intelligence gives you access to analytics and optional premium features.

1. Ask the user if they'd like to connect to CopilotKit Intelligence (default: yes).
2. If yes, run the CopilotKit CLI authentication flow (verify the exact command with `npx copilotkit --help` as it may vary by version):
   ```bash
   npx copilotkit auth
   ```
3. Guide the user through the browser-based authentication that opens.
4. Once authentication completes, the CLI outputs a license key (a public, client-side project identifier -- not a secret).
5. Store the license key in an environment variable and reference it from the `CopilotKit` provider -- this keeps it out of source and easy to rotate per environment:
   ```
   # .env.local (Next.js)
   NEXT_PUBLIC_COPILOTKIT_LICENSE_KEY=<your-license-key>
   ```
   ```tsx
   <CopilotKit
     runtimeUrl="/api/copilotkit"
     publicLicenseKey={process.env.NEXT_PUBLIC_COPILOTKIT_LICENSE_KEY}
   >
   ```
   The `NEXT_PUBLIC_`/`VITE_` prefix is required because the key is read on the client.

See `references/telemetry-setup.md` for full details on what the license key enables and how to opt out.

### Step 7: Verify the setup

1. Start the dev server
2. Open the app in a browser
3. The chat UI should render and connect to the runtime
4. Send a test message -- you should receive an AI response
5. Check the runtime's info endpoint to confirm it reports available agents. For multi-route handlers this is `GET /api/copilotkit/info`; for single-route handlers (`mode: "single-route"`, e.g. the Express example) it is a `POST` to the base path with body `{ "method": "info" }` (a plain `GET` will not return agent info — the Hono single-route handler answers `405`, and the Express single-route router has no `GET` route so it falls through to a `404`)

## Security notes

Keep these in mind as you wire up a real deployment:

- **Secrets stay server-side and in env vars.** Provider API keys (`OPENAI_API_KEY`, etc.) are read by the runtime/agent on the server. Never expose them to the browser, hardcode them, or commit them -- store them in environment variables or a secret manager (see Step 5). The CopilotKit license key is the one client-side value, and it is a public project identifier, not a secret.
- **Treat all chat input as untrusted.** Chat messages flow from the frontend through the `CopilotRuntime` endpoint into the agent's LLM context. They are user-controlled and can attempt prompt injection -- including indirect injection via content the agent fetches (web pages, documents, tool results). Do not assume the model will only do what your system prompt intends.
- **Give server-side tools least privilege.** A `defineTool`'s `execute` function runs with your server's authority. Validate every argument (the `zod` `parameters` schema is your first gate), scope each tool to the narrowest action it needs, and enforce your own authorization inside the `execute` function for anything sensitive (database writes, payments, file access) rather than trusting that the model called it correctly.
- **Authenticate the runtime endpoint.** The runtime route is a public HTTP endpoint by default. Put your app's auth in front of it so only authorized users can drive the agent and consume provider credits.

## Quick Reference

### Package map

| Package                  | Purpose                                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `@copilotkit/react-core` | React components, hooks, provider (import from `@copilotkit/react-core/v2`)                                     |
| `@copilotkit/runtime`    | Runtime, endpoint factories, agent runners, `BuiltInAgent`, `defineTool` (import from `@copilotkit/runtime/v2`) |
| `@copilotkit/shared`     | Shared utilities, logger, types                                                                                 |

### Endpoint factory functions

| Function                      | Import                           | Framework                           | Mode                                                |
| ----------------------------- | -------------------------------- | ----------------------------------- | --------------------------------------------------- |
| `createCopilotHonoHandler`    | `@copilotkit/runtime/v2`         | Next.js App Router, Hono standalone | `"multi-route"` (default) or `mode: "single-route"` |
| `createCopilotExpressHandler` | `@copilotkit/runtime/v2/express` | Express standalone                  | `"multi-route"` (default) or `mode: "single-route"` |

> The `createCopilotEndpoint`, `createCopilotEndpointSingleRoute`, `createCopilotEndpointExpress`, and `createCopilotEndpointSingleRouteExpress` names are deprecated aliases of the two factories above. Prefer the handler factories with the `mode` option.

### Runtime classes

| Class                        | Use case                                                  |
| ---------------------------- | --------------------------------------------------------- |
| `CopilotRuntime`             | Compatibility shim; auto-selects SSE or Intelligence mode |
| `CopilotSseRuntime`          | Explicit SSE mode (default, in-memory threads)            |
| `CopilotIntelligenceRuntime` | Intelligence mode (durable threads, realtime events)      |

### Agent runners

| Runner                    | Description                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `InMemoryAgentRunner`     | Default. Stores thread state in process memory. Suitable for development and single-instance deployments.         |
| `IntelligenceAgentRunner` | Used automatically with `CopilotIntelligenceRuntime`. Connects to CopilotKit Intelligence Platform via WebSocket. |

### Supported models (BuiltInAgent)

Format: `"provider/model-name"` string or a Vercel AI SDK `LanguageModel` instance.

**OpenAI:** `openai/gpt-5`, `openai/gpt-5-mini`, `openai/gpt-4.1`, `openai/gpt-4.1-mini`, `openai/gpt-4.1-nano`, `openai/gpt-4o`, `openai/gpt-4o-mini`, `openai/o3`, `openai/o3-mini`, `openai/o4-mini`

**Anthropic:** `anthropic/claude-sonnet-4.5`, `anthropic/claude-sonnet-4`, `anthropic/claude-3.7-sonnet`, `anthropic/claude-opus-4.1`, `anthropic/claude-opus-4`, `anthropic/claude-3.5-haiku`

**Google:** `google/gemini-2.5-pro`, `google/gemini-2.5-flash`, `google/gemini-2.5-flash-lite`

Any `string` is accepted (for custom/unlisted models); the provider is parsed from the prefix before `/`.
