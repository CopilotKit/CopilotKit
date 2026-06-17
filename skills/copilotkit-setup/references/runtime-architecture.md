# Runtime Architecture

The CopilotKit v2 runtime (`@copilotkit/runtime/v2`) is the server-side component that manages agent execution, thread state, and communication with the frontend via the AG-UI protocol (SSE-based events).

## Core Concepts

### CopilotRuntime

`CopilotRuntime` is the main entry point. It is a compatibility shim that delegates to either `CopilotSseRuntime` (default) or `CopilotIntelligenceRuntime` depending on configuration.

```typescript
import { CopilotRuntime } from "@copilotkit/runtime/v2";

// SSE mode (default) -- in-memory thread state
const runtime = new CopilotRuntime({
  agents: { default: myAgent },
  runner: new InMemoryAgentRunner(),  // optional, this is the default
});

// Intelligence mode -- durable threads via CopilotKit Intelligence Platform
const runtime = new CopilotRuntime({
  agents: { default: myAgent },
  intelligence: new CopilotKitIntelligence({ ... }),
  identifyUser: (request) => ({ id: "user-123", name: "Ada Lovelace" }),
});
```

**Constructor options (`CopilotRuntimeOptions`):**

| Option                    | Type                                           | Description                                                           |
| ------------------------- | ---------------------------------------------- | --------------------------------------------------------------------- |
| `agents`                  | `Record<string, AbstractAgent>`                | Map of named agents. Must have at least one entry.                    |
| `runner`                  | `AgentRunner`                                  | Agent execution strategy. Defaults to `InMemoryAgentRunner`.          |
| `intelligence`            | `CopilotKitIntelligence`                       | Enables Intelligence mode with durable threads.                       |
| `identifyUser`            | `(request: Request) => CopilotRuntimeUser`     | Required with Intelligence mode. Resolves authenticated user.         |
| `generateThreadNames`     | `boolean`                                      | Auto-generate thread names (Intelligence mode only, default: `true`). |
| `transcriptionService`    | `TranscriptionService`                         | Optional audio transcription (a `TranscriptionService` subclass).     |
| `beforeRequestMiddleware` | `BeforeRequestMiddleware`                      | Callback or webhook URL invoked before each request.                  |
| `afterRequestMiddleware`  | `AfterRequestMiddleware`                       | Callback or webhook URL invoked after each request.                   |
| `a2ui`                    | `{ agents?: string[] } & A2UIMiddlewareConfig` | Auto-apply A2UI (Agent-to-UI) middleware to agents.                   |
| `mcpApps`                 | `{ servers: McpAppsServerConfig[] }`           | Auto-apply MCP Apps middleware with MCP server configs.               |

### Agents

Agents implement the `AbstractAgent` interface from `@ag-ui/client`. CopilotKit provides `BuiltInAgent` (from `@copilotkit/runtime/v2`) as a ready-to-use implementation backed by the Vercel AI SDK.

```typescript
import { BuiltInAgent, defineTool } from "@copilotkit/runtime/v2";
import { z } from "zod";

const agent = new BuiltInAgent({
  model: "openai/gpt-4o", // "provider/model" string or LanguageModel instance
  prompt: "You are helpful.", // System prompt
  temperature: 0.7, // Sampling temperature
  maxSteps: 5, // Max tool-calling iterations (default: 1)
  tools: [
    // Server-side tools
    defineTool({
      name: "getWeather",
      description: "Get current weather for a city",
      parameters: z.object({
        city: z.string(),
      }),
      execute: async ({ city }) => {
        return { temp: 72, condition: "sunny" };
      },
    }),
  ],
});
```

`BasicAgent` is a **deprecated** subclass of `BuiltInAgent` (it logs a deprecation warning at construction). Use `BuiltInAgent` directly.

**BuiltInAgent configuration:**

| Option                     | Type                      | Description                                                                 |
| -------------------------- | ------------------------- | --------------------------------------------------------------------------- |
| `model`                    | `string \| LanguageModel` | Model identifier (e.g., `"openai/gpt-4o"`) or AI SDK LanguageModel          |
| `apiKey`                   | `string`                  | Provider API key (falls back to env vars)                                   |
| `prompt`                   | `string`                  | System prompt                                                               |
| `temperature`              | `number`                  | Sampling temperature                                                        |
| `maxSteps`                 | `number`                  | Max tool-calling iterations (default: 1)                                    |
| `maxOutputTokens`          | `number`                  | Max tokens to generate                                                      |
| `toolChoice`               | `ToolChoice`              | How tools are selected (`"auto"`, `"required"`, `"none"`, or specific)      |
| `tools`                    | `ToolDefinition[]`        | Server-side tools available to the agent                                    |
| `mcpServers`               | `MCPClientConfig[]`       | MCP server connections for dynamic tool discovery                           |
| `providerOptions`          | `Record<string, any>`     | Provider-specific options (e.g., `{ openai: { reasoningEffort: "high" } }`) |
| `overridableProperties`    | `OverridableProperty[]`   | Properties the frontend can override via forwarded props                    |
| `forwardSystemMessages`    | `boolean`                 | Forward system-role messages from input (default: `false`)                  |
| `forwardDeveloperMessages` | `boolean`                 | Forward developer-role messages as system messages (default: `false`)       |

### AgentRunner

The `AgentRunner` abstract class controls how agent execution is managed. It has four methods:

```typescript
abstract class AgentRunner {
  abstract run(request: AgentRunnerRunRequest): Observable<BaseEvent>;
  abstract connect(request: AgentRunnerConnectRequest): Observable<BaseEvent>;
  abstract isRunning(request: AgentRunnerIsRunningRequest): Promise<boolean>;
  abstract stop(request: AgentRunnerStopRequest): Promise<boolean | undefined>;
}
```

