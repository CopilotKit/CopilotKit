# CopilotKit v1 to v2 Migration Guide

## Package Migration

### Step 1: Replace Dependencies

Remove v1 packages and install v2 equivalents:

```bash
# Remove v1
npm uninstall @copilotkit/react-core @copilotkit/react-ui @copilotkit/react-textarea \
  @copilotkit/runtime @copilotkit/runtime-client-gql @copilotkit/shared @copilotkit/sdk-js

# Install v2
npm install @copilotkit/react @copilotkit/runtime @copilotkit/agent @copilotkit/shared
```

**Package mapping:**

| v1 Package | v2 Package | Notes |
|-----------|-----------|-------|
| `@copilotkit/react-core` | `@copilotkit/react` | Hooks, provider, types merged into one package |
| `@copilotkit/react-ui` | `@copilotkit/react` | Chat components merged into same package |
| `@copilotkit/react-textarea` | -- | Removed entirely, no v2 equivalent |
| `@copilotkit/runtime` | `@copilotkit/runtime` | New agent-based architecture |
| `@copilotkit/runtime-client-gql` | `@ag-ui/client` | Re-exported by `@copilotkit/react` |
| `@copilotkit/shared` | `@copilotkit/shared` | Utility types and constants |
| `@copilotkit/sdk-js` | `@copilotkit/agent` | Agent definitions (BuiltInAgent, etc.) |

### Step 2: Update All Imports

Find-and-replace import paths across your codebase:

```
@copilotkit/react-core  ->  @copilotkit/react
@copilotkit/react-ui    ->  @copilotkit/react
@copilotkit/runtime     ->  @copilotkit/runtime
@copilotkit/shared      ->  @copilotkit/shared
```

---

## Provider Migration

### v1: `CopilotKit`

```tsx
import { CopilotKit } from "@copilotkit/react-core";

function App() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit">
      <MyApp />
    </CopilotKit>
  );
}
```

### v2: `CopilotKitProvider`

```tsx
import { CopilotKitProvider } from "@copilotkit/react";

function App() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit">
      <MyApp />
    </CopilotKitProvider>
  );
}
```

**Key differences:**
- Component renamed from `CopilotKit` to `CopilotKitProvider`
- Props type renamed from `CopilotKitProps` to `CopilotKitProviderProps`
- v2 adds `credentials`, `selfManagedAgents`, `renderToolCalls`, `renderActivityMessages` props
- v2 removes `agents` prop (use `selfManagedAgents` or `agents__unsafe_dev_only` for local dev)

---

## Hook Migrations

### useCopilotAction -> useFrontendTool

**v1:**
```tsx
import { useCopilotAction } from "@copilotkit/react-core";

useCopilotAction({
  name: "addTodo",
  description: "Add a new todo item",
  parameters: [
    { name: "title", type: "string", description: "Todo title", required: true },
    { name: "priority", type: "number", description: "Priority 1-5" },
  ],
  handler: ({ title, priority }) => {
    addTodo({ title, priority: priority ?? 3 });
  },
  render: ({ status, args }) => (
    <div>Adding: {args.title} (status: {status})</div>
  ),
});
```

**v2:**
```tsx
import { useFrontendTool } from "@copilotkit/react";
import { z } from "zod";

useFrontendTool({
  name: "addTodo",
  description: "Add a new todo item",
  parameters: z.object({
    title: z.string().describe("Todo title"),
    priority: z.number().optional().describe("Priority 1-5"),
  }),
  handler: async (args) => {
    addTodo({ title: args.title, priority: args.priority ?? 3 });
  },
  render: ({ status, args }) => (
    <div>Adding: {args.title} (status: {status})</div>
  ),
});
```

**Key differences:**
- Hook renamed from `useCopilotAction` to `useFrontendTool`
- Parameters use Zod schemas instead of the v1 parameter descriptor array (`{ name, type, required }`)
- The `handler` receives the full args object directly (not destructured from `{ arg1, arg2 }`)
- The `render` prop works similarly but uses `ToolCallStatus` enum (`"inProgress"`, `"executing"`, `"complete"`)
- v2 adds `available` prop (`"enabled"` | `"disabled"`) replacing the v1 `disabled` boolean
- v2 adds `agentId` prop to scope a tool to a specific agent

