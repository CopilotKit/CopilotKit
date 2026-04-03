---
name: copilotkit-develop
description: "Use when building AI-powered features with CopilotKit v2 -- adding chat interfaces, registering frontend tools, sharing application context with agents, handling agent interrupts, and working with the CopilotKit runtime."
---

# CopilotKit v2 Development Skill

## Live Documentation (MCP)

This plugin includes an MCP server (`copilotkit-docs`) that provides `search-docs` and `search-code` tools for querying live CopilotKit documentation and source code.

- **Claude Code:** Auto-configured by the plugin's `.mcp.json` -- no setup needed.
- **Codex:** Requires manual configuration. See the [copilotkit-debug skill](../copilotkit-debug/SKILL.md#mcp-setup) for setup instructions.

## Architecture Overview

CopilotKit v2 is built on the AG-UI protocol (`@ag-ui/client` / `@ag-ui/core`). The stack has three layers:

1. **Runtime** (`@copilotkit/runtime`) -- Server-side. Hosts agents, handles SSE/Intelligence transport, middleware, transcription.
2. **Core** (`@copilotkit/core`) -- Shared state management, tool registry, suggestion engine. Not imported directly by apps.
3. **React** (`@copilotkit/react`) -- Provider, chat components, hooks. Re-exports everything from `@ag-ui/client` so apps need only one import.

## Workflow

### 1. Set Up the Runtime (Server)

Create a `CopilotRuntime` (or the explicit `CopilotSseRuntime` / `CopilotIntelligenceRuntime`) and expose it via `createCopilotEndpoint` (Hono) or `createCopilotEndpointExpress` (Express).

```ts
import { CopilotRuntime, createCopilotEndpoint } from "@copilotkit/runtime";
import { LangGraphAgent } from "@ag-ui/langgraph";

const runtime = new CopilotRuntime({
  agents: {
    myAgent: new LangGraphAgent({ /* ... */ }),
  },
});

const app = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
});
```

### 2. Wrap Your App with the Provider (Client)

```tsx
import { CopilotKitProvider } from "@copilotkit/react";

function App() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit">
      <YourApp />
    </CopilotKitProvider>
  );
}
```

### 3. Add a Chat UI

Use `<CopilotChat>`, `<CopilotPopup>`, or `<CopilotSidebar>`:

```tsx
import { CopilotChat } from "@copilotkit/react";

function ChatPage() {
  return <CopilotChat agentId="myAgent" />;
}
```

### 4. Register Frontend Tools

Let the agent call functions in the browser:

```tsx
import { useFrontendTool } from "@copilotkit/react";
import { z } from "zod";

useFrontendTool({
  name: "highlightCell",
  description: "Highlight a spreadsheet cell",
  parameters: z.object({ row: z.number(), col: z.number() }),
  handler: async ({ row, col }) => {
    highlightCell(row, col);
    return "done";
  },
});
```

### 5. Share Application Context

Provide runtime data to the agent:

```tsx
import { useAgentContext } from "@copilotkit/react";

useAgentContext({
  description: "The user's current shopping cart",
  value: cart, // any JSON-serializable value
});
```

### 6. Handle Agent Interrupts

When an agent pauses for human input:

```tsx
import { useInterrupt } from "@copilotkit/react";

useInterrupt({
  render: ({ event, resolve }) => (
    <div>
      <p>{event.value.question}</p>
      <button onClick={() => resolve({ approved: true })}>Approve</button>
    </div>
  ),
});
```

### 7. Render Tool Calls in Chat

Show custom UI when tools execute:

```tsx
import { useRenderTool } from "@copilotkit/react";
import { z } from "zod";

useRenderTool({
  name: "searchDocs",
  parameters: z.object({ query: z.string() }),
  render: ({ status, parameters, result }) => {
    if (status === "executing") return <Spinner>Searching {parameters.query}...</Spinner>;
    if (status === "complete") return <Results data={result} />;
    return <div>Preparing...</div>;
  },
}, []);
```

## Quick Reference: Hooks

| Hook | Purpose |
|------|---------|
| `useFrontendTool` | Register a tool the agent can call in the browser |
| `useComponent` | Register a React component as a chat-rendered tool (convenience wrapper around `useFrontendTool`) |
| `useAgentContext` | Share JSON-serializable application state with the agent |
| `useAgent` | Get the `AbstractAgent` instance for an agent ID; subscribe to message/state/run-status changes |
| `useInterrupt` | Handle `on_interrupt` events from agents with render + optional handler/filter |
| `useHumanInTheLoop` | Register a tool that pauses execution until the user responds via a rendered UI |
| `useRenderTool` | Register a renderer for tool calls (by name or wildcard `"*"`) |
| `useDefaultRenderTool` | Register a wildcard `"*"` renderer using the built-in expandable card UI |
| `useRenderToolCall` | Internal hook returning a function to resolve the correct renderer for a given tool call |
| `useRenderActivityMessage` | Internal hook for rendering activity messages by type |
| `useRenderCustomMessages` | Internal hook for rendering custom message decorators |
| `useSuggestions` | Read the current suggestion list and control reload/clear |
| `useConfigureSuggestions` | Register static or dynamic (LLM-generated) suggestion configs |
| `useThreads` | List, rename, archive, and delete Intelligence platform threads |

## Quick Reference: Components

| Component | Purpose |
|-----------|---------|
| `CopilotKitProvider` | Root provider -- configures runtime URL, headers, agents, error handler |
| `CopilotChat` | Full chat interface connected to an agent (inline layout) |
| `CopilotPopup` | Chat in a floating popup with toggle button |
| `CopilotSidebar` | Chat in a collapsible sidebar with toggle button |
| `CopilotChatView` | Headless chat view with slots for message view, input, scroll, suggestions |
| `CopilotChatInput` | Chat input textarea with send/stop/transcribe controls |
| `CopilotChatMessageView` | Renders the message list |
| `CopilotChatSuggestionView` | Renders suggestion pills |

## Quick Reference: Runtime

| Export | Purpose |
|--------|---------|
| `CopilotRuntime` | Auto-detecting runtime (delegates to SSE or Intelligence) |
| `CopilotSseRuntime` | Explicit SSE-mode runtime |
| `CopilotIntelligenceRuntime` | Intelligence-mode runtime with durable threads |
| `createCopilotEndpoint` | Create a Hono app with all CopilotKit routes |
| `createCopilotEndpointExpress` | Create an Express router with all CopilotKit routes |
| `CopilotKitIntelligence` | Intelligence platform client configuration |

