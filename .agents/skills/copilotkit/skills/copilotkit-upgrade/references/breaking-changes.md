# CopilotKit v2 Breaking Changes

## Package Structure

### Consolidated React packages

v1 split React functionality across three packages:
- `@copilotkit/react-core` -- provider, hooks, types
- `@copilotkit/react-ui` -- chat components (CopilotChat, CopilotPopup, CopilotSidebar)
- `@copilotkit/react-textarea` -- CopilotTextarea component

v2 consolidates everything into a single package:
- `@copilotkit/react` -- provider, hooks, types, chat components, AG-UI re-exports

### New package scope

The v2 API is exposed through the same `@copilotkit/*` packages. No package name changes are required when upgrading.

### Removed packages

| Package | Status |
|---------|--------|
| `@copilotkit/react-textarea` | Removed. No v2 equivalent. |
| `@copilotkit/runtime-client-gql` | Replaced by `@ag-ui/client` (re-exported from `@copilotkit/react`) |
| `@copilotkit/sdk-js` | Replaced by `@copilotkit/agent` |

---

## Protocol Change: GraphQL to AG-UI

The most fundamental breaking change is the protocol layer. v1 used a GraphQL-based protocol (`@copilotkit/runtime-client-gql`). v2 uses the AG-UI protocol (`@ag-ui/client` / `@ag-ui/core`), which is SSE-based.

**Impact:**
- All GraphQL message types (`TextMessage`, `ActionExecutionMessage`, `ResultMessage`, etc.) are replaced by AG-UI event types (`TextMessageChunkEvent`, `ToolCallStartEvent`, `ToolCallArgsEvent`, `ToolCallEndEvent`, `ToolCallResultEvent`, etc.)
- The `MessageRole` enum is replaced by AG-UI message roles
- Custom GraphQL queries/mutations against the runtime are no longer possible
- The runtime no longer exposes a GraphQL endpoint

---

## Provider Changes

### Component rename

`CopilotKit` is renamed to `CopilotKitProvider`.

### Props changes

| v1 Prop | v2 Status | Notes |
|---------|----------|-------|
| `runtimeUrl` | Kept | Same behavior |
| `headers` | Kept | Same behavior |
| `publicApiKey` | Kept | Same behavior (also `publicLicenseKey` alias) |
| `properties` | Kept | Same behavior |
| `agents` | Removed | Use `selfManagedAgents` or `agents__unsafe_dev_only` |
| `guardrails_c` | Removed | -- |
| `children` | Kept | Same behavior |
| -- | Added: `credentials` | `RequestCredentials` for fetch (e.g., `"include"` for cookies) |
| -- | Added: `selfManagedAgents` | `Record<string, AbstractAgent>` for client-side agents |
| -- | Added: `renderToolCalls` | `ReactToolCallRenderer[]` for provider-level tool renderers |
| -- | Added: `renderActivityMessages` | `ReactActivityMessageRenderer[]` for activity renderers |
| -- | Added: `useSingleEndpoint` | Boolean to use single-route endpoint mode |

### Context hook rename

`useCopilotContext` is replaced by `useCopilotKit` which returns `{ copilotkit: CopilotKitCoreReact }`.

---

## Hook Renames and API Changes

### useCopilotAction -> useFrontendTool

**Parameter definition change:** v1 used a custom parameter descriptor format. v2 uses Zod schemas.

```ts
// v1 parameters
parameters: [
  { name: "city", type: "string", description: "City name", required: true },
  { name: "units", type: "string", enum: ["celsius", "fahrenheit"] },
]

// v2 parameters (Zod)
parameters: z.object({
  city: z.string().describe("City name"),
  units: z.enum(["celsius", "fahrenheit"]).optional(),
})
```

**Handler signature change:**

```ts
// v1
handler: ({ city, units }) => { ... }

// v2
handler: async (args) => { ... }  // args is typed from the Zod schema
```

**Render props change:**