### useCopilotReadable -> useAgentContext

**v1:**
```tsx
import { useCopilotReadable } from "@copilotkit/react-core";

function EmployeeList({ employees }) {
  useCopilotReadable({
    description: "The list of employees",
    value: employees,
  });

  return <div>...</div>;
}
```

**v2:**
```tsx
import { useAgentContext } from "@copilotkit/react";

function EmployeeList({ employees }) {
  useAgentContext({
    description: "The list of employees",
    value: employees,
  });

  return <div>...</div>;
}
```

**Key differences:**
- Hook renamed from `useCopilotReadable` to `useAgentContext`
- The `parentId` hierarchical context feature from v1 is not available in v2; flatten your context instead
- The `value` prop accepts `JsonSerializable` (string, number, boolean, null, arrays, objects) -- objects are auto-serialized to JSON strings

### useMakeCopilotDocumentReadable -> useAgentContext

**v1:**
```tsx
import { useMakeCopilotDocumentReadable } from "@copilotkit/react-core";

useMakeCopilotDocumentReadable(documentPointer, ["category1"]);
```

**v2:**
```tsx
import { useAgentContext } from "@copilotkit/react";

useAgentContext({
  description: "Document content for category1",
  value: documentContent,
});
```

**Key differences:**
- No direct `DocumentPointer` equivalent in v2; pass document content directly via `useAgentContext`
- Categories are not supported; use the `description` field to provide context

### useCoAgent -> useAgent

**v1:**
```tsx
import { useCoAgent } from "@copilotkit/react-core";

type AgentState = { count: number };

const { name, state, setState, running, start, stop, run } = useCoAgent<AgentState>({
  name: "my-agent",
  initialState: { count: 0 },
});
```

**v2:**
```tsx
import { useAgent } from "@copilotkit/react";

const agent = useAgent({ agentId: "my-agent" });

// Access agent state, messages, run status through the AbstractAgent interface
// agent.run(), agent.stop(), etc.
```

**Key differences:**
- Hook renamed from `useCoAgent` to `useAgent`
- `name` prop renamed to `agentId`
- v2 does not have `initialState` / `setState` -- agent state is managed through AG-UI protocol events (`StateSnapshotEvent`, `StateDeltaEvent`)
- v2 returns an `AbstractAgent` instance instead of a destructured state object
- The `run` / `start` / `stop` API surface differs -- v2 uses AG-UI protocol methods

### useCoAgentStateRender -> useRenderToolCall / useRenderActivityMessage

**v1:**
```tsx
import { useCoAgentStateRender } from "@copilotkit/react-core";

useCoAgentStateRender<YourAgentState>({
  name: "basic_agent",
  nodeName: "search_node",
  render: ({ status, state, nodeName }) => (
    <SearchProgress state={state} status={status} />
  ),
});
```

**v2:**
```tsx
import { useRenderToolCall } from "@copilotkit/react";

// For tool call rendering:
useRenderToolCall({
  toolCall,
  toolMessage,
});

// Or for activity messages:
import { useRenderActivityMessage } from "@copilotkit/react";

useRenderActivityMessage({
  // renders activity/progress messages from the agent
});
```

**Key differences:**
- `useCoAgentStateRender` is split into `useRenderToolCall` (for tool execution UI) and `useRenderActivityMessage` (for progress/activity rendering)
- v2 does not have the `nodeName` filtering -- tool rendering is keyed by tool call ID
- v2 uses AG-UI `ToolCall` and `ToolMessage` types instead of the v1 agent state shape

### useLangGraphInterrupt -> useInterrupt

**v1:**
```tsx
import { useLangGraphInterrupt } from "@copilotkit/react-core";

useLangGraphInterrupt({
  name: "confirm-action",
  nodeName: "confirmation_node",
  agentName: "my-agent",
  render: ({ event, resolve }) => (
    <ConfirmDialog
      message={event.value}
      onConfirm={() => resolve("confirmed")}
      onCancel={() => resolve("cancelled")}
    />
  ),
});
```

