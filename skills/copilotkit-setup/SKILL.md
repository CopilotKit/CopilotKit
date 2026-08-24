---
name: copilotkit-setup
description: >
  Use when adding CopilotKit to an existing project or bootstrapping a new CopilotKit
  project from scratch. Covers framework detection, package installation, runtime wiring
  (managed Intelligence or self-hosted SSE), provider setup, and first working chat
  integration.
version: 1.3.1
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

### Step 2: Choose a runtime mode, then configure the runtime

The runtime is the server-side component that manages agent execution. See `references/runtime-architecture.md` for details.

**Decide the mode before writing any runtime code.** The mode changes how the runtime is constructed, so retrofitting it later means rewriting this file.

| Mode                                   | Thread state               | Choose it when                                                                     |
| -------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------- |
| **Managed Intelligence** (recommended) | Durable, hosted            | You want threads that survive restarts, hosted ingress, the dashboard, or Channels |
| Self-hosted SSE                        | In-memory, lost on restart | You do not want a hosted dependency and are willing to own persistence yourself    |

Ask the user which they want, defaulting to managed Intelligence. State the prerequisites plainly so the choice is informed:

**Managed Intelligence requires** a CopilotKit account (free; `npx copilotkit login` opens the browser) and a project API key. In exchange, threads are durable across restarts and deploys, you get the dashboard, and Slack/Teams Channels become available -- Channels are not available in SSE mode at all.

**Self-hosted SSE requires** nothing beyond an AI provider key. Thread state lives in memory in the process that served the request, so it is lost on restart and is not shared across replicas. Everything in this skill works in SSE mode; it is a supported path, not a dead end.

If the user picks managed Intelligence, use the Intelligence runtime blocks below and then complete Step 6. If they pick SSE, use the SSE blocks and skip Step 6's server-side wiring.

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

#### Next.js App Router with managed Intelligence

Same file and same handler as above; only the runtime construction differs. `intelligence` is what selects Intelligence mode, and `identifyUser` is required with it.

```typescript
import {
  CopilotRuntime,
  CopilotKitIntelligence,
  createCopilotHonoHandler,
  BuiltInAgent,
} from "@copilotkit/runtime/v2";
import { handle } from "hono/vercel";

const agent = new BuiltInAgent({
  model: "openai/gpt-4o",
  prompt: "You are a helpful AI assistant.",
});

const intelligence = new CopilotKitIntelligence({
  // Server-side secret. `apiUrl`/`wsUrl` default to CopilotKit's managed
  // platform, so most projects set only the key.
  apiKey: process.env.INTELLIGENCE_API_KEY!,
});

const runtime = new CopilotRuntime({
  agents: { default: agent },
  intelligence,
  // REQUIRED in Intelligence mode: it decides whose threads these are. Resolve a
  // real authenticated user from the request -- with a hardcoded id, every visitor
  // shares one thread history.
  identifyUser: (request) => resolveUserFromSession(request),
});

const app = createCopilotHonoHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
```

Notes that matter:

- **Do not pass `runner`.** Intelligence mode supplies `IntelligenceAgentRunner` itself; passing `InMemoryAgentRunner` is what keeps threads in memory.
- **`identifyUser` is not optional.** It is the thread-ownership boundary. A stub like `() => ({ id: "demo", name: "Demo" })` is fine for a local spike and wrong for anything multi-user.
- **`apiUrl` and `wsUrl` are separate hosts.** They default to `https://api.intelligence.copilotkit.ai` and `wss://realtime.intelligence.copilotkit.ai`. The realtime plane cannot be derived from the API plane by swapping the scheme, so override **both or neither** -- overriding one points the two planes at different deployments.

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

The frontend provider negotiates this automatically; set `useSingleEndpoint` on it only to pin single-route transport explicitly (see Step 3).

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
    // No useSingleEndpoint: the provider negotiates the transport, so it
    // matches the multi-route backend above (the default) or a single-route
    // one. Pass the prop only to pin one mode deliberately.
    <CopilotKit runtimeUrl="/api/copilotkit">
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

Omitting `useSingleEndpoint` lets the provider negotiate the transport, which works against either handler mode. Set it to `true` only to pin single-route transport (`createCopilotHonoHandler` or `createCopilotExpressHandler` with `mode: "single-route"`), or to `false` to pin the multi-route REST routes.

#### CopilotKit key props

| Prop                | Type                                                       | Description                                                                                                          |
| ------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `runtimeUrl`        | `string`                                                   | URL of the CopilotKit runtime endpoint                                                                               |
| `useSingleEndpoint` | `boolean`                                                  | Omit to negotiate the transport (works with either handler mode); `true` pins single-route, `false` pins multi-route |
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

### Step 6: Connect to CopilotKit Intelligence

Skip this step only if the user chose self-hosted SSE in Step 2.