```ts
// v1 render status: "inProgress" | "executing" | "complete"
// v1 uses `respond()` callback for interactive actions

// v2 render status: ToolCallStatus.InProgress | ToolCallStatus.Executing | ToolCallStatus.Complete
// v2 render props: { name, args, status, result }
```

**Availability change:**
```ts
// v1
disabled: true  // or available: "disabled"

// v2
available: "disabled" | "enabled"
```

### useCopilotReadable -> useAgentContext

**Breaking:** The `parentId` parameter for hierarchical context is removed. Flatten nested contexts.

```ts
// v1 (hierarchical)
const parentId = useCopilotReadable({ description: "Parent", value: "..." });
useCopilotReadable({ description: "Child", value: "...", parentId });

// v2 (flat)
useAgentContext({ description: "Parent - Child context", value: { parent: "...", child: "..." } });
```

### useCoAgent -> useAgent

**Breaking:** Completely different return type.

```ts
// v1 returns
{ name, nodeName, state, setState, running, start, stop, run }

// v2 returns
AbstractAgent  // AG-UI agent instance with run(), stop(), etc.
```

- `name` -> `agentId` (in props)
- `initialState` -> removed (no client-side state initialization)
- `setState` -> removed (state flows via AG-UI events)
- `nodeName` -> removed
- `state` -> accessed through AG-UI `StateSnapshotEvent` / `StateDeltaEvent`

### useLangGraphInterrupt -> useInterrupt

**Breaking:** Different API shape.

- `agentName` -> `agentId`
- `nodeName` -> removed (use `enabled` predicate to filter)
- `render` props change: receives `InterruptRenderProps<TValue, TResult>` instead of v1's `{ event, resolve }`
- New `renderInChat` prop (default `true`) controls whether interrupt renders inside CopilotChat
- New `handler` prop for programmatic handling before rendering
- New `enabled` predicate prop for filtering interrupts

### useCopilotChat -> removed

Replaced by `useAgent` for agent interaction. The headless chat API (appendMessage, visibleMessages, etc.) is replaced by the AG-UI agent event stream.

### useCopilotChatSuggestions -> useConfigureSuggestions + useSuggestions

Split into two hooks: one for configuration, one for reading state.

### useCoAgentStateRender -> useRenderToolCall / useRenderActivityMessage

Split into two hooks based on the type of rendering needed.

### useCopilotAdditionalInstructions -> useAgentContext

Use `useAgentContext` with an appropriate description to provide instructions.

### useMakeCopilotDocumentReadable -> useAgentContext

Use `useAgentContext` to pass document content. The `DocumentPointer` type and category-based filtering are removed.

---

## Runtime Breaking Changes

### Service adapters removed

All service adapters are removed from the runtime:

| Removed Adapter | v2 Alternative |
|----------------|---------------|
| `OpenAIAdapter` | Use `BuiltInAgent({ model: "openai:gpt-4o" })` |
| `AnthropicAdapter` | Use `BuiltInAgent({ model: "anthropic:claude-sonnet-4-20250514" })` |
| `GoogleGenerativeAIAdapter` | Use `BuiltInAgent({ model: "google:gemini-pro" })` |
| `LangChainAdapter` | Use a custom `AbstractAgent` implementation |
| `GroqAdapter` | Use `BuiltInAgent` with Groq-compatible model string |
| `UnifyAdapter` | Use a custom `AbstractAgent` implementation |
| `OpenAIAssistantAdapter` | Use a custom `AbstractAgent` implementation |
| `BedrockAdapter` | Use `BuiltInAgent({ model: "vertex:..." })` or custom agent |
| `OllamaAdapter` | Use a custom `AbstractAgent` implementation |
| `EmptyAdapter` | Not needed |

### Runtime constructor changes