**v2:**
```tsx
import { useInterrupt } from "@copilotkit/react";

const interruptElement = useInterrupt({
  renderInChat: false,  // false = you render it yourself; true = renders in CopilotChat
  render: ({ event, resolve }) => (
    <ConfirmDialog
      message={event.value}
      onConfirm={() => resolve("confirmed")}
      onCancel={() => resolve("cancelled")}
    />
  ),
  handler: async ({ event }) => {
    // Optional: handle programmatically before render
  },
  enabled: (event) => event.value?.type === "confirm",  // Optional filter
  agentId: "my-agent",
});

// If renderInChat is false, render interruptElement in your UI:
return <div>{interruptElement}</div>;
```

**Key differences:**
- Hook renamed from `useLangGraphInterrupt` to `useInterrupt`
- `agentName` renamed to `agentId`
- `nodeName` filtering removed; use the `enabled` predicate instead
- v2 adds `renderInChat` prop (default `true`) -- when true, interrupt UI renders inside `<CopilotChat>` automatically
- v2 adds optional `handler` for programmatic interrupt handling before rendering
- v2 returns a `React.ReactElement | null` when `renderInChat: false`

### useCopilotChat -> useAgent + useSuggestions

**v1:**
```tsx
import { useCopilotChat } from "@copilotkit/react-core";
import { TextMessage, MessageRole } from "@copilotkit/runtime-client-gql";

const { appendMessage, visibleMessages, isLoading, stopGeneration, reset } = useCopilotChat();

await appendMessage(new TextMessage({ role: MessageRole.User, content: "Hello" }));
```

**v2:**
```tsx
import { useAgent } from "@copilotkit/react";

const agent = useAgent({ agentId: "my-agent" });

// Messages, run status, etc. are available through the agent's AG-UI event stream
// Chat UI components (CopilotChat, CopilotPopup, CopilotSidebar) handle this automatically
```

**Key differences:**
- `useCopilotChat` is replaced by `useAgent` for agent interaction
- Message types change from `TextMessage`/`MessageRole` (GraphQL) to AG-UI event types
- For headless chat, use the `AbstractAgent` API directly

### useCopilotChatSuggestions -> useConfigureSuggestions + useSuggestions

**v1:**
```tsx
import { useCopilotChatSuggestions } from "@copilotkit/react-core";

useCopilotChatSuggestions({
  instructions: "Suggest helpful actions based on the current page",
  maxSuggestions: 3,
});
```

**v2:**
```tsx
import { useConfigureSuggestions, useSuggestions } from "@copilotkit/react";

// Configure suggestion generation:
useConfigureSuggestions({
  instructions: "Suggest helpful actions based on the current page",
  maxSuggestions: 3,
});

// Read suggestions:
const { suggestions, reloadSuggestions, clearSuggestions, isLoading } = useSuggestions({
  agentId: "my-agent",
});
```

**Key differences:**
- Split into two hooks: `useConfigureSuggestions` (write config) and `useSuggestions` (read state)
- `useSuggestions` returns `{ suggestions, reloadSuggestions, clearSuggestions, isLoading }`

### useCopilotAdditionalInstructions -> useAgentContext

**v1:**
```tsx
import { useCopilotAdditionalInstructions } from "@copilotkit/react-core";

useCopilotAdditionalInstructions({
  instructions: "Do not answer questions about the weather.",
});
```

**v2:**
```tsx
import { useAgentContext } from "@copilotkit/react";

useAgentContext({
  description: "Additional instructions for the agent",
  value: "Do not answer questions about the weather.",
});
```

### useHumanInTheLoop (same name, different import)

**v1:**
```tsx
import { useHumanInTheLoop } from "@copilotkit/react-core";
```

**v2:**
```tsx
import { useHumanInTheLoop } from "@copilotkit/react";
```

The API is similar -- registers a tool that pauses for user input via a render function with a `respond` callback.

---

## Runtime Migration

### v1: Service Adapter Pattern

```ts
import { CopilotRuntime, OpenAIAdapter, GoogleGenerativeAIAdapter } from "@copilotkit/runtime";
import { copilotKitEndpoint } from "@copilotkit/runtime"; // Next.js App Router

const serviceAdapter = new OpenAIAdapter({ model: "gpt-4o" });
const runtime = new CopilotRuntime({
  actions: [
    {
      name: "lookupWeather",
      description: "Look up the weather",
      parameters: [{ name: "city", type: "string" }],
      handler: async ({ city }) => fetchWeather(city),
    },
  ],
  remoteEndpoints: [
    { url: "http://localhost:8000/copilotkit", type: "langgraph" },
  ],
});

// Next.js App Router
export const POST = copilotKitEndpoint(runtime, serviceAdapter);
```

