# Runtime Architecture

The CopilotKit v2 runtime (`@copilotkit/runtime`) is the server-side component that manages agent execution, thread state, and communication with the frontend via the AG-UI protocol (SSE-based events).

## Core Concepts

### CopilotRuntime

`CopilotRuntime` is the main entry point. It is a compatibility shim that delegates to either `CopilotSseRuntime` (default) or `CopilotIntelligenceRuntime` depending on configuration.

```typescript
import { CopilotRuntime } from "@copilotkit/runtime";

// SSE mode (default) -- in-memory thread state
const runtime = new CopilotRuntime({
  agents: { default: myAgent },
  runner: new InMemoryAgentRunner(),  // optional, this is the default
});

// Intelligence mode -- durable threads via CopilotKit Intelligence Platform
const runtime = new CopilotRuntime({
  agents: { default: myAgent },
  intelligence: new CopilotKitIntelligence({ ... }),
  identifyUser: (request) => ({ id: "user-123" }),
});
```

**Constructor options (`CopilotRuntimeOptions`):**

| Option | Type | Description |
|---|---|---|
| `agents` | `Record<string, AbstractAgent>` | Map of named agents. Must have at least one entry. |
| `runner` | `AgentRunner` | Agent execution strategy. Defaults to `InMemoryAgentRunner`. |
| `intelligence` | `CopilotKitIntelligence` | Enables Intelligence mode with durable threads. |
| `identifyUser` | `(request: Request) => CopilotRuntimeUser` | Required with Intelligence mode. Resolves authenticated user. |
| `generateThreadNames` | `boolean` | Auto-generate thread names (Intelligence mode only, default: `true`). |
| `transcriptionService` | `TranscriptionService` | Optional audio transcription (e.g., `TranscriptionServiceOpenAI`). |
| `beforeRequestMiddleware` | `BeforeRequestMiddleware` | Callback or webhook URL invoked before each request. |
| `afterRequestMiddleware` | `AfterRequestMiddleware` | Callback or webhook URL invoked after each request. |
| `a2ui` | `{ agents?: string[] } & A2UIMiddlewareConfig` | Auto-apply A2UI (Agent-to-UI) middleware to agents. |
| `mcpApps` | `{ servers: McpAppsServerConfig[] }` | Auto-apply MCP Apps middleware with MCP server configs. |

### Agents

Agents implement the `AbstractAgent` interface from `@ag-ui/client`. CopilotKit provides `BuiltInAgent` (from `@copilotkit/agent`) as a ready-to-use implementation backed by the Vercel AI SDK.