```ts
// v1
new CopilotRuntime({
  actions: [...],                    // Removed
  remoteEndpoints: [...],            // Removed
  remoteActions: [...],              // Removed
  onBeforeRequest: (options) => {},  // Deprecated
  onAfterRequest: (options) => {},   // Deprecated
})

// v2
new CopilotRuntime({
  agents: { ... },                         // Required: Record<string, AbstractAgent>
  transcriptionService: ...,               // Optional: TranscriptionService
  beforeRequestMiddleware: ...,            // Optional: BeforeRequestMiddleware
  afterRequestMiddleware: ...,             // Optional: AfterRequestMiddleware
  a2ui: { ... },                           // Optional: A2UIMiddleware config
  mcpApps: { servers: [...] },             // Optional: MCP Apps middleware
  // Intelligence mode only:
  intelligence: new CopilotKitIntelligence({ ... }),
  identifyUser: (request) => ({ id: "..." }),
  generateThreadNames: true,
})
```

### Framework integrations removed

v1 had built-in integrations for Next.js (App Router, Pages Router), Express, NestJS, and Node HTTP. v2 uses Hono as the standard HTTP layer:

| v1 Integration | v2 Replacement |
|---------------|---------------|
| `copilotRuntimeNextJSAppRouterEndpoint` | `createCopilotEndpoint` (Hono, works with Next.js) |
| `copilotRuntimeNextJSPagesRouterEndpoint` | `createCopilotEndpoint` (Hono) |
| `CopilotRuntimeNodeExpressEndpoint` | `createCopilotEndpointExpress` |
| `CopilotRuntimeNestEndpoint` | Use Hono adapter or Express endpoint |
| `CopilotRuntimeNodeHttpEndpoint` | Use Hono or Express endpoint |

### Endpoint configuration

```ts
// v1 (Next.js App Router example)
import { copilotRuntimeNextJSAppRouterEndpoint } from "@copilotkit/runtime";

export const POST = copilotRuntimeNextJSAppRouterEndpoint({
  runtime,
  serviceAdapter,
  endpoint: "/api/copilotkit",
});

// v2
import { createCopilotEndpoint } from "@copilotkit/runtime";

const app = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
  cors: {
    origin: "https://myapp.com",
    credentials: true,
  },
});

// For Next.js App Router, export the Hono app's fetch handler
export const POST = app.fetch;
export const GET = app.fetch;
```

### LangGraph agent configuration

```ts
// v1 (remote endpoint)
new CopilotRuntime({
  remoteEndpoints: [
    {
      url: "http://localhost:8000/copilotkit",
      type: "langgraph",
    },
  ],
})

// v2 (direct agent instance)
import { LangGraphAgent } from "@ag-ui/langgraph";

new CopilotRuntime({
  agents: {
    myAgent: new LangGraphAgent({
      url: "http://localhost:8000",
      graphId: "my-graph",
    }),
  },
})
```

---

## Type System Changes

### Parameter types

v1 used a custom `Parameter` type for defining tool parameters:

```ts
type Parameter = {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "string[]" | "number[]" | "boolean[]" | "object[]";
  description?: string;
  required?: boolean;
  enum?: string[];
  attributes?: Parameter[];  // for object types
};
```

v2 uses Zod schemas (`z.object(...)`) or Standard Schema V1 (`StandardSchemaV1`).

### Message types

v1 GraphQL types from `@copilotkit/runtime-client-gql` are replaced by AG-UI types:

| v1 Type | v2 Type |
|---------|---------|
| `TextMessage` | `Message` with text content |
| `ActionExecutionMessage` | `ToolCall` |
| `ResultMessage` | `ToolMessage` |
| `MessageRole` | AG-UI role types |

### Event types

v2 introduces AG-UI event types for streaming:

- `RunStartedEvent`, `RunFinishedEvent`, `RunErrorEvent`
- `TextMessageChunkEvent`
- `ToolCallStartEvent`, `ToolCallArgsEvent`, `ToolCallEndEvent`, `ToolCallResultEvent`
- `StateSnapshotEvent`, `StateDeltaEvent`
- `ReasoningStartEvent`, `ReasoningMessageStartEvent`, `ReasoningMessageContentEvent`, `ReasoningMessageEndEvent`, `ReasoningEndEvent`
