---
name: copilotkit-setup
description: >
  Use when adding CopilotKit to an existing project or bootstrapping a new CopilotKit
  project from scratch. Covers framework detection, package installation, runtime wiring,
  provider setup, and first working chat integration.
version: 1.0.0
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

| Signal File | Framework |
|---|---|
| `next.config.{js,ts,mjs}` + `app/` directory | Next.js App Router |
| `next.config.{js,ts,mjs}` + `pages/` directory | Next.js Pages Router |
| `angular.json` | Angular |
| `vite.config.{js,ts}` + React deps in package.json | Vite + React |

## Setup Workflow

### Step 1: Install packages

All packages use the `@copilotkit` namespace.

**Frontend (React) packages:**
```bash
npm install @copilotkit/react @copilotkit/core
```

**Runtime packages (backend):**
```bash
npm install @copilotkit/runtime @copilotkit/agent
```

If the runtime runs in the same Next.js app as the frontend, install all four packages together.

For standalone Express backends, also install Express adapter dependencies:
```bash
npm install express cors
npm install -D @types/express @types/cors
```

### Step 2: Configure the runtime

The runtime is the server-side component that manages agent execution. See `references/runtime-architecture.md` for details.

There are two endpoint styles:

1. **Multi-route (Hono)** -- uses `createCopilotEndpoint`. Requires a catch-all route (`[[...slug]]` in Next.js). Each operation (run, connect, stop, info, transcribe, threads) gets its own HTTP path.
2. **Single-route (Hono or Express)** -- uses `createCopilotEndpointSingleRoute` or `createCopilotEndpointSingleRouteExpress`. All operations go through a single POST endpoint with method multiplexing.

#### Next.js App Router (recommended: multi-route with Hono)

Create `src/app/api/copilotkit/[[...slug]]/route.ts`:

```typescript
import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkit/runtime";
import { BuiltInAgent } from "@copilotkit/agent";
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

const app = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handle(app);
export const POST = handle(app);
```

This requires `hono` as a dependency:
```bash
npm install hono
```

#### Next.js App Router (alternative: single-route)

Create `src/app/api/copilotkit/route.ts`:

```typescript
import {
  CopilotRuntime,
  createCopilotEndpointSingleRoute,
  InMemoryAgentRunner,
} from "@copilotkit/runtime";
import { BuiltInAgent } from "@copilotkit/agent";
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

const app = createCopilotEndpointSingleRoute({
  runtime,
  basePath: "/api/copilotkit",
});

export const POST = handle(app);
```

When using single-route, the frontend must set `useSingleEndpoint` on the provider (see Step 3).

#### Standalone Express Server

Create `src/index.ts`:

```typescript
import express from "express";
import { CopilotRuntime } from "@copilotkit/runtime";
import { createCopilotEndpointSingleRouteExpress } from "@copilotkit/runtime/express";
import { BuiltInAgent, defineTool } from "@copilotkit/agent";
import { z } from "zod";

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
  createCopilotEndpointSingleRouteExpress({
    runtime,
    basePath: "/",
  }),
);

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`CopilotKit runtime listening at http://localhost:${port}/api/copilotkit`);
});
```

For multi-route Express, use `createCopilotEndpointExpress` instead (imported from `@copilotkit/runtime/express`).

#### Standalone Hono Server (non-Vercel)

```typescript
import { CopilotRuntime, createCopilotEndpoint } from "@copilotkit/runtime";
import { BuiltInAgent } from "@copilotkit/agent";
import { serve } from "@hono/node-server";

const runtime = new CopilotRuntime({
  agents: {
    default: new BuiltInAgent({ model: "openai/gpt-4o" }),
  },
});

