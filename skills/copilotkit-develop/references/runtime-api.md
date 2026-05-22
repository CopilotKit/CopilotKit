# CopilotKit v2 Runtime API Reference

Package: `@copilotkit/runtime`

---

## Runtime Classes

### CopilotRuntime

Compatibility shim that auto-detects the mode based on whether `intelligence` is provided. Delegates to `CopilotSseRuntime` or `CopilotIntelligenceRuntime`.

```ts
import { CopilotRuntime } from "@copilotkit/runtime";

const runtime = new CopilotRuntime({
  agents: { myAgent: new LangGraphAgent({ ... }) },
  // If intelligence is provided, uses Intelligence mode; otherwise SSE mode
});
```

### CopilotSseRuntime

Explicit SSE-mode runtime. Agents run in-memory via `InMemoryAgentRunner`.

```ts
import { CopilotSseRuntime } from "@copilotkit/runtime";

const runtime = new CopilotSseRuntime({
  agents: { myAgent: agent },
  runner?: AgentRunner,  // default: InMemoryAgentRunner
});
```

### CopilotIntelligenceRuntime

Intelligence-mode runtime with durable threads, realtime events, and persistent state.

```ts
import {
  CopilotIntelligenceRuntime,
  CopilotKitIntelligence,
} from "@copilotkit/runtime";

const runtime = new CopilotIntelligenceRuntime({
  agents: { myAgent: agent },
  intelligence: new CopilotKitIntelligence({ ... }),
  identifyUser: async (request) => ({ id: getUserIdFromRequest(request) }),
  generateThreadNames?: boolean,  // default: true
});
```

---

## Runtime Options

All runtime constructors accept these base options:

```ts
interface BaseCopilotRuntimeOptions {
  // Map of available agents. Can be a promise for lazy loading.
  agents: MaybePromise<Record<string, AbstractAgent>>;

  // Optional transcription service for audio processing
  transcriptionService?: TranscriptionService;

  // Middleware hooks
  beforeRequestMiddleware?: BeforeRequestMiddleware;
  afterRequestMiddleware?: AfterRequestMiddleware;

  // Auto-apply A2UI middleware to agents
  a2ui?: {
    agents?: string[];  // Limit to specific agents; omit for all
    // ... A2UIMiddlewareConfig from @ag-ui/a2ui-middleware
  };

  // Auto-apply MCP Apps middleware
  mcpApps?: {
    servers: McpAppsServerConfig[];
  };
}
```

### McpAppsServerConfig

```ts
type McpAppsServerConfig = MCPClientConfig & {
  agentId?: string;  // Bind to specific agent; omit for all agents
};
```

---

## Endpoint Factories

### createCopilotEndpoint (Hono)

```ts
import { createCopilotEndpoint } from "@copilotkit/runtime";

const app = createCopilotEndpoint({
  runtime: CopilotRuntimeLike,
  basePath: string,
  cors?: {
    origin: string | string[] | ((origin: string) => string | null);
    credentials?: boolean;
  },
});
```

Returns a Hono app instance with all CopilotKit routes mounted under `basePath`.

### createCopilotEndpointExpress (Express)

```ts
import { createCopilotEndpointExpress } from "@copilotkit/runtime";

const router = createCopilotEndpointExpress({
  runtime: CopilotRuntimeLike,
  basePath: string,
});

// Use in Express app:
app.use(router);
```

Returns an Express `Router` with all CopilotKit routes mounted under `basePath`.

---

## HTTP Routes