```typescript
import { BuiltInAgent, defineTool } from "@copilotkit/agent";
import { z } from "zod";

const agent = new BuiltInAgent({
  model: "openai/gpt-4o",         // "provider/model" string or LanguageModel instance
  prompt: "You are helpful.",       // System prompt
  temperature: 0.7,                // Sampling temperature
  maxSteps: 5,                     // Max tool-calling iterations (default: 1)
  tools: [                         // Server-side tools
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

`BasicAgent` is an alias for `BuiltInAgent` (same class, exported for convenience).

**BuiltInAgent configuration:**

| Option | Type | Description |
|---|---|---|
| `model` | `string \| LanguageModel` | Model identifier (e.g., `"openai/gpt-4o"`) or AI SDK LanguageModel |
| `apiKey` | `string` | Provider API key (falls back to env vars) |
| `prompt` | `string` | System prompt |
| `temperature` | `number` | Sampling temperature |
| `maxSteps` | `number` | Max tool-calling iterations (default: 1) |
| `maxOutputTokens` | `number` | Max tokens to generate |
| `toolChoice` | `ToolChoice` | How tools are selected (`"auto"`, `"required"`, `"none"`, or specific) |
| `tools` | `ToolDefinition[]` | Server-side tools available to the agent |
| `mcpServers` | `MCPClientConfig[]` | MCP server connections for dynamic tool discovery |
| `providerOptions` | `Record<string, any>` | Provider-specific options (e.g., `{ openai: { reasoningEffort: "high" } }`) |
| `overridableProperties` | `OverridableProperty[]` | Properties the frontend can override via forwarded props |
| `forwardSystemMessages` | `boolean` | Forward system-role messages from input (default: `false`) |
| `forwardDeveloperMessages` | `boolean` | Forward developer-role messages as system messages (default: `false`) |

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

Endpoint factories create HTTP handlers that expose the runtime's functionality. There are four variants across two HTTP frameworks (Hono, Express) and two routing styles (multi-route, single-route).

### Multi-Route Endpoints

Each operation gets its own HTTP path under the base path:

| Method | Path | Handler |
|---|---|---|
| POST | `/agent/:agentId/run` | Start an agent run |
| POST | `/agent/:agentId/connect` | Connect to an existing thread |
| POST | `/agent/:agentId/stop/:threadId` | Stop a running agent |
| GET | `/info` | Runtime info (version, available agents) |
| POST | `/transcribe` | Audio transcription |
| GET | `/threads` | List threads (Intelligence mode) |
| POST | `/threads/subscribe` | Subscribe to thread updates |
| PATCH | `/threads/:threadId` | Update thread metadata |
| POST | `/threads/:threadId/archive` | Archive a thread |
| DELETE | `/threads/:threadId` | Delete a thread |

**Hono (`createCopilotEndpoint`):**
```typescript
import { CopilotRuntime, createCopilotEndpoint } from "@copilotkit/runtime";

const app = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
  cors: {                           // optional CORS config
    origin: "https://myapp.com",    // string, string[], or function
    credentials: true,              // enable for HTTP-only cookies
  },
});
```

**Express (`createCopilotEndpointExpress`):**
```typescript
import { createCopilotEndpointExpress } from "@copilotkit/runtime/express";

const router = createCopilotEndpointExpress({
  runtime,
  basePath: "/api/copilotkit",
});
app.use(router);
```

### Single-Route Endpoints

All operations go through a single POST endpoint. The operation is identified by a `method` field in the JSON body. This is simpler to deploy (one route, no catch-all needed).

**Hono (`createCopilotEndpointSingleRoute`):**
```typescript
import { CopilotRuntime, createCopilotEndpointSingleRoute } from "@copilotkit/runtime";

const app = createCopilotEndpointSingleRoute({
  runtime,
  basePath: "/api/copilotkit",
});
```

**Express (`createCopilotEndpointSingleRouteExpress`):**
```typescript
import { createCopilotEndpointSingleRouteExpress } from "@copilotkit/runtime/express";

const router = createCopilotEndpointSingleRouteExpress({
  runtime,
  basePath: "/",  // relative to where it's mounted
});
app.use("/api/copilotkit", router);
```

### When to Use Which

| Scenario | Recommended |
|---|---|
| Next.js App Router | Multi-route Hono (`createCopilotEndpoint`) via `[[...slug]]` catch-all |
| Next.js App Router (no catch-all desired) | Single-route Hono (`createCopilotEndpointSingleRoute`) |
| Standalone Express server | Single-route Express (`createCopilotEndpointSingleRouteExpress`) |
| Standalone Hono/Node server | Multi-route Hono (`createCopilotEndpoint`) |
| Need thread management (Intelligence mode) | Multi-route only (thread endpoints not available in single-route) |

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
    return request;  // or return void to pass through unchanged
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
createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
  cors: {
    origin: "https://myapp.com",
    credentials: true,
  },
});
```

**Express endpoints:** CORS is handled internally via the `cors` middleware with permissive defaults. Customize by wrapping the router or adding your own CORS middleware upstream.

**Frontend side:** Set `credentials: "include"` on `CopilotKitProvider` to send cookies:
```tsx
<CopilotKitProvider runtimeUrl="/api/copilotkit" credentials="include">
```