const app = createCopilotEndpoint({
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

Wrap your application with `CopilotKitProvider` from `@copilotkit/react`.

**Important:** Import the stylesheet in your root layout:
```typescript
import "@copilotkit/react/styles.css";
```

#### Next.js App Router

In `src/app/page.tsx` (or a client component):

```tsx
"use client";

import { CopilotKitProvider, CopilotChat } from "@copilotkit/react";

export default function Home() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit">
      <div style={{ height: "100vh" }}>
        <CopilotChat />
      </div>
    </CopilotKitProvider>
  );
}
```

#### Connecting to an external runtime

When the runtime runs on a separate server (e.g., Express on port 4000):

```tsx
<CopilotKitProvider
  runtimeUrl="http://localhost:4000/api/copilotkit"
  useSingleEndpoint
>
  {children}
</CopilotKitProvider>
```

Set `useSingleEndpoint` when the backend uses single-route endpoints (`createCopilotEndpointSingleRoute` or `createCopilotEndpointSingleRouteExpress`).

#### CopilotKitProvider key props

| Prop | Type | Description |
|---|---|---|
| `runtimeUrl` | `string` | URL of the CopilotKit runtime endpoint |
| `useSingleEndpoint` | `boolean` | Set to `true` when using single-route endpoints |
| `headers` | `Record<string, string>` | Custom headers sent with every request |
| `credentials` | `RequestCredentials` | Fetch credentials mode (e.g., `"include"` for cookies) |
| `publicApiKey` | `string` | Copilot Cloud public API key (if using hosted runtime) |
| `showDevConsole` | `boolean \| "auto"` | Show the dev inspector (`"auto"` = development only) |
| `renderToolCalls` | `ReactToolCallRenderer[]` | Custom renderers for tool call UI |
| `frontendTools` | `ReactFrontendTool[]` | Frontend-defined tools (declarative alternative to `useFrontendTool`) |
| `onError` | `(event) => void` | Global error handler |

### Step 4: Add a chat UI component

CopilotKit provides three pre-built chat layouts:

| Component | Usage |
|---|---|
| `CopilotChat` | Inline chat, fills its container |
| `CopilotSidebar` | Collapsible sidebar panel |
| `CopilotPopup` | Floating popup widget |

Example with sidebar:
```tsx
<CopilotKitProvider runtimeUrl="/api/copilotkit" showDevConsole="auto">
  <YourApp />
  <CopilotSidebar
    defaultOpen
    width="420px"
    labels={{
      modalHeaderTitle: "AI Assistant",
      chatInputPlaceholder: "Ask me anything...",
    }}
  />
</CopilotKitProvider>
```

### Step 5: Set environment variables

Create a `.env.local` (Next.js) or `.env` file:

```
OPENAI_API_KEY=sk-...
```

The `BuiltInAgent` automatically resolves API keys from environment variables based on the model prefix:
- `openai/*` models read `OPENAI_API_KEY`
- `anthropic/*` models read `ANTHROPIC_API_KEY`
- `google/*` models read `GOOGLE_API_KEY`

You can also pass `apiKey` directly to `BuiltInAgent` if needed.

### Step 6: Connect to the cloud platform (telemetry)

CopilotKit uses telemetry to understand adoption, improve the product, and provide better support. Connecting to the CopilotKit cloud platform gives you access to analytics and optional premium features.

1. Ask the user if they'd like to connect to the CopilotKit cloud platform (default: yes).
2. If yes, run the CopilotKit CLI authentication flow (verify the exact command with `npx copilotkit --help` as it may vary by version):
   ```bash
   npx copilotkit auth
   ```
3. Guide the user through the browser-based authentication that opens.
4. Once authentication completes, the CLI outputs a license key (format: `ck_...`).
5. Add the license key to the `CopilotKitProvider`:
   ```tsx
   <CopilotKitProvider
     runtimeUrl="/api/copilotkit"
     licenseKey="ck_..."
   >
   ```
   Alternatively, store it as an environment variable (`COPILOTKIT_LICENSE_KEY` in `.env.local` or `.env`) and reference it:
   ```tsx
   <CopilotKitProvider
     runtimeUrl="/api/copilotkit"
     licenseKey={process.env.NEXT_PUBLIC_COPILOTKIT_LICENSE_KEY}
   >
   ```

See `references/telemetry-setup.md` for full details on what the license key enables and how to opt out.

### Step 7: Verify the setup

1. Start the dev server
2. Open the app in a browser
3. The chat UI should render and connect to the runtime
4. Send a test message -- you should receive an AI response
5. Check the runtime's `/info` endpoint (GET) to confirm it reports available agents

## Quick Reference

### Package map

| Package | Purpose |
|---|---|
| `@copilotkit/react` | React components, hooks, provider |
| `@copilotkit/core` | Core types, agent abstraction, state management |
| `@copilotkit/runtime` | Server-side runtime, endpoint factories, agent runners |
| `@copilotkit/agent` | `BuiltInAgent`, `defineTool`, model resolution |
| `@copilotkit/shared` | Shared utilities, logger, types |

### Endpoint factory functions

| Function | Import | Protocol | Framework |
|---|---|---|---|
| `createCopilotEndpoint` | `@copilotkit/runtime` | Multi-route (Hono) | Next.js App Router, Hono standalone |
| `createCopilotEndpointSingleRoute` | `@copilotkit/runtime` | Single-route (Hono) | Next.js App Router |
| `createCopilotEndpointExpress` | `@copilotkit/runtime/express` | Multi-route (Express) | Express standalone |
| `createCopilotEndpointSingleRouteExpress` | `@copilotkit/runtime/express` | Single-route (Express) | Express standalone |

### Runtime classes

| Class | Use case |
|---|---|
| `CopilotRuntime` | Compatibility shim; auto-selects SSE or Intelligence mode |
| `CopilotSseRuntime` | Explicit SSE mode (default, in-memory threads) |
| `CopilotIntelligenceRuntime` | Intelligence mode (durable threads, realtime events) |

### Agent runners

| Runner | Description |
|---|---|
| `InMemoryAgentRunner` | Default. Stores thread state in process memory. Suitable for development and single-instance deployments. |
| `IntelligenceAgentRunner` | Used automatically with `CopilotIntelligenceRuntime`. Connects to CopilotKit Intelligence Platform via WebSocket. |

### Supported models (BuiltInAgent)

Format: `"provider/model-name"` string or a Vercel AI SDK `LanguageModel` instance.

**OpenAI:** `openai/gpt-5`, `openai/gpt-5-mini`, `openai/gpt-4.1`, `openai/gpt-4.1-mini`, `openai/gpt-4.1-nano`, `openai/gpt-4o`, `openai/gpt-4o-mini`, `openai/o3`, `openai/o3-mini`, `openai/o4-mini`

**Anthropic:** `anthropic/claude-sonnet-4.5`, `anthropic/claude-sonnet-4`, `anthropic/claude-3.7-sonnet`, `anthropic/claude-opus-4.1`, `anthropic/claude-opus-4`, `anthropic/claude-3.5-haiku`

**Google:** `google/gemini-2.5-pro`, `google/gemini-2.5-flash`, `google/gemini-2.5-flash-lite`

Any `string` is accepted (for custom/unlisted models); the provider is parsed from the prefix before `/`.