**Built-in runners:**

- **`InMemoryAgentRunner`** -- Default. Stores thread state (events, runs) in process memory using a global `Map` keyed by thread ID. Survives hot reloads via `Symbol.for` on `globalThis`. Suitable for development and single-instance deployments.
- **`IntelligenceAgentRunner`** -- Used automatically when `CopilotIntelligenceRuntime` is configured. Connects to the Intelligence Platform via WebSocket for durable, distributed thread management.

## Endpoint Factories

Endpoint factories create HTTP handlers that expose the runtime's functionality. There are two factories -- one per HTTP framework (`createCopilotHonoHandler` from `@copilotkit/runtime/v2`, `createCopilotExpressHandler` from `@copilotkit/runtime/v2/express`) -- and each supports two routing styles (multi-route by default, single-route via `mode: "single-route"`).

### Multi-Route Endpoints

Each operation gets its own HTTP path under the base path:

| Method | Path                             | Handler                                  |
| ------ | -------------------------------- | ---------------------------------------- |
| POST   | `/agent/:agentId/run`            | Start an agent run                       |
| POST   | `/agent/:agentId/connect`        | Connect to an existing thread            |
| POST   | `/agent/:agentId/stop/:threadId` | Stop a running agent                     |
| GET    | `/info`                          | Runtime info (version, available agents) |
| POST   | `/transcribe`                    | Audio transcription                      |
| GET    | `/threads`                       | List threads (Intelligence mode)         |
| POST   | `/threads/subscribe`             | Subscribe to thread updates              |
| PATCH  | `/threads/:threadId`             | Update thread metadata                   |
| POST   | `/threads/:threadId/archive`     | Archive a thread                         |
| DELETE | `/threads/:threadId`             | Delete a thread                          |

**Hono (`createCopilotHonoHandler`):**

```typescript
import {
  CopilotRuntime,
  createCopilotHonoHandler,
} from "@copilotkit/runtime/v2";

const app = createCopilotHonoHandler({
  runtime,
  basePath: "/api/copilotkit",
  cors: {
    // optional CORS config
    origin: "https://myapp.com", // string, string[], or function
    credentials: true, // enable for HTTP-only cookies
  },
});
```

**Express (`createCopilotExpressHandler`):**

```typescript
import { createCopilotExpressHandler } from "@copilotkit/runtime/v2/express";

const router = createCopilotExpressHandler({
  runtime,
  basePath: "/api/copilotkit",
});
app.use(router);
```

### Single-Route Endpoints

All operations go through a single POST endpoint. The operation is identified by a `method` field in the JSON body. This is simpler to deploy (one route, no catch-all needed). Use the same factories with `mode: "single-route"`.

**Hono (`createCopilotHonoHandler` with `mode: "single-route"`):**

```typescript
import {
  CopilotRuntime,
  createCopilotHonoHandler,
} from "@copilotkit/runtime/v2";

const app = createCopilotHonoHandler({
  runtime,
  basePath: "/api/copilotkit",
  mode: "single-route",
});
```

**Express (`createCopilotExpressHandler` with `mode: "single-route"`):**

```typescript
import { createCopilotExpressHandler } from "@copilotkit/runtime/v2/express";

const router = createCopilotExpressHandler({
  runtime,
  basePath: "/", // relative to where it's mounted
  mode: "single-route",
});
app.use("/api/copilotkit", router);
```

### When to Use Which

| Scenario                                   | Recommended                                                                   |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| Next.js App Router                         | Multi-route Hono (`createCopilotHonoHandler`) via `[[...slug]]` catch-all     |
| Next.js App Router (no catch-all desired)  | Single-route Hono (`createCopilotHonoHandler` + `mode: "single-route"`)       |
| Standalone Express server                  | Single-route Express (`createCopilotExpressHandler` + `mode: "single-route"`) |
| Standalone Hono/Node server                | Multi-route Hono (`createCopilotHonoHandler`)                                 |
| Need thread management (Intelligence mode) | Multi-route only (thread endpoints not available in single-route)             |

## Middleware

The runtime supports before/after request middleware for cross-cutting concerns (auth, logging, rate limiting).

```typescript
const runtime = new CopilotRuntime({
  agents: { default: agent },
  beforeRequestMiddleware: async ({ request, path }) => {
    // Validate auth, return modified request or void
    const token = request.headers.get("Authorization");
    if (!token) {
      throw new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      });
    }
    return request; // or return void to pass through unchanged
  },
  afterRequestMiddleware: async ({ response, path, messages, threadId }) => {
    // Log, audit, etc. Non-blocking (errors are caught and logged).
    console.log(`Completed request to ${path}, thread: ${threadId}`);
  },
});
```

`afterRequestMiddleware` receives reconstructed `messages` from the SSE stream and the `threadId`/`runId` extracted from the `RUN_STARTED` event.

## CORS

All endpoint factories enable CORS by default with `origin: "*"`. For production with credentials (cookies), configure explicit origins:

**Hono endpoints:**

```typescript
createCopilotHonoHandler({
  runtime,
  basePath: "/api/copilotkit",
  cors: {
    origin: "https://myapp.com",
    credentials: true,
  },
});
```

**Express endpoints:** CORS is handled internally via the `cors` middleware with permissive defaults. Customize by wrapping the router or adding your own CORS middleware upstream.

**Frontend side:** Set `credentials: "include"` on the `CopilotKit` provider to send cookies:

```tsx
<CopilotKit
  runtimeUrl="/api/copilotkit"
  useSingleEndpoint={false}
  credentials="include"
>
```