Both endpoint factories create these routes under `basePath`:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/info` | Runtime info: available agents, mode, capabilities |
| `POST` | `/agent/:agentId/run` | Run an agent (SSE stream response) |
| `POST` | `/agent/:agentId/connect` | Connect to an agent (initial handshake for existing threads) |
| `POST` | `/agent/:agentId/stop/:threadId` | Stop a running agent |
| `POST` | `/transcribe` | Transcribe audio file |
| `GET` | `/threads` | List threads (Intelligence mode) |
| `POST` | `/threads/subscribe` | Subscribe to thread updates (Intelligence mode) |
| `PATCH` | `/threads/:threadId` | Update thread metadata |
| `POST` | `/threads/:threadId/archive` | Archive a thread |
| `DELETE` | `/threads/:threadId` | Permanently delete a thread |

---

## Middleware

### BeforeRequestMiddleware

Called before each request handler. Can modify or replace the request.

```ts
type BeforeRequestMiddleware = (params: {
  runtime: CopilotRuntimeLike;
  request: Request;
  path: string;
}) => MaybePromise<Request | void>;
```

If a `Request` is returned, it replaces the original request for the handler.

### AfterRequestMiddleware

Called after each request handler. Receives the response and parsed SSE messages.

```ts
type AfterRequestMiddleware = (params: {
  runtime: CopilotRuntimeLike;
  response: Response;
  path: string;
  messages?: Message[];    // Reconstructed from SSE stream
  threadId?: string;       // From RUN_STARTED event
  runId?: string;          // From RUN_STARTED event
}) => MaybePromise<void>;
```

### Example

```ts
const runtime = new CopilotRuntime({
  agents: { myAgent: agent },
  beforeRequestMiddleware: async ({ request, path }) => {
    console.log(`Incoming request to ${path}`);
    // Optionally return a modified Request
  },
  afterRequestMiddleware: async ({ response, path, threadId, messages }) => {
    console.log(`Response from ${path}, thread: ${threadId}, ${messages?.length} messages`);
  },
});
```

---

## Intelligence Platform

### CopilotKitIntelligence

Client for the CopilotKit Intelligence platform (durable threads, realtime WebSocket).

```ts
import { CopilotKitIntelligence } from "@copilotkit/runtime";

const intelligence = new CopilotKitIntelligence({
  // Configuration for the Intelligence platform
  // (API keys, URLs, etc.)
});
```

### identifyUser

Required for Intelligence mode. Resolves the authenticated user from the incoming request.

```ts
type IdentifyUserCallback = (request: Request) => MaybePromise<{ id: string }>;
```

### Thread Management Types

```ts
interface CreateThreadRequest { /* platform-specific */ }
interface ThreadSummary { /* id, name, timestamps */ }
interface ListThreadsResponse { /* thread list */ }
interface UpdateThreadRequest { /* name updates */ }
interface SubscribeToThreadsRequest { /* WebSocket subscription params */ }
interface SubscribeToThreadsResponse { /* realtime thread updates */ }
```

---

## Agent Runners

### AgentRunner (abstract)

Base class for executing agents. Custom runners can be implemented for custom execution environments.

### InMemoryAgentRunner

Default runner for SSE mode. Runs agents in the Node.js process.

### IntelligenceAgentRunner

Runner for Intelligence mode. Delegates execution to the Intelligence platform via WebSocket.

---

## Transcription Service

### TranscriptionService (abstract)

```ts
interface TranscribeFileOptions {
  audioFile: File;
  mimeType?: string;
  size?: number;
}

abstract class TranscriptionService {
  abstract transcribeFile(options: TranscribeFileOptions): Promise<string>;
}
```

Implement this class to provide audio-to-text transcription. The runtime exposes it via the `/transcribe` endpoint.

---

## CORS Configuration

The Hono endpoint factory accepts explicit CORS configuration:

```ts
createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
  cors: {
    origin: "https://myapp.com",  // or array, or function
    credentials: true,            // for HTTP-only cookies
  },
});
```

When `credentials` is `true`, `origin` must be explicitly specified (cannot be `"*"`).

The Express endpoint factory uses `cors({ origin: "*" })` by default. Override by wrapping or configuring the Express cors middleware separately.

---

## Complete Example: Next.js API Route (using Hono)

```ts
// app/api/copilotkit/[[...path]]/route.ts
import { CopilotRuntime, createCopilotEndpoint } from "@copilotkit/runtime";
import { LangGraphAgent } from "@ag-ui/langgraph";

const runtime = new CopilotRuntime({
  agents: {
    researcher: new LangGraphAgent({
      graphId: "researcher",
      url: process.env.LANGGRAPH_URL!,
    }),
  },
});

const app = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = app.fetch;
export const POST = app.fetch;
export const PATCH = app.fetch;
export const DELETE = app.fetch;
```

## Complete Example: Express

```ts
import express from "express";
import {
  CopilotRuntime,
  createCopilotEndpointExpress,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@ag-ui/langgraph";

const app = express();

const runtime = new CopilotRuntime({
  agents: {
    researcher: new LangGraphAgent({
      graphId: "researcher",
      url: process.env.LANGGRAPH_URL!,
    }),
  },
});

app.use(
  createCopilotEndpointExpress({
    runtime,
    basePath: "/api/copilotkit",
  }),
);

app.listen(3000);
```