### v2: AG-UI Agent Pattern

```ts
import { CopilotRuntime, createCopilotEndpoint } from "@copilotkit/runtime";
import { BuiltInAgent } from "@copilotkit/agent";
import { LangGraphAgent } from "@ag-ui/langgraph";

const runtime = new CopilotRuntime({
  agents: {
    default: new BuiltInAgent({
      model: "openai:gpt-4o",
      // Frontend tools are registered client-side via useFrontendTool
    }),
    myLangGraphAgent: new LangGraphAgent({
      url: "http://localhost:8000",
      graphId: "my-graph",
    }),
  },
  // Optional middleware
  a2ui: {},       // A2UI middleware config
  mcpApps: {      // MCP Apps middleware
    servers: [{ transport: { type: "sse", url: "http://localhost:3001/sse" } }],
  },
});

// Hono-based endpoint (works with Next.js, Express, standalone)
const app = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
});

export default app;
```

**Key differences:**
- No more service adapters (`OpenAIAdapter`, `LangChainAdapter`, etc.) -- model selection is done inside agents
- No more `actions` array on the runtime -- frontend tools are registered via `useFrontendTool`, backend tools via agent configuration
- No more `remoteEndpoints` -- agents are passed directly as `AbstractAgent` instances
- Endpoint setup uses `createCopilotEndpoint` (Hono) or `createCopilotEndpointExpress` (Express) instead of framework-specific integrations
- v2 runtime supports SSE mode and Intelligence mode (durable threads with realtime events)

### v2 Runtime Modes

```ts
// SSE Mode (default -- stateless, server-sent events)
const runtime = new CopilotRuntime({
  agents: { default: myAgent },
});

// Intelligence Mode (durable threads, realtime, requires CopilotKitIntelligence)
import { CopilotKitIntelligence } from "@copilotkit/runtime";

const runtime = new CopilotRuntime({
  agents: { default: myAgent },
  intelligence: new CopilotKitIntelligence({ /* config */ }),
  identifyUser: (request) => ({ id: "user-123" }),
  generateThreadNames: true,
});
```

---

## Chat Component Migration

Chat components have the same names but move to `@copilotkit/react`:

**v1:**
```tsx
import { CopilotChat, CopilotPopup, CopilotSidebar } from "@copilotkit/react-ui";
```

**v2:**
```tsx
import { CopilotChat, CopilotPopup, CopilotSidebar } from "@copilotkit/react";
```

v2 adds new chat sub-components for granular customization:
- `CopilotChatView` -- the main chat view
- `CopilotChatInput` -- input area
- `CopilotChatAssistantMessage` / `CopilotChatUserMessage` -- message components
- `CopilotChatReasoningMessage` -- reasoning/thinking display
- `CopilotChatToolCallsView` -- tool call rendering
- `CopilotChatSuggestionView` / `CopilotChatSuggestionPill` -- suggestion UI
- `CopilotChatToggleButton` -- toggle button for popup/sidebar
- `CopilotSidebarView` / `CopilotPopupView` -- layout containers
- `CopilotModalHeader` -- header for modal layouts

---

## CopilotTextarea Migration

`CopilotTextarea` from `@copilotkit/react-textarea` has no v2 equivalent. If you were using it for AI-assisted text input, replace it with:

1. A standard `<textarea>` or rich text editor
2. A `useFrontendTool` hook to provide AI writing assistance
3. Or use `CopilotChat` in a sidebar/popup for inline AI help

---

## Message Type Migration

v1 used GraphQL-based message types from `@copilotkit/runtime-client-gql`:

```tsx
import { TextMessage, MessageRole } from "@copilotkit/runtime-client-gql";
```

v2 uses AG-UI protocol types from `@ag-ui/client` (re-exported by `@copilotkit/react`):

```tsx
import {
  Message,
  TextMessage,
  ToolCall,
  ToolMessage,
  EventType,
} from "@copilotkit/react";  // re-exports from @ag-ui/client
```