Intelligence has two halves and they use different credentials. Getting them mixed up is the most common setup mistake here.

| Credential                  | Where it lives | Secret? | Purpose                                       |
| --------------------------- | -------------- | ------- | --------------------------------------------- |
| Project API key (`cpk-...`) | Server only    | **Yes** | The runtime authenticates to Intelligence     |
| Public license key          | Client         | No      | Enables licensed frontend features, telemetry |

1. **Sign in and create a project.**

   ```bash
   npx copilotkit login
   npx copilotkit project select
   ```

   `login` opens the browser and stores a local CLI session. `project select` picks or creates a hosted project and records it in `.copilotkit/project.json`. Verify the available commands with `npx copilotkit --help` if a version differs.

2. **Set the server-side project API key.** `project select` provisions one; you can also copy it from the dashboard.

   ```
   # .env.local (Next.js) or .env
   INTELLIGENCE_API_KEY=cpk-...
   ```

   This is a secret. It has no `NEXT_PUBLIC_`/`VITE_` prefix on purpose -- prefixing it would ship it to the browser. It is read by the `CopilotKitIntelligence` client you wired in Step 2.

   `INTELLIGENCE_API_KEY` is the canonical name — it is what `copilotkit project select` provisions and what every CopilotKit surface documents. `COPILOTKIT_API_KEY` is a deprecated alias that some older examples still read.

3. **Set the public license key** and pass it to the provider. Unlike the API key, this one is a public project identifier and is meant to reach the client:

   ```
   NEXT_PUBLIC_COPILOTKIT_LICENSE_KEY=<your-license-key>
   ```

   ```tsx
   <CopilotKit
     runtimeUrl="/api/copilotkit"
     publicLicenseKey={process.env.NEXT_PUBLIC_COPILOTKIT_LICENSE_KEY}
   >
   ```

   The `NEXT_PUBLIC_`/`VITE_` prefix is required because the key is read on the client.

4. **Confirm durable threads actually work.** Send a message, restart the dev server, and reload. The thread should still be there. If it is not, the runtime is still in SSE mode -- check that `intelligence` is passed and that no `runner` overrides it.

See `references/telemetry-setup.md` for what the license key enables and how to opt out.

#### Connecting Slack or Microsoft Teams

Channels let an agent answer in Slack or Teams. They require the Intelligence runtime -- `channels` is not available in SSE mode -- and a long-running host, because activation opens a persistent connection.

Use the **copilotkit-channels** skill for this. It covers declaring a Channel, the long-running host requirement, and which mounts start activation on their own versus which wait for an explicit `channels.ready()` call. It builds on the wiring from this step.

For a new managed Teams app, create the Channel draft in Intelligence first and use either the recommended browser-issued Fast CLI command (`channels add --project-id … --channel-id … --adapter teams --provision`) or the peer Guided manual path. Do not scaffold Azure Bot resources or place Microsoft credentials, custom icons, or generated packages in the project. The provider's **Created and installed** result is separate from this code half; only a running host plus a real Teams interaction verifies the integration end to end.

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

| Class                        | Use case                                                       |
| ---------------------------- | -------------------------------------------------------------- |
| `CopilotRuntime`             | Compatibility shim; auto-selects SSE or Intelligence mode      |
| `CopilotSseRuntime`          | Explicit SSE mode (default, in-memory threads)                 |
| `CopilotIntelligenceRuntime` | Intelligence mode (durable threads, realtime events, Channels) |

Channels require the Intelligence runtime and a long-running host. See the
**copilotkit-channels** skill.

### Agent runners

| Runner                    | Description                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `InMemoryAgentRunner`     | Default. Stores thread state in process memory. Suitable for development and single-instance deployments.         |
| `IntelligenceAgentRunner` | Used automatically with `CopilotIntelligenceRuntime`. Connects to CopilotKit Intelligence Platform via WebSocket. |

### Supported models (BuiltInAgent)

Format: `"provider/model-name"` string or a Vercel AI SDK `LanguageModel` instance.

**OpenAI:** `openai/gpt-5`, `openai/gpt-5-mini`, `openai/gpt-4.1`, `openai/gpt-4.1-mini`, `openai/gpt-4.1-nano`, `openai/gpt-4o`, `openai/gpt-4o-mini`, `openai/o3`, `openai/o3-mini`, `openai/o4-mini`

**Anthropic:** `anthropic/claude-sonnet-4-6`, `anthropic/claude-sonnet-4-5`, `anthropic/claude-opus-4-8`, `anthropic/claude-haiku-4-5`

**Google:** `google/gemini-2.5-pro`, `google/gemini-2.5-flash`, `google/gemini-2.5-flash-lite`

Any `string` is accepted (for custom/unlisted models); the provider is parsed from the prefix before `/`.
