# Built In Agent Integration

CopilotKit implementation guide for Built In Agent.

## Guidance
### Advanced Configuration
- Route: `/built-in-agent/advanced-configuration`
- Source: `docs/content/docs/integrations/built-in-agent/advanced-configuration.mdx`
- Description: Fine-tune your Built-in Agent's behavior with advanced options.

The `BuiltInAgent` accepts a full set of configuration options to control model behavior, tool calling, and more.

## Multi-step tool calling

By default, the agent performs a single generation step. Set `maxSteps` to allow the agent to call tools and then continue reasoning:

```typescript title="src/copilotkit.ts"
const agent = new BuiltInAgent({
  model: "openai:gpt-5.2",
  maxSteps: 5, // [!code highlight]
  tools: [searchDocs, createTicket],
});
```

With `maxSteps: 5`, the agent can call a tool, process the result, call another tool, and so on — up to 5 iterations. This is essential for workflows where the agent needs to chain multiple tool calls.

## Tool choice

Control how the agent selects tools:

```typescript
const agent = new BuiltInAgent({
  model: "openai:gpt-5.2",
  toolChoice: "auto",       // Let the model decide (default)
  // toolChoice: "required", // Force the model to call a tool
  // toolChoice: "none",     // Disable tool calling
  // toolChoice: { type: "tool", toolName: "searchDocs" }, // Force a specific tool
});
```

## System prompt

Customize the agent's system prompt:

```typescript
const agent = new BuiltInAgent({
  model: "openai:gpt-5.2",
  prompt: "You are a customer support agent for Acme Corp. Be concise and helpful. Always check the knowledge base before answering.", // [!code highlight]
});
```

## Generation parameters

Fine-tune the model's output:

```typescript
const agent = new BuiltInAgent({
  model: "openai:gpt-5.2",
  temperature: 0.7,        // Creativity (0 = deterministic, 1+ = creative)
  topP: 0.9,               // Nucleus sampling
  topK: 40,                // Top-K sampling (provider-dependent)
  maxOutputTokens: 4096,   // Maximum tokens in the response
  presencePenalty: 0.1,    // Penalize repeated topics
  frequencyPenalty: 0.1,   // Penalize repeated tokens
  stopSequences: ["END"],  // Stop generation at these sequences
  seed: 42,                // Deterministic output (provider-dependent)
  maxRetries: 3,           // Retry on transient failures
});
```

Not all parameters are supported by every provider. For example, `topK` is supported by Google but not OpenAI. Unsupported parameters are ignored.

## Provider-specific options

Pass options specific to a model provider using `providerOptions`:

```typescript
// OpenAI reasoning models (o3, o4-mini) with reasoning effort
const agent = new BuiltInAgent({
  model: "openai:o3",
  providerOptions: { // [!code highlight:3]
    openai: { reasoningEffort: "high" },
  },
});
```

```typescript
// Anthropic with extended thinking
const agent = new BuiltInAgent({
  model: "anthropic:claude-sonnet-4.5",
  providerOptions: { // [!code highlight:3]
    anthropic: { thinking: { type: "enabled", budgetTokens: 10000 } },
  },
});
```

## Overridable properties

Allow the frontend to override specific configuration at runtime. This is useful when you want users to switch models or adjust behavior without redeploying:

```typescript
const agent = new BuiltInAgent({
  model: "openai:gpt-5.2",
  temperature: 0.5,
  overridableProperties: ["model", "temperature", "prompt"], // [!code highlight]
});
```

The full list of overridable properties:
`model`, `toolChoice`, `maxOutputTokens`, `temperature`, `topP`, `topK`, `presencePenalty`, `frequencyPenalty`, `stopSequences`, `seed`, `maxRetries`, `prompt`, `providerOptions`

## Message forwarding

Control whether system and developer messages from the conversation are forwarded to the LLM:

```typescript
const agent = new BuiltInAgent({
  model: "openai:gpt-5.2",
  forwardSystemMessages: true,    // Forward system-role messages
  forwardDeveloperMessages: true, // Forward developer-role messages (as system messages)
});
```

## Full configuration reference

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `model` | `string \| LanguageModel` | — | Model specifier or AI SDK instance |
| `apiKey` | `string` | env var | API key for the provider |
| `maxSteps` | `number` | `1` | Max tool-calling iterations |
| `toolChoice` | `"auto" \| "required" \| "none" \| { type: "tool", toolName: string }` | `"auto"` | How tools are selected |
| `maxOutputTokens` | `number` | — | Max tokens in response |
| `temperature` | `number` | — | Sampling temperature |
| `topP` | `number` | — | Nucleus sampling |
| `topK` | `number` | — | Top-K sampling |
| `presencePenalty` | `number` | — | Presence penalty |
| `frequencyPenalty` | `number` | — | Frequency penalty |
| `stopSequences` | `string[]` | — | Stop sequences |
| `seed` | `number` | — | Random seed |
| `maxRetries` | `number` | — | Retry count |
| `prompt` | `string` | — | System prompt |
| `tools` | `ToolDefinition[]` | `[]` | Server-side tools |
| `mcpServers` | `MCPClientConfig[]` | `[]` | MCP server connections |
| `overridableProperties` | `string[]` | `[]` | Properties the frontend can override |
| `providerOptions` | `Record` | — | Provider-specific options |
| `forwardSystemMessages` | `boolean` | `false` | Forward system messages |
| `forwardDeveloperMessages` | `boolean` | `false` | Forward developer messages |

### AG-UI
- Route: `/built-in-agent/ag-ui`
- Source: `docs/content/docs/integrations/built-in-agent/ag-ui.mdx`
- Description: The AG-UI protocol connects your frontend to your Built-in Agent via event-based Server-Sent Events (SSE).

CopilotKit is built on the [AG-UI protocol](https://ag-ui.com) — a lightweight, event-based standard that defines how AI agents communicate with user-facing applications over Server-Sent Events (SSE).

Everything in CopilotKit — messages, state updates, tool calls, and more — flows through AG-UI events. Understanding this layer helps you debug, extend, and build on top of CopilotKit more effectively.

## Accessing Your Agent with `useAgent`

The `useAgent` hook is your primary interface to the AG-UI agent powering your copilot. It returns an [`AbstractAgent`](https://github.com/ag-ui-protocol/ag-ui/blob/main/typescript/packages/client/src/agents/abstract-agent.ts) from the AG-UI client library — the same base type that all AG-UI agents implement.

```tsx
import { useAgent } from "@copilotkit/react-core";

function MyComponent() {
  const { agent } = useAgent();

  // agent.messages - conversation history
  // agent.state - current agent state
  // agent.isRunning - whether the agent is currently running
}
```

If you have multiple agents, pass the `agentId` to select one:

```tsx
const { agent } = useAgent({ agentId: "research-agent" });
```

The returned `agent` is a standard AG-UI `AbstractAgent`. You can subscribe to its events, read its state, and interact with it using the same interface defined by the [AG-UI specification](https://docs.ag-ui.com).

### Subscribing to AG-UI Events

Every agent exposes a `subscribe` method that lets you listen for specific AG-UI events as they stream in. Each callback receives the event and the current agent state:

```tsx
import { useAgent } from "@copilotkit/react-core";
import { useEffect } from "react";

function MyComponent() {
  const { agent } = useAgent();

  useEffect(() => {
    const subscription = agent.subscribe({
      // Called on every event
      onEvent({ event, agent }) {
        console.log("Event:", event.type, event);
      },

      // Text message streaming
      onTextMessageContentEvent({ event, textMessageBuffer, agent }) {
        console.log("Streaming text:", textMessageBuffer);
      },

      // Tool calls
      onToolCallEndEvent({ event, toolCallName, toolCallArgs, agent }) {
        console.log("Tool called:", toolCallName, toolCallArgs);
      },

      // State updates
      onStateSnapshotEvent({ event, agent }) {
        console.log("State snapshot:", agent.state);
      },

      // High-level lifecycle
      onMessagesChanged({ agent }) {
        console.log("Messages updated:", agent.messages);
      },
      onStateChanged({ agent }) {
        console.log("State changed:", agent.state);
      },
    });

    return () => subscription.unsubscribe();
  }, [agent]);
}
```

The full list of subscribable events maps directly to the [AG-UI event types](https://docs.ag-ui.com/concepts/events):

| Event | Callback | Description |
| --- | --- | --- |
| Run lifecycle | `onRunStartedEvent`, `onRunFinishedEvent`, `onRunErrorEvent` | Agent run start, completion, and errors |
| Steps | `onStepStartedEvent`, `onStepFinishedEvent` | Individual step boundaries within a run |
| Text messages | `onTextMessageStartEvent`, `onTextMessageContentEvent`, `onTextMessageEndEvent` | Streaming text content from the agent |
| Tool calls | `onToolCallStartEvent`, `onToolCallArgsEvent`, `onToolCallEndEvent`, `onToolCallResultEvent` | Tool invocation lifecycle |
| State | `onStateSnapshotEvent`, `onStateDeltaEvent` | Full state snapshots and incremental deltas |
| Messages | `onMessagesSnapshotEvent` | Full message list snapshots |
| Custom | `onCustomEvent`, `onRawEvent` | Custom and raw events for extensibility |
| High-level | `onMessagesChanged`, `onStateChanged` | Aggregate notifications after any message or state mutation |

## The Proxy Pattern

When you use CopilotKit with a runtime, your frontend never talks directly to your agent. Instead, CopilotKit creates a **proxy agent** on the frontend that forwards requests through the Copilot Runtime.

On startup, CopilotKit calls the runtime's `/info` endpoint to discover which agents are available. Each agent is wrapped in a `ProxiedCopilotRuntimeAgent` — a thin client that extends AG-UI's [`HttpAgent`](https://github.com/ag-ui-protocol/ag-ui/blob/main/typescript/packages/client/src/agents/http-agent.ts). From your component's perspective, this proxy behaves identically to a local AG-UI agent: same `AbstractAgent` interface, same subscribe API, same properties. But under the hood, every `run` call is an HTTP request to your server, and every response is an SSE stream of AG-UI events flowing back.

```tsx title="What your component sees"
const { agent } = useAgent(); // Returns an AbstractAgent
agent.messages;               // Read messages
agent.state;                  // Read state
agent.subscribe({ ... });     // Subscribe to events
```

```tsx title="What actually happens"
// useAgent() → AgentRegistry checks /info → wraps each agent in ProxiedCopilotRuntimeAgent
// agent.runAgent() → HTTP POST to runtime → runtime routes to your agent → SSE stream back
```

This indirection is what enables the runtime to provide authentication, middleware, agent routing, and ecosystem features like [threads](/premium/threads) and [observability](/premium/observability) — without changing how you interact with agents on the frontend.

## How Agents Slot into the Runtime

On the server side, the `CopilotRuntime` accepts a map of AG-UI `AbstractAgent` instances. Each agent framework provides its own implementation, but they all extend the same base type:

```ts title="app/api/copilotkit/route.ts"
import { CopilotRuntime, copilotRuntimeNextJSAppRouterEndpoint } from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const runtime = new CopilotRuntime({
  agents: {
    "my-agent": new HttpAgent({
      url: "https://my-agent-server.example.com",
    }),
  },
});

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    endpoint: "/api/copilotkit",
  });
  return handleRequest(req);
};
```

When a request comes in:

1. The runtime resolves the target agent by ID
2. It clones the agent (for thread safety) and sets messages, state, and thread context from the request
3. The `AgentRunner` executes the agent, which produces a stream of AG-UI `BaseEvent`s
4. Events are encoded as SSE and streamed back to the frontend proxy

Because every agent is an `AbstractAgent`, you can register any AG-UI-compatible agent — whether it's an `HttpAgent` pointing at a remote server, a framework-specific adapter, or a custom implementation — and the runtime handles routing, middleware, and delivery uniformly.

### Agent Context
- Route: `/built-in-agent/agent-app-context`
- Source: `docs/content/docs/integrations/built-in-agent/agent-app-context.mdx`
- Description: Share app-specific context with your Built-in Agent.

Share your application's state and context with the Built-in Agent using the `useAgentContext` hook. The agent automatically receives this context — no backend configuration needed.

## What is this?

The `useAgentContext` hook lets you register app-specific data that gets included in the agent's context. This could be the current user, page content, shopping cart items, or any data that helps the agent provide relevant responses.

## When should I use this?

- You want the agent to know about the current state of your app
- You need the agent to reference user-specific data (name, preferences, role)
- The agent should be aware of what page or view the user is on
- You want to provide domain-specific data without hardcoding it into the system prompt

## Implementation

### Register context in your component

Use `useAgentContext` to share any data with the agent:

```tsx title="components/Dashboard.tsx"
"use client"; // only necessary for Next.js App Router // [!code highlight]
import { useAgentContext } from "@copilotkit/react-core/v2"; // [!code highlight]
import { useState } from "react";

export function Dashboard() {
  const [user] = useState({
    name: "Jane Smith",
    role: "Engineering Manager",
    team: "Platform",
  });

  const [projects] = useState([
    { id: 1, name: "Auth Redesign", status: "in-progress" },
    { id: 2, name: "API v2", status: "planning" },
  ]);

  // Share user info with the agent
  // [!code highlight:4]
  useAgentContext({
    description: "The currently logged-in user",
    value: user,
  });

  // Share project data with the agent
  // [!code highlight:4]
  useAgentContext({
    description: "The user's active projects",
    value: projects,
  });

  return <div>{/* Your dashboard UI */}</div>;
}
```

### That's it — no backend setup needed

Unlike LangGraph where you need to configure agent state to receive context, the Built-in Agent handles this automatically. The context you register is included in the agent's system prompt, so it can reference your app data immediately.

```
User: "What projects am I working on?"
Agent: "You're working on two projects:
  1. Auth Redesign (in progress)
  2. API v2 (planning)"
```

## Multiple contexts

You can call `useAgentContext` multiple times across different components. All registered contexts are combined and sent to the agent:

```tsx title="components/UserInfo.tsx"
useAgentContext({
  description: "Current user profile",
  value: { name: "Jane", role: "Manager" },
});
```

```tsx title="components/PageContext.tsx"
useAgentContext({
  description: "The page the user is currently viewing",
  value: { page: "settings", section: "notifications" },
});
```

The agent sees both contexts and can reference either when responding.

## Dynamic context

Context updates automatically when the underlying data changes:

```tsx
export function TaskList() {
  const [tasks, setTasks] = useState([]);

  // Context updates whenever tasks change // [!code highlight]
  useAgentContext({
    description: "The user's current task list",
    value: tasks,
  });

  return (
    <div>
      {/* When tasks are added/removed, the agent sees the updated list */}
    </div>
  );
}
```

### Coding Agents
- Route: `/built-in-agent/coding-agents`
- Source: `docs/content/docs/integrations/built-in-agent/coding-agents.mdx`
- Description: Use our MCP server to connect your Built-in Agent to CopilotKit.

## Overview
The CopilotKit MCP server equips AI coding agents with deep knowledge about CopilotKit's APIs, patterns, and best practices. When connected to your
development environment, it enables AI assistants to:
- Provide expert guidance
- Generate accurate code
- Give your AI agents a user interface
- Help you implement CopilotKit features correctly

Powered by 🪄 [Tadata](https://tadata.com) - The platform for instantly building and hosting MCP servers.

## GitHub Copilot

[GitHub Copilot](https://github.com/features/copilot) is Microsoft's AI pair programmer integrated into VS Code and other editors. It supports MCP to extend its capabilities with external tools and services.

    ### Enable MCP Support in VS Code
    1. Open VS Code Settings (`Cmd+,` on Mac or `Ctrl+,` on Windows/Linux)
    2. Search for "MCP" in the settings search bar
    3. Enable the `chat.mcp.enabled` setting
    ### Add MCP Server to GitHub Copilot
    You can configure MCP servers for GitHub Copilot in several ways:

        Create a `.vscode/mcp.json` file in your project root:
```json
        {
          "servers": {
            "CopilotKit MCP": {
              "url": "https://mcp.copilotkit.ai/sse"
            }
          }
        }
```
        Add to your VS Code `settings.json`:
```json
        {
          "mcp": {
            "servers": {
              "CopilotKit MCP": {
                "url": "https://mcp.copilotkit.ai/sse"
              }
            }
          }
        }
```
        1. Open the Command Palette (`Cmd+Shift+P` or `Ctrl+Shift+P`)
        2. Type "MCP: Add Server" and select the command
        3. Choose "HTTP (sse)" as the server type
        4. Enter the server URL: `https://mcp.copilotkit.ai/sse`
        5. Provide a name for the server: `CopilotKit MCP`
    ### Using MCP Tools with GitHub Copilot
    1. Open Copilot Chat in VS Code (click the Copilot icon in the activity bar)
    2. Switch to Agent mode from the chat dropdown menu
    3. Click the Tools (🔧) button to view available MCP tools
    4. Your CopilotKit MCP tools will be listed and can be used automatically

    GitHub Copilot will intelligently use the MCP tools when relevant to your queries. You can also reference tools directly using `#` followed by the tool name.
    ### Managing MCP Servers
    Use the "MCP: List Servers" command to view and manage your configured servers:

    - Start/Stop/Restart servers
    - View server logs for debugging
    - Browse available tools and resources

## Other

For MCP-compatible applications not listed above, use these universal integration patterns. MCP (Model Context Protocol) is an open standard that allows AI applications to connect with external tools and data sources.

### Connection Methods

Most MCP-compatible applications support one or both of these connection methods:

    For web-based or remote integrations:
```
    https://mcp.copilotkit.ai/sse
```
    For local command-line integrations:
```json
    {
      "command": "npx",
      "args": ["mcp-remote", "https://mcp.copilotkit.ai"]
    }
```

### Integration Steps

1. **Find MCP Settings** - Look for "MCP," "Model Context Protocol," or "Tools" in your application settings
2. **Add Server** - Use the SSE URL: `https://mcp.copilotkit.ai/sse`
3. **Test Connection** - Restart your application and verify the server appears in available tools

### Common Configuration Patterns

    Many applications use a configuration file (locations vary by app):
```json
    {
      "servers": {
        "CopilotKit MCP": {
          "url": "https://mcp.copilotkit.ai/sse"
        }
      }
    }
```
    Some apps integrate MCP into their main settings:
```json
    {
      "mcp": {
        "enabled": true,
        "servers": {
          "CopilotKit MCP": {
            "url": "https://mcp.copilotkit.ai/sse"
          }
        }
      }
    }
```

### Copilot Runtime
- Route: `/built-in-agent/copilot-runtime`
- Source: `docs/content/docs/integrations/built-in-agent/copilot-runtime.mdx`
- Description: The Copilot Runtime is the backend that connects your frontend to your AI agents, providing authentication, middleware, routing, and more.

The Copilot Runtime is the backend layer that connects your frontend application to your AI agents. It's set up during the [quickstart](/quickstart) and is the recommended way to use CopilotKit.

## Setting Up the Runtime

The runtime is a lightweight server endpoint that you add to your backend. Here's a minimal example using Next.js:

```ts title="app/api/copilotkit/route.ts"
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { NextRequest } from "next/server";

const serviceAdapter = new ExperimentalEmptyAdapter();

const runtime = new CopilotRuntime({
  agents: {
    // your agents go here
  },
});

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
```

Then point your frontend at the endpoint:

```tsx
<CopilotKit runtimeUrl="/api/copilotkit">
  <YourApp />
</CopilotKit>
```

For setup with other backend frameworks (Express, NestJS, Node.js HTTP), see the [quickstart](/quickstart).

## The Default Agent

If you register an agent with the name `"default"`, CopilotKit's prebuilt UI components will use it automatically without any additional configuration on the frontend. This is useful when you have one primary agent and don't want to specify an `agentId` everywhere.

```ts title="app/api/copilotkit/route.ts"
const runtime = new CopilotRuntime({
  agents: {
    // This agent will be used automatically by CopilotPopup, CopilotSidebar, etc.
    "default": new HttpAgent({ url: "https://my-agent.example.com" }),
  },
});
```

When you register multiple agents, the `"default"` agent is what powers the chat unless a specific agent is selected. Other agents can still be used by passing their `agentId` to `useAgent` or the prebuilt components.

## What the Runtime Provides

### Authentication and Security

The runtime runs on your server, which means agent communication stays server-side. This gives you a trusted environment to enforce authentication, validate requests, and keep API keys secure. When you use the runtime, safe defaults are put in place so your agent endpoints are not exposed to unauthenticated access.

### AG-UI Middleware

The [AG-UI protocol](/ag-ui-protocol) supports a middleware layer (`agent.use`) for logging, guardrails, request transformation, and more. Because the runtime runs server-side, this middleware executes in a trusted environment where it cannot be tampered with by the client.

### Agent Routing

When you register multiple agents with the runtime, it handles discovery and routing automatically. Your frontend doesn't need to know the details of where each agent lives or how to reach it.

### Premium Features

Features like [threads](/premium/threads), [observability](/premium/observability), and the [inspector](/premium/inspector) are provided through the runtime. These give you conversation persistence, monitoring, and debugging capabilities out of the box.

## What If I Want to Connect to My AG-UI Agent Directly?

CopilotKit is built on the [AG-UI protocol](/ag-ui-protocol), which is an open standard. If you want to connect your frontend directly to an AG-UI-compatible agent without the runtime, you can do so by passing agent instances directly to the `CopilotKit` provider:

```tsx
import { HttpAgent } from "@ag-ui/client";

const myAgent = new HttpAgent({
  url: "https://my-agent.example.com",
});

<CopilotKit agents__unsafe_dev_only={{ "my-agent": myAgent }}>
  <YourApp />
</CopilotKit>
```

Direct agent connections are intended for development and prototyping. This approach is not recommended for production unless you are confident in your setup, and is not officially supported by CopilotKit. If you run into issues with a direct connection, you will need to troubleshoot on your own.

There are important things to understand before going this route:

1. **Authentication is your responsibility.** When you use the Copilot Runtime, safe defaults are put in place so that your agent endpoints are not exposed to unauthenticated access. When you connect directly, it is entirely up to you to secure your agent endpoint and manage authentication.

2. **Many ecosystem features won't work.** The AG-UI protocol supports a middleware layer designed to run on the backend. Many features in the CopilotKit ecosystem depend on this server-side middleware. Without the runtime, these features — including [threads](/premium/threads), [observability](/premium/observability), and other capabilities — will not be available.

### Comparison

| | With Runtime | Direct Connection |
|---|---|---|
| **Authentication** | Safe defaults provided | You manage it |
| **AG-UI Middleware** | Runs server-side | Not available |
| **Agent Routing** | Automatic | Manual |
| **Ecosystem Features** | Full support | Limited |
| **CopilotKit Support** | Supported | Not supported |
| **Setup** | Requires a backend endpoint | Frontend-only |

### Fully Headless UI
- Route: `/built-in-agent/custom-look-and-feel/headless-ui`
- Source: `docs/content/docs/integrations/built-in-agent/custom-look-and-feel/headless-ui.mdx`
- Description: Fully customize your Copilot's UI from the ground up using headless UI

## What is this?

A headless UI gives you full control over the chat experience — you bring your own components, layout, and styling while CopilotKit handles agent communication, message management, and streaming. This is built on top of the same primitives (`useAgent` and `useCopilotKit`) covered in Programmatic Control.

## When should I use this?

Use headless UI when the slot system isn't enough — for example, when you need a completely different layout, want to embed the chat into an existing UI, or are building a non-chat interface that still communicates with an agent.

## Implementation

### Access the agent and CopilotKit

Use `useAgent` to get the agent instance (messages, state, execution status) and `useCopilotKit` to run the agent.

```tsx title="components/custom-chat.tsx"
import { useAgent } from "@copilotkit/react-core/v2";
import { useCopilotKit } from "@copilotkit/react-core/v2";
import { randomUUID } from "@copilotkit/shared/v2";

export function CustomChat() {
  // [!code highlight:2]
  const { agent } = useAgent();
  const { copilotkit } = useCopilotKit();

  return <div>{/* Your custom UI */}</div>;
}
```

### Display messages

The agent's messages are available via `agent.messages`. Each message has an `id`, `role` (`"user"` or `"assistant"`), and `content`.

```tsx title="components/custom-chat.tsx"
export function CustomChat() {
  const { agent } = useAgent();
  const { copilotkit } = useCopilotKit();

  return (
    <div className="flex flex-col h-full">
      {/* [!code highlight:12] */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {agent.messages.map((msg) => (
          <div
            key={msg.id}
            className={msg.role === "user" ? "ml-auto bg-blue-100 rounded-lg p-3 max-w-md" : "bg-gray-100 rounded-lg p-3 max-w-md"}
          >
            <p className="text-sm font-medium">{msg.role}</p>
            <p>{msg.content}</p>
          </div>
        ))}
        {agent.isRunning && <div className="text-gray-400">Thinking...</div>}
      </div>
    </div>
  );
}
```

### Send messages and run the agent

Add a message to the agent's conversation, then call `copilotkit.runAgent()` to trigger execution. This is the same method CopilotKit's built-in `` uses internally.

```tsx title="components/custom-chat.tsx"
import { useState, useCallback } from "react";

export function CustomChat() {
  const { agent } = useAgent();
  const { copilotkit } = useCopilotKit();
  const [input, setInput] = useState("");

  // [!code highlight:14]
  const sendMessage = useCallback(async () => {
    if (!input.trim()) return;

    agent.addMessage({
      id: randomUUID(),
      role: "user",
      content: input,
    });

    setInput("");

    await copilotkit.runAgent({ agent });
  }, [input, agent, copilotkit]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {agent.messages.map((msg) => (
          <div key={msg.id} className={msg.role === "user" ? "ml-auto bg-blue-100 rounded-lg p-3 max-w-md" : "bg-gray-100 rounded-lg p-3 max-w-md"}>
            <p>{msg.content}</p>
          </div>
        ))}
        {agent.isRunning && <div className="text-gray-400">Thinking...</div>}
      </div>

      {/* [!code highlight:12] */}
      <form
        className="border-t p-4 flex gap-2"
        onSubmit={(e) => { e.preventDefault(); sendMessage(); }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 border rounded-lg px-3 py-2"
        />
        <button type="submit" disabled={agent.isRunning}>Send</button>
      </form>
    </div>
  );
}
```

### Stop the agent

Use `copilotkit.stopAgent()` to cancel a running agent:

```tsx title="components/custom-chat.tsx"
const stopAgent = useCallback(() => {
  // [!code highlight:1]
  copilotkit.stopAgent({ agent });
}, [agent, copilotkit]);

// In your JSX:
{agent.isRunning && (
  <button onClick={stopAgent} className="text-red-500">
    Stop
  </button>
)}
```

### Slots
- Route: `/built-in-agent/custom-look-and-feel/slots`
- Source: `docs/content/docs/integrations/built-in-agent/custom-look-and-feel/slots.mdx`
- Description: Customize any part of the chat UI by overriding individual sub-components via slots for Built-in Agent.

## What is this?

Every CopilotKit chat component is built from composable **slots** — named sub-components that you can override individually. The slot system gives you three levels of customization without needing to rebuild the entire UI:

1. **Tailwind classes** — pass a string to add/override CSS classes
2. **Props override** — pass an object to override specific props on the default component
3. **Custom component** — pass your own React component to fully replace a slot

Slots are recursive — you can drill into nested sub-components at any depth.

## Tailwind Classes

The simplest way to customize a slot. Pass a Tailwind class string and it will be merged with the default component's classes.

```tsx title="page.tsx"
import { CopilotChat } from "@copilotkit/react-core/v2";

export function Chat() {
  return (
    <CopilotChat
      // [!code highlight:2]
      messageView="bg-gray-50 dark:bg-gray-900 p-4"
      input="border-2 border-blue-400 rounded-xl"
    />
  );
}
```

## Props Override

Pass an object to override specific props on the default component. This is useful for adding `className`, event handlers, data attributes, or any other prop the default component accepts.

```tsx title="page.tsx"
<CopilotChat
  // [!code highlight:4]
  messageView={{
    className: "my-custom-messages",
    "data-testid": "message-view",
  }}
  input={{ autoFocus: true }}
/>
```

## Custom Components

For full control, pass your own React component. It receives all the same props as the default component.

```tsx title="page.tsx"
import { CopilotChat } from "@copilotkit/react-core/v2";

// [!code highlight:8]
const CustomMessageView = ({ messages, isRunning }) => (
  <div className="space-y-4 p-6">
    {messages?.map((msg) => (
      <div key={msg.id} className={msg.role === "user" ? "text-right" : "text-left"}>
        {msg.content}
      </div>
    ))}
    {isRunning && <div className="animate-pulse">Thinking...</div>}
  </div>
);

export function Chat() {
  return (
    // [!code highlight:1]
    <CopilotChat messageView={CustomMessageView} />
  );
}
```

## Nested Slots (Drill-Down)

Slots are recursive. You can customize sub-components at any depth by nesting objects.

### Two levels deep

Override the assistant message's toolbar within the message view:

```tsx title="page.tsx"
<CopilotChat
  // [!code highlight:7]
  messageView={{
    assistantMessage: {
      toolbar: CustomToolbar,
      copyButton: CustomCopyButton,
    },
    userMessage: CustomUserMessage,
  }}
/>
```

### Three levels deep

Override a specific button inside the assistant message toolbar:

```tsx title="page.tsx"
<CopilotChat
  messageView={{
    // [!code highlight:5]
    assistantMessage: {
      copyButton: ({ onClick }) => (
        <button onClick={onClick}>Copy</button>
      ),
    },
  }}
/>
```

### Input sub-slots

```tsx title="page.tsx"
<CopilotChat
  input={{
    // [!code highlight:2]
    textArea: CustomTextArea,
    sendButton: CustomSendButton,
  }}
/>
```

### Scroll view sub-slots

```tsx title="page.tsx"
<CopilotChat
  scrollView={{
    // [!code highlight:2]
    feather: CustomFeather,
    scrollToBottomButton: CustomScrollButton,
  }}
/>
```

### Suggestion view sub-slots

```tsx title="page.tsx"
<CopilotChat
  suggestionView={{
    // [!code highlight:2]
    suggestion: CustomSuggestionPill,
    container: CustomSuggestionContainer,
  }}
/>
```

## Children Render Function

For complete layout control, use the `children` render function pattern. This gives you pre-built slot elements that you can arrange however you want.

```tsx title="page.tsx"
import { CopilotChat } from "@copilotkit/react-core/v2";

export function Chat() {
  return (
    <CopilotChat>
      {/* [!code highlight:8] */}
      {({ messageView, input, scrollView, suggestionView }) => (
        <div className="flex flex-col h-full">
          <header className="p-4 border-b font-semibold">My Agent</header>
          {scrollView}
          <div className="border-t p-4">{input}</div>
        </div>
      )}
    </CopilotChat>
  );
}
```

## Labels

Customize any text string in the UI via the `labels` prop. This does not use the slot system — it's a separate convenience prop on `CopilotChat`, `CopilotSidebar`, and `CopilotPopup`.

```tsx title="page.tsx"
<CopilotChat
  // [!code highlight:5]
  labels={{
    chatInputPlaceholder: "Ask your agent anything...",
    welcomeMessageText: "How can I help you today?",
    chatDisclaimerText: "AI responses may be inaccurate.",
  }}
/>
```

## Available Slots

### `CopilotChat` / `CopilotSidebar` / `CopilotPopup`

These are the root-level slot props available on all chat components:

| Slot | Description |
|------|-------------|
| `messageView` | The message list container. |
| `scrollView` | The scroll container with auto-scroll behavior. |
| `input` | The text input area with send/transcribe controls. |
| `suggestionView` | The suggestion pills shown below messages. |
| `welcomeScreen` | The initial empty-state screen (pass `false` to disable). |

`CopilotSidebar` and `CopilotPopup` also have:

| Slot | Description |
|------|-------------|
| `header` | The modal header bar. |
| `toggleButton` | The open/close toggle button. |

### `messageView` sub-slots

Available via `messageView={{ ... }}`:

| Slot | Description |
|------|-------------|
| `assistantMessage` | Renders assistant responses. Has its own sub-slots (see below). |
| `userMessage` | Renders user messages. Has its own sub-slots (see below). |
| `reasoningMessage` | Renders model reasoning/thinking steps. Has its own sub-slots (see below). |
| `cursor` | The streaming cursor indicator shown while the agent is responding. |

### `assistantMessage` sub-slots

Available via `messageView={{ assistantMessage: { ... } }}`:

| Slot | Description |
|------|-------------|
| `markdownRenderer` | The markdown rendering component. |
| `toolbar` | The action toolbar below messages. |
| `copyButton` | Copy message button. |
| `thumbsUpButton` | Thumbs up feedback button. |
| `thumbsDownButton` | Thumbs down feedback button. |
| `readAloudButton` | Read aloud button. |
| `regenerateButton` | Regenerate response button. |
| `toolCallsView` | Tool call visualization. |

### `userMessage` sub-slots

Available via `messageView={{ userMessage: { ... } }}`:

| Slot | Description |
|------|-------------|
| `messageRenderer` | The text rendering component for user messages. |
| `toolbar` | The action toolbar on hover. |
| `copyButton` | Copy message button. |
| `editButton` | Edit message button. |
| `branchNavigation` | Navigation between message branches (after editing). |

### `reasoningMessage` sub-slots

Available via `messageView={{ reasoningMessage: { ... } }}`:

| Slot | Description |
|------|-------------|
| `header` | The collapsible header (click to expand/collapse). |
| `contentView` | The reasoning content area. |
| `toggle` | The expand/collapse toggle wrapper. |

### `input` sub-slots

Available via `input={{ ... }}`:

| Slot | Description |
|------|-------------|
| `textArea` | The text input element. |
| `sendButton` | The send/submit button. |
| `addMenuButton` | The attachment/tools menu button. |
| `startTranscribeButton` | Button to start voice transcription. |
| `cancelTranscribeButton` | Button to cancel transcription. |
| `finishTranscribeButton` | Button to finish transcription. |
| `audioRecorder` | The audio recorder component. |
| `disclaimer` | The disclaimer text below the input. |

### `scrollView` sub-slots

Available via `scrollView={{ ... }}`:

| Slot | Description |
|------|-------------|
| `feather` | The gradient overlay at the bottom of the scroll area. |
| `scrollToBottomButton` | The button that appears when scrolled up. |

### `suggestionView` sub-slots

Available via `suggestionView={{ ... }}`:

| Slot | Description |
|------|-------------|
| `suggestion` | Individual suggestion pill/button. |
| `container` | The container wrapping all suggestion pills. |

### `welcomeScreen` sub-slots

Available via `welcomeScreen={{ ... }}`:

| Slot | Description |
|------|-------------|
| `welcomeMessage` | The welcome text shown on the empty state. |

### `header` sub-slots (Sidebar/Popup only)

Available via `header={{ ... }}`:

| Slot | Description |
|------|-------------|
| `titleContent` | The title text in the header. |
| `closeButton` | The close/minimize button. |

### `toggleButton` sub-slots (Sidebar/Popup only)

Available via `toggleButton={{ ... }}`:

| Slot | Description |
|------|-------------|
| `openIcon` | Icon shown when the chat is closed. |
| `closeIcon` | Icon shown when the chat is open. |

### Frontend Tools
- Route: `/built-in-agent/frontend-tools`
- Source: `docs/content/docs/integrations/built-in-agent/frontend-tools.mdx`
- Description: Define frontend tools for your Built-in Agent.

```tsx title="page.tsx"
import { z } from "zod";
import { useFrontendTool } from "@copilotkit/react-core/v2" // [!code highlight]

export function Page() {
  // ...

  // [!code highlight:12]
  useFrontendTool({
    name: "sayHello",
    description: "Say hello to the user",
    parameters: z.object({
      name: z.string().describe("The name of the user to say hello to"),
    }),
    handler: async ({ name }) => {
      alert(`Hello, ${name}!`);
      return `Said hello to ${name}!`;
    },
  });

  // ...
}
```

### Tool Rendering
- Route: `/built-in-agent/generative-ui/tool-rendering`
- Source: `docs/content/docs/integrations/built-in-agent/generative-ui/tool-rendering.mdx`
- Description: Render your agent's tool calls with custom UI components.

```tsx title="app/page.tsx"
import { useRenderTool } from "@copilotkit/react-core/v2"; // [!code highlight]
import { z } from "zod";
// ...

const weatherParams = z.object({
  location: z.string().describe("The location to get weather for"),
});

const YourMainContent = () => {
  // ...
  // [!code highlight:14]
  useRenderTool({
    name: "get_weather",
    parameters: weatherParams,
    render: ({ status, parameters }) => {
      return (
        <p className="text-gray-500 mt-2">
          {status !== "complete" && "Calling weather API..."}
          {status === "complete" && `Called the weather API for ${parameters.location}.`}
        </p>
      );
    },
  });
  // ...
}
```

### Display-only
- Route: `/built-in-agent/generative-ui/your-components/display-only`
- Source: `docs/content/docs/integrations/built-in-agent/generative-ui/your-components/display-only.mdx`
- Description: Register React components that your agent can render in the chat for Built-in Agent.

## What is this?

`useComponent` lets you register a React component as a tool your agent can invoke. When the agent calls the tool, CopilotKit renders your component directly in the chat with the tool's arguments as props.

This is the simplest form of Generative UI — your agent decides when to show a component, and CopilotKit renders it. No handler logic, no user interaction required.

## When should I use this?

Use `useComponent` when you want to:
- Display rich UI (cards, charts, tables) inline in the chat
- Show structured data from agent responses
- Render previews, status indicators, or visual feedback
- Let the agent present information beyond plain text

For components that need user interaction, see the Interactive or Interrupt-based guides.

## Register a component

Use the `useComponent` hook to register a React component. The agent will be able to call it by name, and CopilotKit will render it with the tool arguments as props.

```tsx title="app/page.tsx"
import { useComponent } from "@copilotkit/react-core/v2"; // [!code highlight]
import { z } from "zod";

const weatherSchema = z.object({
  city: z.string().describe("City name"),
  temperature: z.number().describe("Temperature in Fahrenheit"),
  condition: z.string().describe("Weather condition"),
});

function WeatherCard({ city, temperature, condition }: z.infer<typeof weatherSchema>) {
  return (
    <div className="rounded-lg border p-4">
      <h3 className="font-semibold">{city}</h3>
      <p className="text-2xl">{temperature}°F</p>
      <p className="text-sm text-gray-500">{condition}</p>
    </div>
  );
}

function YourMainContent() {
  // [!code highlight:9]
  useComponent({
    name: "showWeather",
    description: "Display a weather card for a city.",
    parameters: weatherSchema,
    render: WeatherCard,
  });

  return <div>{/* ... */}</div>;
}
```

## Without parameters

For simple components that don't need typed parameters:

```tsx
useComponent({
  name: "showGreeting",
  render: ({ message }: { message: string }) => (
    <div className="rounded border p-3 bg-blue-50">
      <p>{message}</p>
    </div>
  ),
});
```

## Scoping to an agent

In multi-agent setups, scope a component to a specific agent:

```tsx
useComponent({
  name: "renderProfile",
  parameters: z.object({ userId: z.string() }),
  render: ProfileCard,
  agentId: "support-agent",
});
```

### Interactive
- Route: `/built-in-agent/generative-ui/your-components/interactive`
- Source: `docs/content/docs/integrations/built-in-agent/generative-ui/your-components/interactive.mdx`
- Description: Create components that your agent can use to interact with the user for Built-in Agent.

```tsx title="page.tsx"
import { useHumanInTheLoop } from "@copilotkit/react-core/v2" // [!code highlight]
import { z } from "zod";

export function Page() {
  // ...

  // [!code highlight:20]
  useHumanInTheLoop({
    name: "humanApprovedCommand",
    description: "Ask human for approval to run a command.",
    parameters: z.object({
      command: z.string().describe("The command to run"),
    }),
    render: ({ args, respond, status }) => {
      if (status !== "executing") return <></>;
      return (
        <div>
          <pre>{args.command}</pre>
          {/* [!code highlight:2] */}
          <button onClick={() => respond?.(`Command is APPROVED`)}>Approve</button>
          <button onClick={() => respond?.(`Command is DENIED`)}>Deny</button>
        </div>
      );
    },
  });

  // ...
}
```

### Overview
- Route: `/built-in-agent`
- Source: `docs/content/docs/integrations/built-in-agent/index.mdx`
- Description: Use CopilotKit's built-in agent with any model.

The **Built-in Agent** is CopilotKit's simplest agent option, i.e what you get "built-in". It connects directly to an LLM with full support for tools, generative UI, shared state, and all CopilotKit features — without requiring an external agent framework.

It supports most popular models from OpenAI, Anthropic, Google, and AI-SDK defined models out of the box

## When to use Built-in Agent

- **Quick setup** — no external agent framework to configure or deploy
- **Chat + tools** — your use case is primarily conversational with frontend and server tools
- **Direct model access** — you want to use OpenAI, Anthropic, Google, or AI-SDK models directly

If you need more control over your agent loop, consider using an [agent framework](/#explore-by-ai-backend) instead.

## Features

## Getting Started

Head to the [Quickstart](/built-in-agent/quickstart) to set up a working Built-in Agent in minutes.

### Inspector
- Route: `/built-in-agent/inspector`
- Source: `docs/content/docs/integrations/built-in-agent/inspector.mdx`
- Description: Inspector for debugging actions, readables, agent status, messages, and context.

## What it shows

The CopilotKit Inspector is a built-in debugging tool that overlays on your app, giving you full visibility into what's happening between your frontend and your agents in real time.

| Feature | Description |
| --- | --- |
| **AG-UI Events** | View the raw AG-UI event stream between your frontend and agent in real time. |
| **Available Agents** | See which agents are connected and available to your app. |
| **Agent State** | Inspect your agent's current state as it updates. |
| **Frontend Tools** | See what tools you've defined on the frontend and their parameter schemas. |
| **Context** | View the context you've provided to the agent, including readables and document context. |

## Disabling the Inspector

The Inspector is enabled by default. To disable it, set `enableInspector` to `false`:

```tsx
<CopilotKit
  publicLicenseKey={process.env.NEXT_PUBLIC_COPILOTKIT_LICENSE_KEY}
  enableInspector={false}
>
  {children}
</CopilotKit>
```

No matter what, **the inspector automatically disables when you create a production build.**

### Model Selection
- Route: `/built-in-agent/model-selection`
- Source: `docs/content/docs/integrations/built-in-agent/model-selection.mdx`
- Description: Choose and configure models for your Built-in Agent.

The Built-in Agent uses the [Vercel AI SDK](https://sdk.vercel.ai) under the hood, giving you access to models from OpenAI, Anthropic, and Google — plus the ability to use any custom AI SDK model.

## Supported Models

Specify a model using the `"provider:model"` format (or `"provider/model"` — both work).

### OpenAI

| Model | Specifier |
|-------|-----------|
| GPT-5 | `openai:gpt-5` |
| GPT-5 Mini | `openai:gpt-5-mini` |
| GPT-4.1 | `openai:gpt-4.1` |
| GPT-4.1 Mini | `openai:gpt-4.1-mini` |
| GPT-4.1 Nano | `openai:gpt-4.1-nano` |
| GPT-4o | `openai:gpt-5.2` |
| GPT-4o Mini | `openai:gpt-5.2-mini` |
| o3 | `openai:o3` |
| o3-mini | `openai:o3-mini` |
| o4-mini | `openai:o4-mini` |

```typescript
const agent = new BuiltInAgent({
  model: "openai:gpt-4.1",
});
```

### Anthropic

| Model | Specifier |
|-------|-----------|
| Claude Sonnet 4.5 | `anthropic:claude-sonnet-4.5` |
| Claude Sonnet 4 | `anthropic:claude-sonnet-4` |
| Claude 3.7 Sonnet | `anthropic:claude-3.7-sonnet` |
| Claude Opus 4.1 | `anthropic:claude-opus-4.1` |
| Claude Opus 4 | `anthropic:claude-opus-4` |
| Claude 3.5 Haiku | `anthropic:claude-3.5-haiku` |

```typescript
const agent = new BuiltInAgent({
  model: "anthropic:claude-sonnet-4.5",
});
```

### Google

| Model | Specifier |
|-------|-----------|
| Gemini 2.5 Pro | `google:gemini-2.5-pro` |
| Gemini 2.5 Flash | `google:gemini-2.5-flash` |
| Gemini 2.5 Flash Lite | `google:gemini-2.5-flash-lite` |

```typescript
const agent = new BuiltInAgent({
  model: "google:gemini-2.5-pro",
});
```

## Environment Variables

Set the API key for your chosen provider:

```bash
# OpenAI
OPENAI_API_KEY=sk-...

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Google
GOOGLE_API_KEY=...
```

Alternatively, pass the API key directly in your configuration:

```typescript
const agent = new BuiltInAgent({
  model: "openai:gpt-4.1",
  apiKey: process.env.MY_OPENAI_KEY, // [!code highlight]
});
```

## Custom Models (AI SDK)

For models not in the built-in list, you can pass any Vercel AI SDK `LanguageModel` instance directly:

```typescript
import { BuiltInAgent } from "@copilotkit/runtime/v2";
import { createOpenAI } from "@ai-sdk/openai"; // [!code highlight]

const customProvider = createOpenAI({ // [!code highlight]
  apiKey: process.env.MY_API_KEY, // [!code highlight]
  baseURL: "https://my-proxy.example.com/v1", // [!code highlight]
}); // [!code highlight]

const agent = new BuiltInAgent({
  model: customProvider("my-fine-tuned-model"), // [!code highlight]
});
```

This works with any AI SDK provider — Azure OpenAI, AWS Bedrock, Ollama, or any OpenAI-compatible endpoint:

```typescript
import { createAzure } from "@ai-sdk/azure";

const azure = createAzure({
  resourceName: "my-resource",
  apiKey: process.env.AZURE_API_KEY,
});

const agent = new BuiltInAgent({
  model: azure("my-deployment"),
});
```

## How It Works

Under the hood, the Built-in Agent resolves model strings to AI SDK provider instances:

- `"openai:gpt-4.1"` → `@ai-sdk/openai` → `openai("gpt-4.1")`
- `"anthropic:claude-sonnet-4.5"` → `@ai-sdk/anthropic` → `anthropic("claude-sonnet-4.5")`
- `"google:gemini-2.5-pro"` → `@ai-sdk/google` → `google("gemini-2.5-pro")`

Both `"provider:model"` and `"provider/model"` separators are supported and work identically.

### Prebuilt Components
- Route: `/built-in-agent/prebuilt-components`
- Source: `docs/content/docs/integrations/built-in-agent/prebuilt-components.mdx`
- Description: Drop-in chat components for your Built-in Agent.

```tsx title="layout.tsx"
import "@copilotkit/react-ui/v2/styles.css";
```
```tsx title="page.tsx"
// [!code word:CopilotChat]
import { CopilotChat } from "@copilotkit/react-core/v2";

export function YourComponent() {
  return (
    <CopilotChat
      labels={{
        modalHeaderTitle: "Your Assistant",
        welcomeMessageText: "Hi! How can I assist you today?",
      }}
    />
  );
}
```
```tsx title="page.tsx"
// [!code word:CopilotSidebar]
import { CopilotSidebar } from "@copilotkit/react-core/v2";

export function YourApp() {
  return (
    <CopilotSidebar
      defaultOpen={true}
      labels={{
        modalHeaderTitle: "Sidebar Assistant",
        welcomeMessageText: "How can I help you today?",
      }}
    >
      <YourMainContent />
    </CopilotSidebar>
  );
}
```
```tsx title="page.tsx"
// [!code word:CopilotPopup]
import { CopilotPopup } from "@copilotkit/react-core/v2";

export function YourApp() {
  return (
    <>
      <YourMainContent />
      <CopilotPopup
        labels={{
          modalHeaderTitle: "Popup Assistant",
          welcomeMessageText: "Need any help?",
        }}
      />
    </>
  );
}
```
```tsx title="page.tsx"
<CopilotChat
  // Style slots with Tailwind classes
  input={{
    textArea: "text-lg",
    sendButton: "bg-blue-600 hover:bg-blue-700",
  }}
  // Customize nested message slots
  messageView={{
    assistantMessage: {
      className: "bg-gray-50 rounded-xl p-4",
      toolbar: "border-t mt-2",
    },
    userMessage: "bg-blue-100 rounded-xl",
  }}
  // Hide elements by returning null
  scrollView={{
    feather: () => null,
  }}
/>
```

### Fully Headless UI
- Route: `/built-in-agent/premium/headless-ui`
- Source: `docs/content/docs/integrations/built-in-agent/premium/headless-ui.mdx`
- Description: Fully customize your Copilot's UI from the ground up using headless UI

```bash
    npx copilotkit@latest create
```
```bash
    open README.md
```
```tsx title="src/app/layout.tsx"
    <CopilotKit
      publicLicenseKey="your-free-public-license-key"
    >
      {children}
    </CopilotKit>
```
```tsx title="src/app/page.tsx"
    "use client";
    import { useState } from "react";
    import { useCopilotChatHeadless_c } from "@copilotkit/react-core/v2"; // [!code highlight]

    export default function Home() {
      const { messages, sendMessage, isLoading } = useCopilotChatHeadless_c(); // [!code highlight]
      const [input, setInput] = useState("");

      const handleSend = () => {
        if (input.trim()) {
          // [!code highlight:5]
          sendMessage({
            id: Date.now().toString(),
            role: "user",
            content: input,
          });
          setInput("");
        }
      };

      return (
        <div>
          <h1>My Headless Chat</h1>

          {/* Messages */}
          <div>
            {/* [!code highlight:6] */}
            {messages.map((message) => (
              <div key={message.id}>
                <strong>{message.role === "user" ? "You" : "Assistant"}:</strong>
                <p>{message.content}</p>
              </div>
            ))}

            {/* [!code highlight:1] */}
            {isLoading && <p>Assistant is typing...</p>}
          </div>

          {/* Input */}
          <div>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              // [!code highlight:1]
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="Type your message here..."
            />
            {/* [!code highlight:1] */}
            <button onClick={handleSend} disabled={isLoading}>
              Send
            </button>
          </div>
        </div>
      );
    }
```
```tsx title="src/app/components/chat.tsx"
import { useFrontendTool } from "@copilotkit/react-core/v2";

export const Chat = () => {
  // ...

  // Define an action that will show a custom component
  useFrontendTool({
    name: "showCustomComponent",
    // Handle the tool on the frontend
    // [!code highlight:3]
    handler: () => {
      return "Foo, Bar, Baz";
    },
    // Render a custom component for the underlying data
    // [!code highlight:13]
    render: ({ result, args, status}) => {
      return <div style={{
        backgroundColor: "red",
        padding: "10px",
        borderRadius: "5px",
      }}>
        <p>Custom component</p>
        <p>Result: {result}</p>
        <p>Args: {JSON.stringify(args)}</p>
        <p>Status: {status}</p>
      </div>;
    }
  });

  // ...

  return <div>
    {messages.map((message) => (
      <p key={message.id}>
        {message.role === "user" ? "User: " : "Assistant: "}
        {message.content}
        {/* Render the generative UI if it exists */}
        {/* [!code highlight:1] */}
        {message.role === "assistant" && message.generativeUI?.()}
      </p>
    ))}
  </div>
};
```
```tsx title="src/app/components/chat.tsx"
export const Chat = () => {
  // ...

  return <div>
    {messages.map((message) => (
      <p key={message.id}>
        {/* Render the tool calls if they exist */}
        {/* [!code highlight:5] */}
        {message.role === "assistant" && message.toolCalls?.map((toolCall) => (
          <p key={toolCall.id}>
            {toolCall.function.name}: {toolCall.function.arguments}
          </p>
        ))}
      </p>
    ))}
  </div>
};
```
```tsx title="src/app/components/chat.tsx"
import { useCopilotChatHeadless_c, useCopilotChatSuggestions } from "@copilotkit/react-core/v2"; // [!code highlight]

export const Chat = () => {
  // Specify what suggestions should be generated
  // [!code highlight:5]
  useCopilotChatSuggestions({
    instructions:
      "Suggest 5 interesting activities for programmers to do on their next vacation",
    maxSuggestions: 5,
  });

  // Grab relevant state from the headless hook
  const { suggestions, generateSuggestions, sendMessage } = useCopilotChatHeadless_c(); // [!code highlight]

  // Generate suggestions when the component mounts
  useEffect(() => {
    generateSuggestions(); // [!code highlight]
  }, []);

  // ...

  // [!code word:suggestion]
  return <div>
    {suggestions.map((suggestion, index) => (
      <button
        key={index}
        onClick={() => sendMessage({
          id: "123",
          role: "user",
          content: suggestion.message
        })}
      >
        {suggestion.title}
      </button>
    ))}
  </div>
};
```
```tsx title="src/app/components/chat.tsx"
import { useCopilotChatHeadless_c } from "@copilotkit/react-core/v2";

export const Chat = () => {
  // Grab relevant state from the headless hook
  // [!code highlight:1]
  const { suggestions, setSuggestions } = useCopilotChatHeadless_c();

  // Set the suggestions when the component mounts
  // [!code highlight:6]
  useEffect(() => {
    setSuggestions([
      { title: "Suggestion 1", message: "The actual message for suggestion 1" },
      { title: "Suggestion 2", message: "The actual message for suggestion 2" },
    ]);
  }, []);

  // Change the suggestions on function call
  const changeSuggestions = () => {
    // [!code highlight:4]
    setSuggestions([
      { title: "Foo", message: "Bar" },
      { title: "Baz", message: "Bat" },
    ]);
  };

  // [!code word:suggestion]
  return (
    <div>
      {/* Change on button click */}
      <button onClick={changeSuggestions}>Change suggestions</button>

      {/* Render */}
      {suggestions.map((suggestion, index) => (
        <button
          key={index}
          onClick={() => sendMessage({
            id: "123",
            role: "user",
            content: suggestion.message
          })}
        >
          {suggestion.title}
        </button>
      ))}
    </div>
  );
};
```
```tsx title="src/app/components/chat.tsx"
import { useFrontendTool, useCopilotChatHeadless_c } from "@copilotkit/react-core/v2";

export const Chat = () => {
  const { messages, sendMessage } = useCopilotChatHeadless_c();

  // Define an action that will wait for the user to enter their name
  useFrontendTool({
    name: "getName",
    renderAndWaitForResponse: ({ respond, args, status}) => {
      if (status === "complete") {
        return <div>
          <p>Name retrieved...</p>
        </div>;
      }

      return <div>
        <input
          type="text"
          value={args.name || ""}
          onChange={(e) => respond?.(e.target.value)}
          placeholder="Enter your name"
        />
        {/* Respond with the name */}
        {/* [!code highlight:1] */}
        <button onClick={() => respond?.(args.name)}>Submit</button>
      </div>;
    }
  });

  return (
    {messages.map((message) => (
      <p key={message.id}>
        {message.role === "user" ? "User: " : "Assistant: "}
        {message.content}
        {/* [!code highlight:2] */}
        {/* This will render the tool-based HITL if it exists */}
        {message.role === "assistant" && message.generativeUI?.()}
      </p>
    ))}
  )
};
```

### Observability
- Route: `/built-in-agent/premium/observability`
- Source: `docs/content/docs/integrations/built-in-agent/premium/observability.mdx`
- Description: Monitor your CopilotKit application with comprehensive observability hooks. Understand user interactions, chat events, and system errors.

Monitor CopilotKit with first‑class observability hooks that emit structured signals for chat events, user interactions, and runtime errors. Send these signals straight to your existing stack, including Sentry, Datadog, New Relic, and OpenTelemetry, or route them to your analytics pipeline. The hooks expose stable schemas and IDs so you can join agent events with app telemetry, trace sessions end to end, and alert on failures in real time. Works with Copilot Cloud via `publicApiKey`, or self‑hosted via `publicLicenseKey`.
## Quick Start

  All observability hooks require a `publicLicenseKey` or `publicAPIkey` - Get yours free at
  [https://cloud.copilotkit.ai](https://cloud.copilotkit.ai)

### Chat Observability Hooks

Track user interactions and chat events with comprehensive observability hooks:

```tsx
import { CopilotChat } from "@copilotkit/react-core/v2";
import { CopilotKit } from "@copilotkit/react-core/v2";

export default function App() {
  return (
    <CopilotKit
      publicApiKey="ck_pub_your_key" // [!code highlight] - Use publicApiKey for Copilot Cloud
      // OR
      publicLicenseKey="ck_pub_your_key" // [!code highlight] - Use publicLicenseKey for self-hosted
    >
      <CopilotChat
        observabilityHooks={{
          // [!code highlight]
          onMessageSent: (message) => {
            // [!code highlight]
            console.log("Message sent:", message);
            analytics.track("chat_message_sent", { message });
          }, // [!code highlight]
          onChatExpanded: () => {
            // [!code highlight]
            console.log("Chat opened");
            analytics.track("chat_expanded");
          }, // [!code highlight]
          onChatMinimized: () => {
            // [!code highlight]
            console.log("Chat closed");
            analytics.track("chat_minimized");
          }, // [!code highlight]
          onFeedbackGiven: (messageId, type) => {
            // [!code highlight]
            console.log("Feedback:", type, messageId);
            analytics.track("chat_feedback", { messageId, type });
          }, // [!code highlight]
        }} // [!code highlight]
      />
    </CopilotKit>
  );
}
```

### Error Observability

Monitor system errors and performance with error observability hooks:

```tsx
import { CopilotKit } from "@copilotkit/react-core/v2";

export default function App() {
  return (
    <CopilotKit
      publicApiKey="ck_pub_your_key" // [!code highlight] - Use publicApiKey for Copilot Cloud
      // OR
      publicLicenseKey="ck_pub_your_key" // [!code highlight] - Use publicLicenseKey for self-hosted
      onError={(errorEvent) => {
        // [!code highlight]
        // Send errors to monitoring service
        console.error("CopilotKit Error:", errorEvent);

        // Example: Send to analytics
        analytics.track("copilotkit_error", {
          type: errorEvent.type,
          source: errorEvent.context.source,
          timestamp: errorEvent.timestamp,
        });
      }} // [!code highlight]
      showDevConsole={false} // Hide dev console in production
    >
      {/* Your app */}
    </CopilotKit>
  );
}
```

## Observability Features

### CopilotChat Observability Hooks

Track user interactions, chat behavior and errors with comprehensive observability hooks (requires a `publicLicenseKey` if self-hosted or `publicAPIkey` if using CopilotCloud):

```tsx
import { CopilotChat } from "@copilotkit/react-core/v2";

<CopilotChat
  observabilityHooks={{
    onMessageSent: (message) => {
      console.log("Message sent:", message);
      // Track message analytics
      analytics.track("chat_message_sent", { message });
    },
    onChatExpanded: () => {
      console.log("Chat opened");
      // Track engagement
      analytics.track("chat_expanded");
    },
    onChatMinimized: () => {
      console.log("Chat closed");
      // Track user behavior
      analytics.track("chat_minimized");
    },
    onMessageRegenerated: (messageId) => {
      console.log("Message regenerated:", messageId);
      // Track regeneration requests
      analytics.track("chat_message_regenerated", { messageId });
    },
    onMessageCopied: (content) => {
      console.log("Message copied:", content);
      // Track content sharing
      analytics.track("chat_message_copied", { contentLength: content.length });
    },
    onFeedbackGiven: (messageId, type) => {
      console.log("Feedback given:", messageId, type);
      // Track user feedback
      analytics.track("chat_feedback_given", { messageId, type });
    },
    onChatStarted: () => {
      console.log("Chat generation started");
      // Track when AI starts responding
      analytics.track("chat_generation_started");
    },
    onChatStopped: () => {
      console.log("Chat generation stopped");
      // Track when AI stops responding
      analytics.track("chat_generation_stopped");
    },
    onError: (errorEvent) => {
      console.log("Error occurred", errorEvent);
      // Log error
      analytics.track("error_event", errorEvent);
    },
  }}
/>;
```

**Available Observability Hooks:**

- `onMessageSent(message)` - User sends a message
- `onChatExpanded()` - Chat is opened/expanded
- `onChatMinimized()` - Chat is closed/minimized
- `onMessageRegenerated(messageId)` - Message is regenerated
- `onMessageCopied(content)` - Message is copied
- `onFeedbackGiven(messageId, type)` - Thumbs up/down feedback given
- `onChatStarted()` - Chat generation starts
- `onChatStopped()` - Chat generation stops
- `onError(errorEvent)` - Error events and system monitoring

**Requirements:**

- ✅ Requires a `publicLicenseKey` (when self-hosting) or `publicApiKey` from [Copilot Cloud](https://cloud.copilotkit.ai)
- ✅ Works with `CopilotChat`, `CopilotPopup`, `CopilotSidebar`, and all pre-built components

  **Important:** Observability hooks will **not trigger** without a valid
  key. This is a security feature to ensure observability hooks only
  work in authorized applications.

## Error Event Structure

The `onError` handler receives detailed error events with rich context:

```typescript
interface CopilotErrorEvent {
  type:
    | "error"
    | "request"
    | "response"
    | "agent_state"
    | "action"
    | "message"
    | "performance";
  timestamp: number;
  context: {
    source: "ui" | "runtime" | "agent";
    request?: {
      operation: string;
      method?: string;
      url?: string;
      startTime: number;
    };
    response?: {
      endTime: number;
      latency: number;
    };
    agent?: {
      name: string;
      nodeName?: string;
    };
    messages?: {
      input: any[];
      messageCount: number;
    };
    technical?: {
      environment: string;
      stackTrace?: string;
    };
  };
  error?: any; // Present for error events
}
```

## Common Observability Patterns

### Chat Event Tracking

```tsx
<CopilotChat
  observabilityHooks={{
    onMessageSent: (message) => {
      // Track message analytics
      analytics.track("chat_message_sent", {
        messageLength: message.length,
        timestamp: Date.now(),
        userId: getCurrentUserId(),
      });
    },
    onChatExpanded: () => {
      // Track user engagement
      analytics.track("chat_expanded", {
        timestamp: Date.now(),
        userId: getCurrentUserId(),
      });
    },
    onFeedbackGiven: (messageId, type) => {
      // Track feedback for AI improvement
      analytics.track("chat_feedback", {
        messageId,
        feedbackType: type,
        timestamp: Date.now(),
      });
    },
  }}
/>
```

### Combined Event and Error Tracking

```tsx
<CopilotKit
  publicApiKey="ck_pub_your_key" // [!code highlight] - Use publicApiKey for Copilot Cloud
  // OR
  publicLicenseKey="ck_pub_your_key" // [!code highlight] - Use publicLicenseKey for self-hosted
  onError={(errorEvent) => {
    // Error observability
    if (errorEvent.type === "error") {
      console.error("CopilotKit Error:", errorEvent);
      analytics.track("copilotkit_error", {
        error: errorEvent.error?.message,
        context: errorEvent.context,
      });
    }
  }}
>
  <CopilotChat
    observabilityHooks={{
      onMessageSent: (message) => {
        // Event tracking
        analytics.track("chat_message_sent", { message });
      },
      onChatExpanded: () => {
        analytics.track("chat_expanded");
      },
    }}
  />
</CopilotKit>
```

## Error Observability Patterns

### Basic Error Logging

```tsx
<CopilotKit
  publicApiKey="ck_pub_your_key" // [!code highlight] - Use publicApiKey for Copilot Cloud
  // OR
  publicLicenseKey="ck_pub_your_key" // [!code highlight] - Use publicLicenseKey for self-hosted
  onError={(errorEvent) => {
    console.error("[CopilotKit Error]", {
      type: errorEvent.type,
      timestamp: new Date(errorEvent.timestamp).toISOString(),
      context: errorEvent.context,
      error: errorEvent.error,
    });
  }}
>
  {/* Your app */}
</CopilotKit>
```

### Integration with Monitoring Services

```tsx
// Example with Sentry
import * as Sentry from "@sentry/react";

<CopilotKit
  publicApiKey="ck_pub_your_key" // [!code highlight] - Use publicApiKey for Copilot Cloud
  // OR
  publicLicenseKey="ck_pub_your_key" // [!code highlight] - Use publicLicenseKey for self-hosted
  onError={(errorEvent) => {
    if (errorEvent.type === "error") {
      Sentry.captureException(errorEvent.error, {
        tags: {
          source: errorEvent.context.source,
          operation: errorEvent.context.request?.operation,
        },
        extra: {
          context: errorEvent.context,
          timestamp: errorEvent.timestamp,
        },
      });
    }
  }}
>
  {/* Your app */}
</CopilotKit>;
```

### Custom Error Analytics

```tsx
<CopilotKit
  publicApiKey="ck_pub_your_key" // [!code highlight] - Use publicApiKey for Copilot Cloud
  // OR
  publicLicenseKey="ck_pub_your_key" // [!code highlight] - Use publicLicenseKey for self-hosted
  onError={(errorEvent) => {
    // Track different error types
    analytics.track("copilotkit_event", {
      event_type: errorEvent.type,
      source: errorEvent.context.source,
      agent_name: errorEvent.context.agent?.name,
      latency: errorEvent.context.response?.latency,
      error_message: errorEvent.error?.message,
      timestamp: errorEvent.timestamp,
    });
  }}
>
  {/* Your app */}
</CopilotKit>
```

## Development vs Production Setup

### Development Environment

```tsx
<CopilotKit
  runtimeUrl="http://localhost:3000/api/copilotkit"
  publicLicenseKey={process.env.NEXT_PUBLIC_COPILOTKIT_LICENSE_KEY} // Self-hosted
  // OR
  publicApiKey={process.env.NEXT_PUBLIC_COPILOTKIT_API_KEY} // Using Copilot Cloud
  showDevConsole={true} // Show visual errors
  onError={(errorEvent) => {
    // Simple console logging for development
    console.log("CopilotKit Event:", errorEvent);
  }}
>
  <CopilotChat
    observabilityHooks={{
      onMessageSent: (message) => {
        console.log("Message sent:", message);
      },
      onChatExpanded: () => {
        console.log("Chat expanded");
      },
    }}
  />
</CopilotKit>
```

### Production Environment

```tsx
<CopilotKit
  runtimeUrl="https://your-app.com/api/copilotkit"
  publicLicenseKey={process.env.NEXT_PUBLIC_COPILOTKIT_LICENSE_KEY} // [!code highlight]
  // OR
  publicApiKey={process.env.NEXT_PUBLIC_COPILOTKIT_API_KEY} // [!code highlight]
  showDevConsole={false} // Hide from users
  onError={(errorEvent) => {
    // Production error observability
    if (errorEvent.type === "error") {
      // Log critical errors
      logger.error("CopilotKit Error", {
        error: errorEvent.error,
        context: errorEvent.context,
        timestamp: errorEvent.timestamp,
      });

      // Send to monitoring service
      monitoring.captureError(errorEvent.error, {
        extra: errorEvent.context,
      });
    }
  }}
>
  <CopilotChat
    observabilityHooks={{
      onMessageSent: (message) => {
        // Track production analytics
        analytics.track("chat_message_sent", {
          messageLength: message.length,
          userId: getCurrentUserId(),
        });
      },
      onChatExpanded: () => {
        analytics.track("chat_expanded");
      },
      onFeedbackGiven: (messageId, type) => {
        // Track feedback for AI improvement
        analytics.track("chat_feedback", { messageId, type });
      },
    }}
  />
</CopilotKit>
```

## Getting Started with CopilotKit Premium

To use observability hooks (event hooks and error observability), you'll need a CopilotKit Premium account:

1. **Sign up for free** at [https://cloud.copilotkit.ai](https://cloud.copilotkit.ai)
2. **Get your public license key (for self-hosting), or public API key** from the dashboard
3. **Add it to your environment variables**:
```bash
   NEXT_PUBLIC_COPILOTKIT_LICENSE_KEY=ck_pub_your_key_here
   # OR
   NEXT_PUBLIC_COPILOTKIT_API_KEY=ck_pub_your_key_here
```
4. **Use it in your CopilotKit provider**:
```tsx
   <CopilotKit 
      publicLicenseKey={process.env.NEXT_PUBLIC_COPILOTKIT_LICENSE_KEY}
      // OR
      publicApiKey={process.env.NEXT_PUBLIC_COPILOTKIT_API_KEY}
      >
     <CopilotChat
       observabilityHooks={{
         onMessageSent: (message) => console.log("Message:", message),
         onChatExpanded: () => console.log("Chat opened"),
       }}
     />
   </CopilotKit>
```

  CopilotKit Premium is free to get started and provides production-ready
  infrastructure for your AI copilots, including comprehensive observability
  capabilities for tracking user behavior and monitoring system health.

### CopilotKit Premium
- Route: `/built-in-agent/premium/overview`
- Source: `docs/content/docs/integrations/built-in-agent/premium/overview.mdx`
- Description: Premium features for CopilotKit.

## What is CopilotKit Premium?
CopilotKit Premium plans deliver:
- A commercial license for premium extensions to the open source CopilotKit framework (self-hosted or using Copilot Cloud)
- Access to the Copilot Cloud hosted service.

CopilotKit Premium is designed for teams building production-grade, agent-powered applications with CopilotKit.
Premium extension features — such as Fully Headless UI and debugging tools — can be used in both self-hosted and cloud-hosted deployments.

The Developer tier of CopilotKit Premium is always free.

## Premium Plans
- Developer – Free forever, includes early-stage access and limited cloud usage
- Pro – For growing teams building in production
- Enterprise – For organizations with advanced scalability, security, and support needs
## Early Access
Certain features—like the Headless UI—will initially be available only to Premium subscribers before becoming part of the open-source core as the framework matures.
All CopilotKit Premium subscribers get early access to new features, tooling, and integrations as they are released.

## Current Premium Features
- [Fully Headless Chat UI](headless-ui) - Early Access
- [Observability Hooks](observability)
- [Copilot Cloud](https://cloud.copilotkit.ai)

## FAQs

### How do I get access to premium features?

#### Option 1:  Use Copilot Cloud!
All CopilotKit Premium features are included in Copilot Cloud.

#### Option 2:  Self-host with a license key.
Access to premium features requires a public license key. To get yours, follow the steps below.

    #### Sign up

    Create a *free* account on [Copilot Cloud](https://cloud.copilotkit.ai).

    This does not require a credit card or use of Copilot Cloud.
    #### Get your public license key

    Once you've signed up, you'll be able to get your public license key from the left nav.
    #### Use the public license key

    Once you've signed up, you'll be able to use the public license key in your CopilotKit instance.

```tsx title="layout.tsx"
    <CopilotKit publicLicenseKey="your-public-license-key" />
```

### Can I still self-host with a public license key?

Yes, you can still self-host with a public license key. It is only required if you want to use premium features,
for access to Copilot Cloud a public API key is utilized.

### What is the difference between a public license key and a public API key?

A public API key is a key that you use to connect your app to Copilot Cloud. Public license keys are used to access premium features
and do not require a connection to Copilot Cloud.

### Programmatic Control
- Route: `/built-in-agent/programmatic-control`
- Source: `docs/content/docs/integrations/built-in-agent/programmatic-control.mdx`
- Description: Control your Built-in Agent programmatically with useAgent and copilotkit.runAgent().

### Import the hook

    First, import `useAgent` from the v2 package:

```tsx title="page.tsx"
    import { useAgent } from "@copilotkit/react-core/v2"; // [!code highlight]
```

    ### Access your agent

    Call the hook to get a reference to your agent:

```tsx title="page.tsx"
    export function AgentInfo() {
      const { agent } = useAgent(); // [!code highlight]

      return (
        <div>
          {/* [!code highlight:4] */}
          <p>Agent ID: {agent.id}</p>
          <p>Thread ID: {agent.threadId}</p>
          <p>Status: {agent.isRunning ? "Running" : "Idle"}</p>
          <p>Messages: {agent.messages.length}</p>
        </div>
      );
    }
```

    The hook will throw an error if no agent is configured, so you can safely use `agent` without null checks.

    ### Display messages

    Access the agent's conversation history:

```tsx title="page.tsx"
    export function MessageList() {
      const { agent } = useAgent();

      return (
        <div>
          {/* [!code highlight:6] */}
          {agent.messages.map((msg) => (
            <div key={msg.id}>
              <strong>{msg.role}:</strong>
              <span>{msg.content}</span>
            </div>
          ))}
        </div>
      );
    }
```

    ### Show running status

    Add a loading indicator when the agent is processing:

```tsx title="page.tsx"
    export function AgentStatus() {
      const { agent } = useAgent();

      return (
        <div>
          {/* [!code highlight:8] */}
          {agent.isRunning ? (
            <div>
              <div className="spinner" />
              <span>Agent is processing...</span>
            </div>
          ) : (
            <span>Ready</span>
          )}
        </div>
      );
    }
```

    ### Run the agent

    Use `copilotkit.runAgent()` to trigger your agent programmatically:

```tsx title="page.tsx"
    import { useAgent } from "@copilotkit/react-core/v2";
    import { useCopilotKit } from "@copilotkit/react-core/v2";
    import { randomUUID } from "@copilotkit/shared/v2";

    export function RunAgent() {
      const { agent } = useAgent();
      // [!code highlight:1]
      const { copilotkit } = useCopilotKit();

      const handleRun = async () => {
        agent.addMessage({
          id: randomUUID(),
          role: "user",
          content: "Hello, agent!",
        });

        // [!code highlight:1]
        await copilotkit.runAgent({ agent });
      };

      return <button onClick={handleRun}>Send</button>;
    }
```

    `copilotkit.runAgent()` orchestrates the full agent lifecycle — executing frontend tools, handling follow-up runs, and streaming results. This is the same method `` uses internally.

## Working with State

Agents expose their state through the `agent.state` property. This state is shared between your application and the agent - both can read and modify it.

### Reading State

Access your agent's current state:

```tsx title="page.tsx"
export function StateDisplay() {
  const { agent } = useAgent();

  return (
    <div>
      <h3>Agent State</h3>
      {/* [!code highlight:1] */}
      <pre>{JSON.stringify(agent.state, null, 2)}</pre>

      {/* Access specific properties */}
      {/* [!code highlight:2] */}
      {agent.state.user_name && <p>User: {agent.state.user_name}</p>}
      {agent.state.preferences && <p>Preferences: {JSON.stringify(agent.state.preferences)}</p>}
    </div>
  );
}
```

Your component automatically re-renders when the agent's state changes.

### Updating State

Update state that your agent can access:

```tsx title="page.tsx"
export function ThemeSelector() {
  const { agent } = useAgent();

  const updateTheme = (theme: string) => {
    // [!code highlight:4]
    agent.setState({
      ...agent.state,
      user_theme: theme,
    });
  };

  return (
    <div>
      {/* [!code highlight:2] */}
      <button onClick={() => updateTheme("dark")}>Dark Mode</button>
      <button onClick={() => updateTheme("light")}>Light Mode</button>
      <p>Current: {agent.state.user_theme || "default"}</p>
    </div>
  );
}
```

State updates are immediately available to your agent in its next execution.

## Subscribing to Agent Events

You can subscribe to agent events using the `subscribe()` method. This is useful for logging, monitoring, or responding to specific agent behaviors.

### Basic Event Subscription

```tsx title="page.tsx"
import { useEffect } from "react";
import { useAgent } from "@copilotkit/react-core/v2";
import type { AgentSubscriber } from "@ag-ui/client";

export function EventLogger() {
  const { agent } = useAgent();

  useEffect(() => {
    // [!code highlight:15]
    const subscriber: AgentSubscriber = {
      onCustomEvent: ({ event }) => {
        console.log("Custom event:", event.name, event.value);
      },
      onRunStartedEvent: () => {
        console.log("Agent started running");
      },
      onRunFinalized: () => {
        console.log("Agent finished running");
      },
      onStateChanged: (state) => {
        console.log("State changed:", state);
      },
    };

    // [!code highlight:2]
    const { unsubscribe } = agent.subscribe(subscriber);
    return () => unsubscribe();
  }, []);

  return null;
}
```

### Available Events

The `AgentSubscriber` interface provides:

- **`onCustomEvent`** - Custom events emitted by the agent
- **`onRunStartedEvent`** - Agent starts executing
- **`onRunFinalized`** - Agent completes execution
- **`onStateChanged`** - Agent's state changes
- **`onMessagesChanged`** - Messages are added or modified

## Rendering Tool Calls

You can customize how agent tool calls are displayed in your UI. First, define your tool renderers:

```tsx title="components/weather-tool.tsx"
import { defineToolCallRenderer } from "@copilotkit/react-core/v2";

// [!code highlight:6]
export const weatherToolRender = defineToolCallRenderer({
  name: "get_weather",
  render: ({ args, status }) => {
    return <WeatherCard location={args.location} status={status} />;
  },
});

function WeatherCard({ location, status }: { location?: string; status: string }) {
  return (
    <div className="rounded-lg border p-6 shadow-sm">
      <h3 className="text-xl font-semibold">Weather in {location}</h3>
      <div className="mt-4">
        <span className="text-5xl font-light">70°F</span>
      </div>
      {status === "executing" && <div className="spinner">Loading...</div>}
    </div>
  );
}
```

Register your tool renderers with CopilotKit:

```tsx title="layout.tsx"
import { CopilotKit } from "@copilotkit/react-core";
import { weatherToolRender } from "./components/weather-tool";

export default function RootLayout({ children }) {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      {/* [!code highlight:1] */}
      renderToolCalls={[weatherToolRender]}
    >
      {children}
    </CopilotKit>
  );
}
```

Then use `useRenderToolCall` to render tool calls from agent messages:

```tsx title="components/message-list.tsx"
import { useAgent, useRenderToolCall } from "@copilotkit/react-core/v2";

export function MessageList() {
  const { agent } = useAgent();
  const renderToolCall = useRenderToolCall();

  return (
    <div className="messages">
      {agent.messages.map((message) => (
        <div key={message.id}>
          {/* Display message content */}
          {message.content && <p>{message.content}</p>}

          {/* Render tool calls if present */}
          {/* [!code highlight:9] */}
          {message.role === "assistant" && message.toolCalls?.map((toolCall) => {
            const toolMessage = agent.messages.find(
              (m) => m.role === "tool" && m.toolCallId === toolCall.id
            );
            return (
              <div key={toolCall.id}>
                {renderToolCall({ toolCall, toolMessage })}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
```

## Building a Complete Dashboard

Here's a full example combining all concepts into an interactive agent dashboard:

```tsx title="page.tsx"
"use client";

import { useAgent } from "@copilotkit/react-core/v2";

export default function AgentDashboard() {
  const { agent } = useAgent();

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      {/* Status */}
      <div className="p-6 bg-white rounded-lg shadow">
        <h2 className="text-xl font-bold mb-4">Agent Status</h2>
        <div className="space-y-2">
          {/* [!code highlight:6] */}
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${
              agent.isRunning ? "bg-yellow-500 animate-pulse" : "bg-green-500"
            }`} />
            <span>{agent.isRunning ? "Running" : "Idle"}</span>
          </div>
          <div>Thread: {agent.threadId}</div>
          <div>Messages: {agent.messages.length}</div>
        </div>
      </div>

      {/* State */}
      <div className="p-6 bg-white rounded-lg shadow">
        <h2 className="text-xl font-bold mb-4">Agent State</h2>
        {/* [!code highlight:3] */}
        <pre className="bg-gray-50 p-4 rounded text-sm overflow-auto">
          {JSON.stringify(agent.state, null, 2)}
        </pre>
      </div>

      {/* Messages */}
      <div className="p-6 bg-white rounded-lg shadow">
        <h2 className="text-xl font-bold mb-4">Conversation</h2>
        <div className="space-y-3">
          {/* [!code highlight:11] */}
          {agent.messages.map((msg) => (
            <div
              key={msg.id}
              className={`p-3 rounded-lg ${
                msg.role === "user" ? "bg-blue-50 ml-8" : "bg-gray-50 mr-8"
              }`}
            >
              <div className="font-semibold text-sm mb-1">
                {msg.role === "user" ? "You" : "Agent"}
              </div>
              <div>{msg.content}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

## Running the Agent Programmatically

Use `copilotkit.runAgent()` to trigger your agent from any component — no chat UI required. This is the same method CopilotKit's built-in `` uses internally.

```tsx title="page.tsx"
import { useAgent } from "@copilotkit/react-core/v2";
import { useCopilotKit } from "@copilotkit/react-core/v2";
import { randomUUID } from "@copilotkit/shared/v2";

export function AgentTrigger() {
  const { agent } = useAgent();
  // [!code highlight:1]
  const { copilotkit } = useCopilotKit();

  const handleRun = async () => {
    // Add a user message to the agent's conversation
    agent.addMessage({
      id: randomUUID(),
      role: "user",
      content: "Summarize the latest sales data",
    });

    // [!code highlight:2]
    // Run the agent — handles tool execution, follow-ups, and streaming
    await copilotkit.runAgent({ agent });
  };

  return <button onClick={handleRun}>Run Agent</button>;
}
```

### `copilotkit.runAgent()` vs `agent.runAgent()`

Both methods trigger the agent, but they operate at different levels:

- **`copilotkit.runAgent({ agent })`** — The recommended approach. Orchestrates the full agent lifecycle: executes frontend tools, handles follow-up runs when tools request them, and manages errors through the subscriber system.
- **`agent.runAgent()`** — Low-level method on the agent instance. Sends the request to the runtime but does **not** execute frontend tools or handle follow-ups. Use this only when you need direct control over the agent execution (e.g., resuming from an interrupt with `forwardedProps`).

### Stopping a Run

You can stop a running agent using `copilotkit.stopAgent()`:

```tsx title="page.tsx"
const handleStop = () => {
  copilotkit.stopAgent({ agent });
};
```

### Quickstart
- Route: `/built-in-agent/quickstart`
- Source: `docs/content/docs/integrations/built-in-agent/quickstart.mdx`
- Description: Get started with CopilotKit's Built-in Agent in minutes.

## Prerequisites

Before you begin, you'll need the following:

- An OpenAI API key (or Anthropic/Google — see [Model Selection](/built-in-agent/model-selection))
- Node.js 20+
- Your favorite package manager

## Getting started

                    You can either start fresh with our starter template or set up manually.
                ### Run our CLI

```bash
                npx copilotkit@latest create -f built-in-agent
```
                ### Install dependencies

```npm
                npm install
```
                ### Configure your environment

                Create a `.env` file and add your OpenAI API key:

```plaintext title=".env"
                OPENAI_API_KEY=your_openai_api_key
```

                  The starter template uses OpenAI's GPT-4o by default. See [Model Selection](/built-in-agent/model-selection) for Anthropic, Google, or custom model setup.
                ### Start the development server

```bash
                        npm run dev
```
```bash
                        pnpm dev
```
```bash
                        yarn dev
```
```bash
                        bun dev
```
                ### Create your frontend

                CopilotKit works with any React-based frontend. We'll use Next.js for this example.

```bash
                npx create-next-app@latest my-copilot-app
                cd my-copilot-app
```
                ### Install CopilotKit packages

```npm
                npm install @copilotkit/react-core @copilotkit/react-ui @copilotkit/runtime
```
                ### Configure your environment

                Create a `.env` file and add your OpenAI API key:

```plaintext title=".env"
                OPENAI_API_KEY=your_openai_api_key
```

                  This example uses OpenAI's GPT-4o. See [Model Selection](/built-in-agent/model-selection) for Anthropic, Google, or custom model setup.
                ### Setup Copilot Runtime

                Create an API route with the `BuiltInAgent` and `CopilotRuntime`:

```ts title="app/api/copilotkit/route.ts"
                import {
                  CopilotRuntime,
                  copilotRuntimeNextJSAppRouterEndpoint,
                } from "@copilotkit/runtime";
                import { BuiltInAgent } from "@copilotkit/runtime/v2"; // [!code highlight]
                import { NextRequest } from "next/server";

                const builtInAgent = new BuiltInAgent({ // [!code highlight:3]
                  model: "openai:gpt-5.2",
                });

                const runtime = new CopilotRuntime({
                  agents: { default: builtInAgent }, // [!code highlight]
                });

                export const POST = async (req: NextRequest) => {
                  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
                    runtime,
                    endpoint: "/api/copilotkit",
                  });

                  return handleRequest(req);
                };
```
                ### Configure CopilotKit Provider

                Wrap your application with the CopilotKit provider:

```tsx title="app/layout.tsx"
                import { CopilotKit } from "@copilotkit/react-core/v2"; // [!code highlight]
                import "@copilotkit/react-ui/v2/styles.css"; // [!code highlight]

                // ...

                export default function RootLayout({ children }: {children: React.ReactNode}) {
                  return (
                    <html lang="en">
                      <body>
                        {/* [!code highlight:3] */}
                        <CopilotKit runtimeUrl="/api/copilotkit">
                          {children}
                        </CopilotKit>
                      </body>
                    </html>
                  );
                }
```
              ### Add the chat interface

              Add the CopilotSidebar component to your page:

```tsx title="app/page.tsx"
              import { CopilotSidebar } from "@copilotkit/react-core/v2"; // [!code highlight]

              export default function Page() {
                return (
                  <main>
                    <h1>Your App</h1>
                    {/* [!code highlight:1] */}
                    <CopilotSidebar />
                  </main>
                );
              }
```
                ### Start the development server

```bash
                        npm run dev
```
```bash
                        pnpm dev
```
```bash
                        yarn dev
```
```bash
                        bun dev
```
        ### 🎉 Start chatting!

        Your AI agent is now ready to use! Try asking it some questions:

```
        Can you tell me a joke?
```

```
        Can you help me understand AI?
```

```
        What do you think about React?
```

                - If you're having connection issues, try using `0.0.0.0` or `127.0.0.1` instead of `localhost`
                - Check that your API key is correctly set in the `.env` file
                - Make sure the runtime endpoint path matches the `runtimeUrl` in your CopilotKit provider

## What's next?

Now that you have your basic agent setup, explore these advanced features:

### Server Tools
- Route: `/built-in-agent/server-tools`
- Source: `docs/content/docs/integrations/built-in-agent/server-tools.mdx`
- Description: Define backend tools for your Built-in Agent.

## What are Server Tools?

Server tools are functions that run on your backend that the Built-in Agent can invoke. They're defined using `defineTool()` with Zod schemas for type-safe parameters.

## When should I use this?

- Your agent needs to access databases, APIs, or other backend services
- You want type-safe tool parameters with validation
- The tool logic requires server-side secrets or resources

## Defining a tool

```typescript title="src/copilotkit.ts"
import { BuiltInAgent, defineTool } from "@copilotkit/runtime/v2";
import { z } from "zod";

const getWeather = defineTool({
  name: "getWeather",
  description: "Get the current weather for a city",
  parameters: z.object({
    city: z.string().describe("The city name"),
  }),
  execute: async ({ city }) => {
    // Your implementation here
    return { temperature: 72, condition: "sunny", city };
  },
});

const builtInAgent = new BuiltInAgent({
  model: "openai:gpt-5.2",
  tools: [getWeather],
});
```

## Tool response

Tools can return any JSON-serializable value. The agent uses the response to continue the conversation.

## Multiple tools

Pass an array of tools — the agent chooses which to call based on the user's request:

```typescript title="src/copilotkit.ts"
const searchDocs = defineTool({
  name: "searchDocs",
  description: "Search the documentation for relevant articles",
  parameters: z.object({
    query: z.string().describe("The search query"),
  }),
  execute: async ({ query }) => {
    const results = await search(query);
    return { results, count: results.length };
  },
});

const createTicket = defineTool({
  name: "createTicket",
  description: "Create a support ticket",
  parameters: z.object({
    title: z.string().describe("Ticket title"),
    priority: z.enum(["low", "medium", "high"]).describe("Ticket priority"),
    description: z.string().describe("Detailed description of the issue"),
  }),
  execute: async ({ title, priority, description }) => {
    const ticket = await db.tickets.create({ title, priority, description });
    return { ticketId: ticket.id, status: "created" };
  },
});

const builtInAgent = new BuiltInAgent({
  model: "openai:gpt-5.2",
  tools: [searchDocs, createTicket], // [!code highlight]
});
```

## Complex Zod schemas

Use nested objects, arrays, enums, and optional fields for sophisticated tool parameters:

```typescript
const bookFlight = defineTool({
  name: "bookFlight",
  description: "Search for and book flights",
  parameters: z.object({
    trip: z.object({
      origin: z.string().describe("Origin airport code (e.g., SFO)"),
      destination: z.string().describe("Destination airport code (e.g., JFK)"),
      date: z.string().describe("Departure date in YYYY-MM-DD format"),
    }),
    passengers: z.array(
      z.object({
        name: z.string(),
        seatPreference: z.enum(["window", "middle", "aisle"]).optional(),
      })
    ).describe("List of passengers"),
    class: z.enum(["economy", "business", "first"]).default("economy"),
  }),
  execute: async ({ trip, passengers, class: seatClass }) => {
    const flights = await searchFlights(trip, seatClass);
    return { flights, passengerCount: passengers.length };
  },
});
```

## Error handling

Throw errors or return error objects from your tool — the agent will see the error and can inform the user or try a different approach:

```typescript
const getUser = defineTool({
  name: "getUser",
  description: "Look up a user by email",
  parameters: z.object({
    email: z.string().email().describe("The user's email address"),
  }),
  execute: async ({ email }) => {
    const user = await db.users.findByEmail(email);
    if (!user) {
      throw new Error(`No user found with email: ${email}`); // [!code highlight]
    }
    return { id: user.id, name: user.name, role: user.role };
  },
});
```

## Multi-step tool calling

By default, the agent performs a single step. If your agent needs to chain tool calls (e.g., search first, then create a ticket), set `maxSteps`:

```typescript
const builtInAgent = new BuiltInAgent({
  model: "openai:gpt-5.2",
  maxSteps: 5, // [!code highlight]
  tools: [searchDocs, createTicket, getUser],
});
```

With `maxSteps: 5`, the agent can:
1. Call `searchDocs` to find relevant info
2. Process the result
3. Call `createTicket` with details from the search
4. Continue until done (up to 5 iterations)

See [Advanced Configuration](/built-in-agent/advanced-configuration) for more options like `toolChoice`, `temperature`, and `providerOptions`.

### Shared State
- Route: `/built-in-agent/shared-state`
- Source: `docs/content/docs/integrations/built-in-agent/shared-state.mdx`
- Description: Bidirectional state sharing between your app and the Built-in Agent.

Share state bidirectionally between your React app and the Built-in Agent. Your app can read and write agent state, and the agent can update state that your UI reacts to in real time.

## What is this?

Shared state lets your frontend and agent stay in sync. The agent can update state (like adding items to a list or changing a setting), and your React components re-render automatically. Your app can also write state that the agent can read.

## When should I use this?

- The agent should be able to modify your app's UI (add items, update fields, toggle settings)
- You want real-time UI updates as the agent works
- Your app needs to read what the agent is doing (progress indicators, intermediate results)

## Reading agent state

Use the `useAgent` hook to access the agent's current state:

```tsx title="app/page.tsx"
import { useAgent } from "@copilotkit/react-core/v2"; // [!code highlight]

function TaskBoard() {
  // [!code highlight:3]
  const { agent } = useAgent({
    agentId: "assistant",
  });

  // Read state set by the agent // [!code highlight]
  const tasks = (agent.state.tasks as any[]) ?? [];

  return (
    <div>
      <h2>Tasks</h2>
      <ul>
        {tasks.map((task, i) => (
          <li key={i}>
            {task.title} — {task.status}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

  `agent.state` is reactive — your component re-renders automatically when the agent updates state.

## Writing state from the frontend

You can also push state from the frontend to the agent:

```tsx title="app/page.tsx"
import { useAgent } from "@copilotkit/react-core/v2";

function SettingsPanel() {
  const { agent } = useAgent({
    agentId: "assistant",
  });

  const handleThemeChange = (theme: string) => {
    agent.setState({ // [!code highlight]
      ...agent.state, // [!code highlight]
      userPreferences: { theme }, // [!code highlight]
    }); // [!code highlight]
  };

  return (
    <div>
      <button onClick={() => handleThemeChange("dark")}>Dark Mode</button>
      <button onClick={() => handleThemeChange("light")}>Light Mode</button>
    </div>
  );
}
```

## How it works

The Built-in Agent automatically has access to state tools (`AGUISendStateSnapshot` and `AGUISendStateDelta`) through the AG-UI protocol. When the agent calls these tools:

1. The agent sends a state update (full snapshot or delta)
2. The CopilotKit runtime delivers the update to the frontend via SSE
3. Your `useAgent` hook receives the update and triggers a re-render

No additional backend configuration is required — state tools are available to the Built-in Agent by default.

## Example: collaborative todo list

Here's a complete example where the agent can add and manage tasks:

```tsx title="app/page.tsx"
import { CopilotChat } from "@copilotkit/react-core/v2";
import { useAgent } from "@copilotkit/react-core/v2";

function TodoApp() {
  const { agent } = useAgent({
    agentId: "assistant",
  });

  const todos = (agent.state.todos as any[]) ?? [];

  return (
    <div style={{ display: "flex", gap: "1rem" }}>
      <div>
        <h2>My Todos</h2>
        <ul>
          {todos.map((todo, i) => (
            <li key={i} style={{ textDecoration: todo.done ? "line-through" : "none" }}>
              {todo.text}
            </li>
          ))}
        </ul>
      </div>
      <CopilotChat
        labels={{
          welcomeMessageText: "I can help manage your todos. Try 'Add a task to buy groceries'.",
        }}
      />
    </div>
  );
}
```

When you tell the agent "Add a task to buy groceries", it updates the shared state and your todo list renders the new item immediately.

### Common Copilot Issues
- Route: `/built-in-agent/troubleshooting/common-issues`
- Source: `docs/content/docs/integrations/built-in-agent/troubleshooting/common-issues.mdx`
- Description: Common issues you may encounter when using Copilots.

Welcome to the CopilotKit Troubleshooting Guide! Here, you can find answers to common issues

    Have an issue not listed here? Open a ticket on [GitHub](https://github.com/CopilotKit/CopilotKit/issues) or reach out on [Discord](https://discord.com/invite/6dffbvGU3D)
    and we'll be happy to help.

    We also highly encourage any open source contributors that want to add their own troubleshooting issues to [Github as a pull request](https://github.com/CopilotKit/CopilotKit/blob/main/CONTRIBUTING.md).

## I am getting network errors / API not found error

If you're encountering network or API errors, here's how to troubleshoot:

        Verify your endpoint configuration in your CopilotKit setup:

```tsx
        <CopilotKit
          runtimeUrl="/api/copilotkit"
        >
          {/* Your app */}
        </CopilotKit>
```

        or, if using CopilotCloud
```tsx
        <CopilotKit
            publicApiKey="<your-copilot-cloud-public-api-key>"
        >
            {/* Your app */}
        </CopilotKit>
```

        Common issues:
        - Missing leading slash in endpoint path
        - Incorrect path relative to your app's base URL, or, if using absolute paths, incorrect full URL
        - Typos in the endpoint path
        - If using CopilotCloud, make sure to omit the `runtimeUrl` property and provide a valid API key
        If you're running locally and getting connection errors, try using `127.0.0.1` instead of `localhost`:

```bash
        # If this doesn't work:
        http://localhost:3000/api/copilotkit

        # Try this instead:
        http://127.0.0.1:3000/api/copilotkit
```

        This is often due to local DNS resolution issues in `/etc/hosts` or network configuration.
        Make sure your backend server is:
        - Running on the expected port
        - Accessible from your frontend
        - Not blocked by CORS or firewalls

        Check the [quickstart](/quickstart) to see how to set it up

## I am getting "CopilotKit's Remote Endpoint" not found error

If you're getting a "CopilotKit's Remote Endpoint not found" error, it usually means the server serving `/info` endpoint isn't accessible. Here's how to fix it:

        Refer to [Remote Python Endpoint](/guides/backend-actions/remote-backend-endpoint) to see how to set it up
        The `/info` endpoint should return agent or action information. Test it directly:

```bash
        curl -v -d '{}' http://localhost:8000/copilotkit/info
```
        The response looks something like this:
```bash
        * Host localhost:8000 was resolved.
        * IPv6: ::1
        * IPv4: 127.0.0.1
        *   Trying [::1]:8000...
        * connect to ::1 port 8000 from ::1 port 55049 failed: Connection refused
        *   Trying 127.0.0.1:8000...
        * Connected to localhost (127.0.0.1) port 8000
        > POST /copilotkit/info HTTP/1.1
        > Host: localhost:8000
        > User-Agent: curl/8.7.1
        > Accept: */*
        > Content-Length: 2
        > Content-Type: application/x-www-form-urlencoded
        >
        * upload completely sent off: 2 bytes
        < HTTP/1.1 200 OK
        < date: Thu, 16 Jan 2025 17:45:05 GMT
        < server: uvicorn
        < content-length: 214
        < content-type: application/json
        <
        * Connection #0 to host localhost left intact
        {"actions":[],"agents":[{"name":"my_agent","description":"A helpful agent.","type":"langgraph"},],"sdkVersion":"0.1.32"}%
```

        As you can see, it's a JSON response with your registered agents and actions, as well as the `200 OK` HTTP response status.
        If you see a different response, check your FastAPI logs for errors.

## Connection issues with tunnel creation

If you notice the tunnel creation process spinning indefinitely, your router or ISP might be blocking the connection to CopilotKit's tunnel service.

        To verify connectivity to the tunnel service, try these commands:

```bash
        ping tunnels.devcopilotkit.com
        curl -I https://tunnels.devcopilotkit.com
        telnet tunnels.devcopilotkit.com 443
```

        If these fail, your router's security features or ISP might be blocking the connection. Common solutions:
        - Check router security settings
        - Contact your ISP to verify if they're blocking the connection
        - Try a different network to confirm the issue

### Error Debugging & Observability
- Route: `/built-in-agent/troubleshooting/error-debugging`
- Source: `docs/content/docs/integrations/built-in-agent/troubleshooting/error-debugging.mdx`
- Description: Learn how to debug errors in CopilotKit with dev console and set up error observability for monitoring services.

# How to Debug Errors

CopilotKit provides visual error display for local development and debugging. This feature is completely free and requires no API keys.

## Quick Setup

```tsx
import { CopilotKit } from "@copilotkit/react-core";

export default function App() {
  return (
    <CopilotKit
      runtimeUrl="<your-runtime-url>"
      showDevConsole={true} // [!code highlight]
    >
      {/* Your app */}
    </CopilotKit>
  );
}
```

  Avoid showing the dev console in production as it exposes internal error details to end users.

## When to Use Development Debugging

- **Local development** - See errors immediately in your UI
- **Quick debugging** - No setup required, works out of the box
- **Testing** - Verify error handling during development

## Troubleshooting

### Development Debugging Issues

- **Dev console not showing:**
  - Confirm `showDevConsole={true}`
  - Check for JavaScript errors in the browser console
  - Ensure no CSS is hiding the error banner

### Migrate to 1.10.X
- Route: `/built-in-agent/troubleshooting/migrate-to-1.10.X`
- Source: `docs/content/docs/integrations/built-in-agent/troubleshooting/migrate-to-1.10.X.mdx`
- Description: Migration guide for CopilotKit 1.10.X

## Overview

CopilotKit 1.10.X introduces a new headless UI system and simplified message formats. Most existing code will continue to work, but you may need to update custom message handling.

**What you need to know:**
- Message format has changed from classes to plain objects
- New headless UI hook available for advanced use cases
- Backwards compatibility maintained for most features

## Key Improvements & Changes

### Enhanced Message Format

Messages now use plain objects instead of classes for better performance and simpler handling.

#### Before
```tsx
const message = new TextMessage({
  role: MessageRole.Assistant,
  content: "Hello, how are you?",
})
```

#### After
```tsx
const message = { 
  role: "assistant", 
  content: "Hello, how are you?" 
}
```

### Simplified Message Type Checking

Message type checking has been streamlined for better developer experience. Instead of using the previous
`isTextMessage` or adjacent methods, you can now check the `role` property of the message.

#### Before
```tsx
if (message.isTextMessage()) {
  if (message.role === "assistant") {
    console.log(message.content)
  }
  if (message.role === "user") {
    console.log(message.content)
  }
}

if (message.isImageMessage()) {
  console.log(message.image)
}

if (message.isActionExecutionMessage()) {
  console.log(message.toolCalls)
}

// etc...
```

#### After
```tsx
if (message.role === "assistant") {
  console.log(
    message.content,
    message.toolCalls,
    message.image,
  )
}

if (message.role === "user") {
  console.log(
    message.content,
    message.image,
  )
}
```

### Custom Assistant Messages
Previously, you had to use the `subComponent` property to render custom assistant messages. Now you can use the `generativeUI` property instead.

**Important!** Both will continue to work.

#### Before

```tsx
import { AssistantMessageProps } from "@copilotkit/react-core/v2";

export const AssistantMessage = (props: AssistantMessageProps) => {
  const { message, subComponent } = props;

  return (
    <div style={{ marginBottom: "0.5rem" }}>{subComponent}</div>
  );
};
```

#### After

```tsx
import { AssistantMessageProps } from "@copilotkit/react-core/v2";

export const AssistantMessage = (props: AssistantMessageProps) => {
  const { message } = props;

  return (
    <div style={{ marginBottom: "0.5rem" }}>{message.generativeUI}</div>
  );
};
```

#### Backwards Compatibility

- Custom sub-components remain fully supported
- Both `subComponent` (legacy) and `generativeUI` (new) properties work
- Existing `useCopilotChat` code continues to function

## New Features

### Advanced Headless UI Hook

New `useCopilotChatHeadless_c` hook provides complete control over chat UI:

**Features:**
- Complete control over chat UI rendering
- Built-in generative UI support
- Advanced suggestions management
- Interrupt handling for human-in-the-loop workflows

An example of how you might use the new Headless UI hook:

```tsx
const { messages, suggestions, interrupt } = useCopilotChatHeadless_c();

return (
  <div>
    {suggestions.map((suggestion) => (
      <div key={suggestion.id}>{suggestion.title}</div>
    ))}

    {interrupt}

    {messages.map((message) => {
      switch (message.role) {
        case "assistant":
          if (message.generativeUI) return message.generativeUI
          return <div key={message.id}>{message.content}</div>
        case "user":
          return <div key={message.id}>{message.content}</div>
      }
    })}
  </div>
)
```

[Read more about the new headless UI hook and get started](/premium/headless-ui).

## What about `useCopilotChat`?

With the introduction of the new headless UI hook, we are starting the deprecation of `useCopilotChat`. While it will remain supported for several months in maintenance mode, all new headless UI features will be added to `useCopilotChatHeadless_c`.

We recommend migrating to the new hook for new projects. However, please feel free to continue using `useCopilotChat` until you are ready to migrate.

### When to Migrate

**Continue using `useCopilotChat` if:**
- Your current implementation works well
- You don't need advanced headless features
- You prefer gradual migration

**Migrate to `useCopilotChatHeadless_c` if:**
- Starting a new project
- Building new headless UI implementations
- Need generative UI capabilities
- Want access to advanced suggestions and interrupts
- Building fully custom chat experiences

### Migrate to 1.8.2
- Route: `/built-in-agent/troubleshooting/migrate-to-1.8.2`
- Source: `docs/content/docs/integrations/built-in-agent/troubleshooting/migrate-to-1.8.2.mdx`
- Description: Migration guide for CopilotKit 1.8.2

## What's changed?

### New Look and Feel

CopilotKit 1.8.2 introduces a new default look and feel. This includes new use of theming variables, new components, and generally a fresh look.

**Click the button in the bottom right to see the new look and feel in action!**

### Thumbs Up/Down Handlers

The chat components now have `onThumbsUp` and `onThumbsDown` handlers. Specifying these will add icons to each message
on hover allowing the user to provide feedback.

```tsx
<CopilotChat 
  onThumbsUp={(message) => console.log(message)} 
  onThumbsDown={(message) => console.log(message)}     
/>
```

This was previously achievable in our framework, but we're making it first class now! You can use this to help fine-tune your model through CopilotKit
or just generally track user feedback.

### ResponseButton prop removed

The `ResponseButton` prop has been removed. This was a prop that was used to customize the button that appears after a response was generated
in the chat.

In its place, we now place buttons below each message for:
- Thumbs up
- Thumbs down
- Copy
- Regenerate

The behvior, icons and styling for each of these buttons can be customized. Checkout our [look and feel guides](/custom-look-and-feel) for more details.

### Out-of-the-box dark mode support

CopilotKit now has out-of-the-box dark mode support. This is controlled by the `.dark` class (Tailwind) as well as the
`color-scheme` CSS selector.

If you would like to make a custom theme, you can do so by checking out the [custom look and feel](/custom-look-and-feel) guides.

### Migrate to V2
- Route: `/built-in-agent/troubleshooting/migrate-to-v2`
- Source: `docs/content/docs/integrations/built-in-agent/troubleshooting/migrate-to-v2.mdx`
- Description: Migration guide for upgrading to CopilotKit V2 frontend packages

## Overview

CopilotKit V2 consolidates the frontend into a single package. Both hooks and UI components are now exported from `@copilotkit/react-core/v2`. Your backend does not need any changes.

**What's changing:**

| Before | After |
|--------|-------|
| `@copilotkit/react-core` | `@copilotkit/react-core/v2` |
| `@copilotkit/react-ui` | `@copilotkit/react-core/v2` |
| `@copilotkit/react-ui/styles.css` | `@copilotkit/react-core/v2/styles.css` |

**What's NOT changing:**
- Backend packages (`@copilotkit/runtime`, etc.) — no changes needed
- Your `CopilotRuntime` configuration — stays the same
- Agent definitions and backend setup — stays the same

## Migration Steps

### Update `@copilotkit/react-core` imports

Replace imports from `@copilotkit/react-core` with `@copilotkit/react-core/v2`.

#### Before
```tsx
import { CopilotKit } from "@copilotkit/react-core";
import { useCopilotReadable, useCopilotAction } from "@copilotkit/react-core";
```

#### After
```tsx
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import { useAgent } from "@copilotkit/react-core/v2";
```

### Replace `@copilotkit/react-ui` imports

UI components like `CopilotChat`, `CopilotSidebar`, and `CopilotPopup` are now exported from `@copilotkit/react-core/v2`.

#### Before
```tsx
import { CopilotPopup } from "@copilotkit/react-ui";
import { CopilotSidebar } from "@copilotkit/react-ui";
import { CopilotChat } from "@copilotkit/react-ui";
```

#### After
```tsx
import { CopilotPopup } from "@copilotkit/react-core/v2";
import { CopilotSidebar } from "@copilotkit/react-core/v2";
import { CopilotChat } from "@copilotkit/react-core/v2";
```

### Update your styles import

#### Before
```tsx
import "@copilotkit/react-ui/styles.css";
```

#### After
```tsx
import "@copilotkit/react-core/v2/styles.css";
```

### Upgrade `@ag-ui/client` (if using directly)

If you import from `@ag-ui/client` directly, upgrade to the latest version:

```bash
npm install @ag-ui/client@latest
```

Note: If you only use CopilotKit's React packages, `@ag-ui/client` types are already re-exported from `@copilotkit/react-core/v2` and you don't need a separate install.

## Full Example

### Before

```tsx
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotPopup } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";

export function App() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit">
      <YourApp />
      <CopilotPopup />
    </CopilotKit>
  );
}
```

### After

```tsx
import { CopilotKitProvider, CopilotPopup } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";

export function App() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit">
      <YourApp />
      <CopilotPopup />
    </CopilotKitProvider>
  );
}
```

### Next Steps
- Route: `/built-in-agent/tutorials/ai-powered-textarea/next-steps`
- Source: `docs/content/docs/integrations/built-in-agent/tutorials/ai-powered-textarea/next-steps.mdx`

This is the end of the tutorial. You can now start building your own copilot-powered apps!

## Source code

You can find the source code and interactive sandboxes here:

- **Start app:** [GitHub](https://github.com/CopilotKit/example-textarea/tree/base-start-here) | [Stackblitz Sandbox](https://stackblitz.com/github/copilotkit/example-textarea/tree/base-start-here?file=lib%2Fhooks%2Fuse-tasks.tsx)
- **Final app:** [GitHub](https://github.com/CopilotKit/example-textarea/tree/final) | [Stackblitz Sandbox](https://stackblitz.com/github/copilotkit/example-textarea/tree/final?file=lib%2Fhooks%2Fuse-tasks.tsxd)

## What's next?

For next steps, here are some ideas:

- Add a chat element to your copilot using the [``](/reference/v1/components/chat/CopilotPopup) component.
- Add actions to your copilot using the [`useCopilotAction`](/reference/v1/hooks/useCopilotAction) hook.
- Follow the [Todos App Copilot tutorial](/built-in-agent/tutorials/ai-todo-app) to learn more about CopilotKit.

We have more tutorials coming soon.

## Need help?

If you have any questions, feel free to reach out to us on [Discord](https://discord.gg/6dffbvGU3D).

### Overview
- Route: `/built-in-agent/tutorials/ai-powered-textarea/overview`
- Source: `docs/content/docs/integrations/built-in-agent/tutorials/ai-powered-textarea/overview.mdx`

## What you'll learn

In this tutorial, you will take a simple email application and add AI-powered autocompletion to it. The app is a simple email client, with a regular textarea used to compose an email. You're going to add CopilotKit to the app, so that the textarea provides relevant autocompletions as you type. The textarea will be aware of the full email history.

You will learn:

- 💡 How to use `useCopilotReadable` to allow your copilot to read the state of your app
- 💡 How to use the `` component to get instant context-aware autocompletions in your app
- 💡 How to use the Copilot Textarea Action Popup to generate text or adjust existing text in the textarea

## Try it out!

You can try out an interactive example of the end result below:

    >

In the next step, we'll start building our copilot.

### Step 1: Checkout the repo
- Route: `/built-in-agent/tutorials/ai-powered-textarea/step-1-checkout-repo`
- Source: `docs/content/docs/integrations/built-in-agent/tutorials/ai-powered-textarea/step-1-checkout-repo.mdx`

### Checkout the repository
We'll begin by checking out the base code of the todo list app. We'll start from the `base-start-here` branch.

```shell
git clone -b base-start-here https://github.com/CopilotKit/example-textarea.git
cd example-textarea
```
### Install dependencies

To install the dependencies, run the following:

```shell
npm install
```
### Start the project

Now, you are ready to start the project by running:

```shell
npm run dev
```

You should be able to go to [http://localhost:3000](http://localhost:3000) and see the todo list app. Feel free to play around with the app to get a feel for it.

Next, let's start adding some AI copilot superpowers to this app.

### Step 2: Setup CopilotKit
- Route: `/built-in-agent/tutorials/ai-powered-textarea/step-2-setup-copilotkit`
- Source: `docs/content/docs/integrations/built-in-agent/tutorials/ai-powered-textarea/step-2-setup-copilotkit.mdx`

Now that we have our todo list app running, we're ready to integrate CopilotKit. For this tutorial, we will install the following dependencies:

- `@copilotkit/react-core`: The core library for CopilotKit, which contains the CopilotKit provider and useful hooks.
- `@copilotkit/react-textarea`: The textarea component for CopilotKit, which enables you to get instant context-aware autocompletions in your app.

## Install Dependencies

To install the CopilotKit dependencies, run the following:

```npm
npm install @copilotkit/react-core @copilotkit/react-textarea
```

## Setup CopilotKit

In order to use CopilotKit, we'll need to configure the CopilotKit provider.

The [``](/reference/v1/components/CopilotKit) provider must wrap the Copilot-aware parts of your application.
For most use-cases, it's appropriate to wrap the `CopilotKit` provider around the entire app, e.g. in your `layout.tsx`

  Note that you can add the `` provider anywhere in your application. In fact, you can have multiple `` providers per app if you want independent copilots.

```tsx title="layout.tsx" showLineNumbers
import "./globals.css";

import { ReactNode } from "react";
import { CopilotKit } from "@copilotkit/react-core"; // [!code highlight]

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
      <html lang="en">
        <body>
          {/* Use the public api key you got from Copilot Cloud  */}
          {/* [!code highlight:3] */}
          <CopilotKit publicApiKey="<your-copilot-cloud-public-api-key>">
            {children}
          </CopilotKit>
        </body>
      </html>
    );
}
```

### Set up Copilot Runtime Endpoint

  If you are planning to use a single LangGraph agent in agent-lock mode as your agentic backend, your LLM adapter will only be used for peripherals such as suggestions, etc.

If you are not sure yet, simply ignore this note.

            The LangChain adapter shown here is using OpenAI, but can be used with any LLM!

            Be aware that the empty adapter only works in combination with CoAgents in agent lock mode!

            In addition, bare in mind that `useCopilotChatSuggestions`, `CopilotTextarea` and `CopilotTask` will not work, as these require an LLM.

        ### Install provider package

```npm
        npm install {{packageName}}
```

        ### Add your API key

        Next, add your API key to your `.env` file in the root of your project (unless you prefer to provide it directly to the client):

```plaintext title=".env"
        {{envVarName}}=your_api_key_here
```

        ### Add your API key

        Next, add your API key to your `.env` file in the root of your project (unless you prefer to provide it directly to the client):

```plaintext title=".env"
        {{envVarSecret}}=your_secret_key_here
        {{envVarAccess}}=your_access_key_here
        {{envVarToken}}=your_session_token_here
```

            Please note that the code below uses GPT-4o, which requires a paid OpenAI API key. **If you are using a free OpenAI API key**, change the model to a different option such as `gpt-3.5-turbo`.

    ### Setup the Runtime Endpoint

        ### Serverless Function Timeouts

        When deploying to serverless platforms (Vercel, AWS Lambda, etc.), be aware that default function timeouts may be too short for CopilotKit's streaming responses:

        - Vercel defaults: 10s (Hobby), 15s (Pro)
        - AWS Lambda default: 3s

        **Solution options:**
        1. Increase function timeout:
```json
            // vercel.json
            {
              "functions": {
                "api/copilotkit/**/*": {
                  "maxDuration": 60
                }
              }
            }
```
        2. Use [Copilot Cloud](https://cloud.copilotkit.ai/) to avoid timeout issues entirely

        { value: 'Next.js App Router', icon:  },
        { value: 'Next.js Pages Router', icon:  },
        { value: 'Node.js Express', icon:  },
        { value: 'Node.js HTTP', icon:  },
        { value: 'NestJS', icon:  }
    ]}>

            Create a new route to handle the `/api/copilotkit` endpoint.

```ts title="app/api/copilotkit/route.ts"
            import {
              CopilotRuntime,
              {{adapterImport}},
              copilotRuntimeNextJSAppRouterEndpoint,
            } from '@copilotkit/runtime';
            {{extraImports}}
            import { NextRequest } from 'next/server';

            {{clientSetup}}
            {{adapterSetup}}
            const runtime = new CopilotRuntime();

            export const POST = async (req: NextRequest) => {
              const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
                runtime,
                serviceAdapter,
                endpoint: '/api/copilotkit',
              });

              return handleRequest(req);
            };
```

            Your Copilot Runtime endpoint should be available at `http://localhost:3000/api/copilotkit`.

            Create a new route to handle the `/api/copilotkit` endpoint:

```ts title="pages/api/copilotkit.ts"
            import { NextApiRequest, NextApiResponse } from 'next';
            import {
              CopilotRuntime,
              {{adapterImport}},
              copilotRuntimeNextJSPagesRouterEndpoint,
            } from '@copilotkit/runtime';
            {{extraImports}}

            {{clientSetup}}
            {{adapterSetup}}

            const handler = async (req: NextApiRequest, res: NextApiResponse) => {
              const runtime = new CopilotRuntime();

              const handleRequest = copilotRuntimeNextJSPagesRouterEndpoint({
                endpoint: '/api/copilotkit',
                runtime,
                serviceAdapter,
              });

              return await handleRequest(req, res);
            };

            export default handler;
```

            Your Copilot Runtime endpoint should be available at `http://localhost:3000/api/copilotkit`.

            Create a new Express.js app and set up the Copilot Runtime handler:

```ts title="server.ts"
            import express from 'express';
            import {
              CopilotRuntime,
              {{adapterImport}},
              copilotRuntimeNodeHttpEndpoint,
            } from '@copilotkit/runtime';
            {{extraImports}}

            const app = express();
            {{clientSetup}}
            {{adapterSetup}}

            app.use('/copilotkit', (req, res, next) => {
              (async () => {
                const runtime = new CopilotRuntime();
                const handler = copilotRuntimeNodeHttpEndpoint({
                  endpoint: '/copilotkit',
                  runtime,
                  serviceAdapter,
                });

                return handler(req, res);
              })().catch(next);
            });

            app.listen(4000, () => {
              console.log('Listening at http://localhost:4000/copilotkit');
            });
```

            Your Copilot Runtime endpoint should be available at `http://localhost:4000/copilotkit`.

                Remember to point your `runtimeUrl` to the correct endpoint in your client-side code, e.g. `http://localhost:PORT/copilotkit`.

            Set up a simple Node.js HTTP server and use the Copilot Runtime to handle requests:

```ts title="server.ts"
            import { createServer } from 'node:http';
            import {
              CopilotRuntime,
              {{adapterImport}},
              copilotRuntimeNodeHttpEndpoint,
            } from '@copilotkit/runtime';
            {{extraImports}}

            {{clientSetup}}
            {{adapterSetup}}

            const server = createServer((req, res) => {
              const runtime = new CopilotRuntime();
              const handler = copilotRuntimeNodeHttpEndpoint({
                endpoint: '/copilotkit',
                runtime,
                serviceAdapter,
              });

              return handler(req, res);
            });

            server.listen(4000, () => {
              console.log('Listening at http://localhost:4000/copilotkit');
            });
```

            Your Copilot Runtime endpoint should be available at `http://localhost:4000/copilotkit`.

                Remember to point your `runtimeUrl` to the correct endpoint in your client-side code, e.g. `http://localhost:PORT/copilotkit`.

            Set up a controller in NestJS to handle the Copilot Runtime endpoint:

```ts title="copilotkit.controller.ts"
            import { All, Controller, Req, Res } from '@nestjs/common';
            import { CopilotRuntime, copilotRuntimeNestEndpoint, {{adapterImport}} } from '@copilotkit/runtime';
            import { Request, Response } from 'express';

            @Controller()
            export class CopilotKitController {
              @All('/copilotkit')
              copilotkit(@Req() req: Request, @Res() res: Response) {
                {{adapterSetup}}
                const runtime = new CopilotRuntime();

                const handler = copilotRuntimeNestEndpoint({
                  runtime,
                  serviceAdapter,
                  endpoint: '/copilotkit',
                });
                return handler(req, res);
              }
            }
```

            Your Copilot Runtime endpoint should be available at `http://localhost:3000/copilotkit`.

                Remember to point your `runtimeUrl` to the correct endpoint in your client-side code, e.g. `http://localhost:PORT/copilotkit`.

### Configure the CopilotKit Provider

```tsx title="app/page.tsx" showLineNumbers {5,10,14}
"use client";

import { EmailThread } from "@/components/EmailThread";
import { EmailsProvider } from "@/lib/hooks/use-emails";
import { CopilotKit } from "@copilotkit/react-core/v2"; // [!code highlight]
import "@copilotkit/react-textarea/styles.css"; // [!code highlight]

export default function Home() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit">
      {" "}
      // [!code highlight]
      <EmailsProvider>
        <EmailThread />
      </EmailsProvider>
    {/* [!code highlight:1] */}
    </CopilotKit>
  );
}
```

Let's break this down:

- First, we imported the `CopilotKit` provider from `@copilotkit/react-core`.
- Then, we wrapped the page with the `` provider.
- We imported the built-in styles from `@copilotkit/react-textarea`.

In the next step, we'll implement the AI-powered textarea as a replacement for our existing input component.

### Step 4: Copilot Textarea
- Route: `/built-in-agent/tutorials/ai-powered-textarea/step-3-copilot-textarea`
- Source: `docs/content/docs/integrations/built-in-agent/tutorials/ai-powered-textarea/step-3-copilot-textarea.mdx`

Currently, our app has a simple textarea for replying to emails. Let's replace this with an AI-powered textarea so that we can benefit from our helpful AI assistant.

## The `` Component

Head over to the [`/components/Reply.tsx`](https://github.com/CopilotKit/example-textarea/blob/base-start-here/components/Reply.tsx) file.

At a glance, you can see that this component uses `useState` to hold the current input value and provide it to the textarea. We also use the `onChange` prop of the textarea to update the state.

## Implementing ``

The `` component was designed to be a drop-in replacement for the `` component. Let's implement it!

```tsx title="components/Reply.tsx"
// ... the rest of the file

import { CopilotTextarea } from "@copilotkit/react-textarea"; // [!code highlight]

export function Reply() {
  // ...
  return (
    <div className="mt-4 pt-4 space-y-2 bg-background p-4 rounded-md border">
      <CopilotTextarea // [!code highlight]
        className="min-h-40 border h-40 p-2 overflow-hidden"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Write your reply..."
        // [!code highlight:4]
        autosuggestionsConfig={{
          textareaPurpose: `Assist me in replying to this email thread. Remember all important details.`,
          chatApiConfigs: {}
        }}
      />
      <Button disabled={!input} onClick={handleReply}>
        Reply
      </Button>
    </div>
  );
}
```

We import the `` component and use it in place of the `` component. There are also some optional style changes made here.

We can provide more specific instructions for this particular textarea via the `autoSuggestionsConfig.textareaPurpose` property.

## Try it out!

Now, go back to the app and type anything in the textarea. You will see that the AI assistant provides suggestions as you type. How cool is that?

## The `CMD + K`/`CTRL + K` Shortcut

While focused on the textarea, you can use the `CMD + K` (macOS) or `CTRL + K` (Windows) shortcut to open the action popup. Here, you can give the copilot specific instructions, such as:

- `Rephrase the text to be more formal`
- `Make the reply shorter`
- `Tell John that I'm happy to help`

We have implemented the `` component, but there is an issue - the copilot assistant is not aware of the email thread. In the next step, we'll make CopilotKit aware of our email history.

### Step 3: Copilot Readable State
- Route: `/built-in-agent/tutorials/ai-powered-textarea/step-4-copilot-readable-state`
- Source: `docs/content/docs/integrations/built-in-agent/tutorials/ai-powered-textarea/step-4-copilot-readable-state.mdx`

At this point, we have set up our CopilotKit provider and ``, and we already benefit from a great AI assistant. However, there is one last problem - the copilot assistant is not aware of the email thread. Let's fix that.

## Our App's State

Let's quickly review how our app's state works. Open up the [`lib/hooks/use-emails.tsx`](https://github.com/CopilotKit/example-textarea/blob/base-start-here/lib/hooks/use-emails.tsx) file.

At a glance, we can see that the file exposes a provider (`EmailsProvider`) which holds our `emails`. This is the context we need to provide to our copilot to get AI autocompletions.

## The `useCopilotReadable` hook

Our goal is to make our copilot aware of this state, so that it can provide more accurate and helpful responses. We can easily achieve this by using the [`useCopilotReadable`](/reference/v1/hooks/useCopilotReadable) hook.

```tsx title="libs/hooks/use-emails.tsx"
// ... the rest of the file

import { useCopilotReadable } from "@copilotkit/react-core/v2"; // [!code highlight]

export const EmailsProvider = ({ children }: { children: ReactNode }) => {
  const [emails, setEmails] = useState<Email[]>(emailHistory);

  // [!code highlight:4]
  useCopilotReadable({
    description: "The history of this email thread",
    value: emails
  });

  // ... the rest of the file
}
```

In this example, we use the `useCopilotReadable` hook to provide the copilot with the state of our email thread.

- For the `description` property, we provide a concise description that tells the copilot what this piece of readable data means.
- For the `value` property, we pass the entire state as a JSON string.

In the next step, we'll set up our AI-powered textarea, which will use this readable state to provide accurate and helpful responses.

## Try it out!

Now, go back to the app and start typing things related to the email thread. Some ideas:

- `"Thanks Jo..."` (the assistant will complete John's name)
- `"I'm glad Spac..."` (the assistant will complete the company's name to SpaceY)
- `"I'm glad they liked my..."` (the assistant will add context)

Your textarea is now fully aware of the email thread, and therefore it provides helpful, relevant autocompletions. 🚀

### Next Steps
- Route: `/built-in-agent/tutorials/ai-todo-app/next-steps`
- Source: `docs/content/docs/integrations/built-in-agent/tutorials/ai-todo-app/next-steps.mdx`

This is the end of the tutorial. You can now start building your own copilot-powered apps!

## Source code

You can find the source code and interactive sandboxes here:

- **Start app:** [GitHub](https://github.com/CopilotKit/example-todos-app/tree/base-start-here) | [Stackblitz Sandbox](https://stackblitz.com/github/copilotkit/example-todos-app/tree/base-start-here?file=lib%2Fhooks%2Fuse-tasks.tsx)
- **Final app:** [GitHub](https://github.com/CopilotKit/example-todos-app/tree/final) | [Stackblitz Sandbox](https://stackblitz.com/github/copilotkit/example-todos-app/tree/final?file=lib%2Fhooks%2Fuse-tasks.tsxd)

## What's next?

For next steps, here are some ideas:

- Add suggestions to your copilot, using the [`useCopilotChatSuggestions`](/reference/v1/hooks/useCopilotChatSuggestions) hook.
- Add an initial assistant message to your chat window (for more info, check the documentation for [``](/reference/v1/components/chat/CopilotPopup)).
- Dive deeper into the useful [`useCopilotChat`](/reference/v1/hooks/useCopilotChat) hook, which enables you to set the system message, append messages, and more.
- Implement autocompletion using the [``](/reference/v1/components/CopilotTextarea) component.
- Follow the [Textarea Autocomplete tutorial](/built-in-agent/tutorials/ai-powered-textarea) to learn more about CopilotKit.

We have more tutorials coming soon.

## Need help?

If you have any questions, feel free to reach out to us on [Discord](https://discord.gg/6dffbvGU3D).

### Overview
- Route: `/built-in-agent/tutorials/ai-todo-app/overview`
- Source: `docs/content/docs/integrations/built-in-agent/tutorials/ai-todo-app/overview.mdx`

# AI Todo List Copilot Tutorial

## What you'll learn

In this tutorial, you will take a simple todo list app and supercharge it with a copilot. You will learn:

- 💡 How to embed an in-app copilot with a chat UI
- 💡 How to use `useCopilotReadable` to allow your copilot to read the state of your app
- 💡 How to use `useFrontendTool` to allow your copilot to execute tools

## Try it out!

You can try out an interactive example of the end result below:

    >

In the next step, we'll start building our copilot.

### Step 1: Checkout the repo
- Route: `/built-in-agent/tutorials/ai-todo-app/step-1-checkout-repo`
- Source: `docs/content/docs/integrations/built-in-agent/tutorials/ai-todo-app/step-1-checkout-repo.mdx`

### Checkout the repository
We'll begin by checking out the base code of the todo list app. We'll start from the `base-start-here` branch.

```shell
git clone -b base-start-here https://github.com/CopilotKit/example-todos-app.git
cd example-todos-app
```
### Install dependencies

To install the dependencies, run the following:

```shell
npm install
```
### Start the project

Now, you are ready to start the project by running:

```shell
npm run dev
```

You should be able to go to [http://localhost:3000](http://localhost:3000) and see the todo list app. Feel free to play around with the app to get a feel for it.

Next, let's start adding some AI copilot superpowers to this app.

### Step 2: Setup CopilotKit
- Route: `/built-in-agent/tutorials/ai-todo-app/step-2-setup-copilotkit`
- Source: `docs/content/docs/integrations/built-in-agent/tutorials/ai-todo-app/step-2-setup-copilotkit.mdx`

Now that we have our todo list app running, we're ready to integrate CopilotKit. For this tutorial, we will install the following dependencies:

- `@copilotkit/react-core`: The core library for CopilotKit, which contains the CopilotKit provider and useful hooks.
- `@copilotkit/react-ui`: The UI library for CopilotKit, which contains the CopilotKit UI components such as the sidebar, chat popup, textarea and more.

## Install Dependencies

To install the CopilotKit dependencies, run the following:

```npm
npm install @copilotkit/react-core @copilotkit/react-ui
```

## Setup CopilotKit

In order to use CopilotKit, we'll need to configure the `CopilotKit` provider.

The [``](/reference/v1/components/CopilotKit) provider must wrap the Copilot-aware parts of your application.
For most use-cases, it's appropriate to wrap the `CopilotKit` provider around the entire app, e.g. in your `layout.tsx`

  Note that you can add the `` provider anywhere in your application. In fact, you can have multiple `` providers per app if you want independent copilots.

```tsx title="layout.tsx" showLineNumbers
import "./globals.css";

import { ReactNode } from "react";
import { CopilotKit } from "@copilotkit/react-core"; // [!code highlight]

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
      <html lang="en">
        <body>
          {/* Use the public api key you got from Copilot Cloud  */}
          {/* [!code highlight:3] */}
          <CopilotKit publicApiKey="<your-copilot-cloud-public-api-key>">
            {children}
          </CopilotKit>
        </body>
      </html>
    );
}
```

### Set up Copilot Runtime Endpoint

  If you are planning to use a single LangGraph agent in agent-lock mode as your agentic backend, your LLM adapter will only be used for peripherals such as suggestions, etc.

If you are not sure yet, simply ignore this note.

            The LangChain adapter shown here is using OpenAI, but can be used with any LLM!

            Be aware that the empty adapter only works in combination with CoAgents in agent lock mode!

            In addition, bare in mind that `useCopilotChatSuggestions`, `CopilotTextarea` and `CopilotTask` will not work, as these require an LLM.

        ### Install provider package

```npm
        npm install {{packageName}}
```

        ### Add your API key

        Next, add your API key to your `.env` file in the root of your project (unless you prefer to provide it directly to the client):

```plaintext title=".env"
        {{envVarName}}=your_api_key_here
```

        ### Add your API key

        Next, add your API key to your `.env` file in the root of your project (unless you prefer to provide it directly to the client):

```plaintext title=".env"
        {{envVarSecret}}=your_secret_key_here
        {{envVarAccess}}=your_access_key_here
        {{envVarToken}}=your_session_token_here
```

            Please note that the code below uses GPT-4o, which requires a paid OpenAI API key. **If you are using a free OpenAI API key**, change the model to a different option such as `gpt-3.5-turbo`.

    ### Setup the Runtime Endpoint

        ### Serverless Function Timeouts

        When deploying to serverless platforms (Vercel, AWS Lambda, etc.), be aware that default function timeouts may be too short for CopilotKit's streaming responses:

        - Vercel defaults: 10s (Hobby), 15s (Pro)
        - AWS Lambda default: 3s

        **Solution options:**
        1. Increase function timeout:
```json
            // vercel.json
            {
              "functions": {
                "api/copilotkit/**/*": {
                  "maxDuration": 60
                }
              }
            }
```
        2. Use [Copilot Cloud](https://cloud.copilotkit.ai/) to avoid timeout issues entirely

        { value: 'Next.js App Router', icon:  },
        { value: 'Next.js Pages Router', icon:  },
        { value: 'Node.js Express', icon:  },
        { value: 'Node.js HTTP', icon:  },
        { value: 'NestJS', icon:  }
    ]}>

            Create a new route to handle the `/api/copilotkit` endpoint.

```ts title="app/api/copilotkit/route.ts"
            import {
              CopilotRuntime,
              {{adapterImport}},
              copilotRuntimeNextJSAppRouterEndpoint,
            } from '@copilotkit/runtime';
            {{extraImports}}
            import { NextRequest } from 'next/server';

            {{clientSetup}}
            {{adapterSetup}}
            const runtime = new CopilotRuntime();

            export const POST = async (req: NextRequest) => {
              const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
                runtime,
                serviceAdapter,
                endpoint: '/api/copilotkit',
              });

              return handleRequest(req);
            };
```

            Your Copilot Runtime endpoint should be available at `http://localhost:3000/api/copilotkit`.

            Create a new route to handle the `/api/copilotkit` endpoint:

```ts title="pages/api/copilotkit.ts"
            import { NextApiRequest, NextApiResponse } from 'next';
            import {
              CopilotRuntime,
              {{adapterImport}},
              copilotRuntimeNextJSPagesRouterEndpoint,
            } from '@copilotkit/runtime';
            {{extraImports}}

            {{clientSetup}}
            {{adapterSetup}}

            const handler = async (req: NextApiRequest, res: NextApiResponse) => {
              const runtime = new CopilotRuntime();

              const handleRequest = copilotRuntimeNextJSPagesRouterEndpoint({
                endpoint: '/api/copilotkit',
                runtime,
                serviceAdapter,
              });

              return await handleRequest(req, res);
            };

            export default handler;
```

            Your Copilot Runtime endpoint should be available at `http://localhost:3000/api/copilotkit`.

            Create a new Express.js app and set up the Copilot Runtime handler:

```ts title="server.ts"
            import express from 'express';
            import {
              CopilotRuntime,
              {{adapterImport}},
              copilotRuntimeNodeHttpEndpoint,
            } from '@copilotkit/runtime';
            {{extraImports}}

            const app = express();
            {{clientSetup}}
            {{adapterSetup}}

            app.use('/copilotkit', (req, res, next) => {
              (async () => {
                const runtime = new CopilotRuntime();
                const handler = copilotRuntimeNodeHttpEndpoint({
                  endpoint: '/copilotkit',
                  runtime,
                  serviceAdapter,
                });

                return handler(req, res);
              })().catch(next);
            });

            app.listen(4000, () => {
              console.log('Listening at http://localhost:4000/copilotkit');
            });
```

            Your Copilot Runtime endpoint should be available at `http://localhost:4000/copilotkit`.

                Remember to point your `runtimeUrl` to the correct endpoint in your client-side code, e.g. `http://localhost:PORT/copilotkit`.

            Set up a simple Node.js HTTP server and use the Copilot Runtime to handle requests:

```ts title="server.ts"
            import { createServer } from 'node:http';
            import {
              CopilotRuntime,
              {{adapterImport}},
              copilotRuntimeNodeHttpEndpoint,
            } from '@copilotkit/runtime';
            {{extraImports}}

            {{clientSetup}}
            {{adapterSetup}}

            const server = createServer((req, res) => {
              const runtime = new CopilotRuntime();
              const handler = copilotRuntimeNodeHttpEndpoint({
                endpoint: '/copilotkit',
                runtime,
                serviceAdapter,
              });

              return handler(req, res);
            });

            server.listen(4000, () => {
              console.log('Listening at http://localhost:4000/copilotkit');
            });
```

            Your Copilot Runtime endpoint should be available at `http://localhost:4000/copilotkit`.

                Remember to point your `runtimeUrl` to the correct endpoint in your client-side code, e.g. `http://localhost:PORT/copilotkit`.

            Set up a controller in NestJS to handle the Copilot Runtime endpoint:

```ts title="copilotkit.controller.ts"
            import { All, Controller, Req, Res } from '@nestjs/common';
            import { CopilotRuntime, copilotRuntimeNestEndpoint, {{adapterImport}} } from '@copilotkit/runtime';
            import { Request, Response } from 'express';

            @Controller()
            export class CopilotKitController {
              @All('/copilotkit')
              copilotkit(@Req() req: Request, @Res() res: Response) {
                {{adapterSetup}}
                const runtime = new CopilotRuntime();

                const handler = copilotRuntimeNestEndpoint({
                  runtime,
                  serviceAdapter,
                  endpoint: '/copilotkit',
                });
                return handler(req, res);
              }
            }
```

            Your Copilot Runtime endpoint should be available at `http://localhost:3000/copilotkit`.

                Remember to point your `runtimeUrl` to the correct endpoint in your client-side code, e.g. `http://localhost:PORT/copilotkit`.

### Configure the CopilotKit Provider

```tsx title="layout.tsx"
import "./globals.css";
import { ReactNode } from "react";
import { CopilotKit } from "@copilotkit/react-core"; // [!code highlight]

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body> 
        {/* Make sure to use the URL you configured in the previous step  */}
        {/* [!code highlight:3] */}
        <CopilotKit runtimeUrl="/api/copilotkit"> 
          {children}
        </CopilotKit>
      </body>
    </html>
  );
}

</Step>
</Steps>
</TailoredContentOption>
</TailoredContent>

### CopilotKit Chat Popup

We provide several plug-and-play components for you to interact with your copilot. Some of these are `<CopilotPopup/>`, `<CopilotSidebar/>`, and `<CopilotChat/>`. You can of course use CopilotKit in headless mode and provide your own fully custom UI via [`useCopilotChat`](/reference/v1/hooks/useCopilotChat).

In this tutorial, we'll use the `<CopilotPopup/>` component to display the chat popup.

```tsx title="app/page.tsx" showLineNumbers {6-7,15}
"use client";

```

Here's what we did:

- We imported the `<CopilotPopup />` component from `@copilotkit/react-ui`.
- We wrapped the page with the `<CopilotKit>` provider.
- We imported the built-in styles from `@copilotkit/react-ui`.

Now, head back to your app and you'll find a chat popup in the bottom right corner of the page. At this point, you can start interacting with your copilot! 🎉

In the next step, we'll make our assistant smarter by providing it with readable state about our todo list.

### Step 3: Copilot Readable State
- Route: `/built-in-agent/tutorials/ai-todo-app/step-3-copilot-readable-state`
- Source: `docs/content/docs/integrations/built-in-agent/tutorials/ai-todo-app/step-3-copilot-readable-state.mdx`

At this point, we have a chat popup in our app and we're able to chat directly with our copilot. This is great, but our copilot doesn't know anything about our app. In this step, we'll provide our copilot with the state of our todos.

In this step, you'll learn how to provide knowledge to the copilot. In our case, we want the copilot to know about the tasks in our app.

## Our App's State

Let's quickly review how our app's state works. Open up the [`lib/hooks/use-tasks.tsx`](https://github.com/CopilotKit/example-todos-app/blob/base-start-here/lib/hooks/use-tasks.tsx) file.

At a glance, we can see that the file exposes a provider (`TasksProvider`), which defines a useful things:

- The state of our tasks (`tasks`)
- A function to add a task (`addTask`)
- A function to update a task (`updateTask`)
- A function to delete a task (`deleteTask`)

All of this is consumable by a `useTasks` hook, which we use in the rest of our application (feel free to check out the `TasksList`, `AddTask` and `Task` components).

This resembles the majority of React apps, where frontend state, either for a feature or the entire app, is managed by a context or state management library.

## The `useCopilotReadable` hook

Our goal is to make our copilot aware of this state, so that it can provide more accurate and helpful responses. We can easily achieve this by using the [`useCopilotReadable`](/reference/v1/hooks/useCopilotReadable) hook.

```tsx title="lib/hooks/use-tasks.tsx" {3,8-11}
// ... the rest of the file

import { useCopilotReadable } from "@copilotkit/react-core/v2"; // [!code highlight]

export const TasksProvider = ({ children }: { children: ReactNode }) => {
  const [tasks, setTasks] = useState<Task[]>(defaultTasks);

  // [!code highlight:4]
  useCopilotReadable({
    description: "The state of the todo list",
    value: JSON.stringify(tasks)
  });

  // ... the rest of the file
}
```

In this example, we use the `useCopilotReadable` hook to provide the copilot with the state of our tasks.

- For the `description` property, we provide a concise description that tells the copilot what this piece of readable data means.
- For the `value` property, we pass the entire state as a JSON string.

## Try it out!

Now, try it out! Ask your Copilot a question about the state of the todo list. For example:

> How many tasks do I still need to get done?

Magical, isn't it? ✨ In the next step, you'll learn how to make the copilot take actions based on the state of your app.

### Step 4: Frontend Tools
- Route: `/built-in-agent/tutorials/ai-todo-app/step-4-frontend-tools`
- Source: `docs/content/docs/integrations/built-in-agent/tutorials/ai-todo-app/step-4-frontend-tools.mdx`

Now it's time to make our copilot even more useful by enabling it to execute tools.

## Available Tools

Once again, let's take a look at our app's state in the [`lib/hooks/use-tasks.tsx`](https://github.com/CopilotKit/example-todos-app/blob/base-start-here/lib/hooks/use-tasks.tsx#L19-L33) file.

Essentially, we want our copilot to be able to call the `addTask`, `setTaskStatus` and `deleteTask` functions.

## The `useFrontendTool` hook

The [`useFrontendTool`](/reference/v1/hooks/useFrontendTool) hook makes tools available to our copilot. Let's implement it in the [`lib/hooks/use-tasks.tsx`](https://github.com/CopilotKit/example-todos-app/blob/base-start-here/lib/hooks/use-tasks.tsx) file.

```tsx filename="lib/hooks/use-tasks.tsx" showLineNumbers {3-3,8-22,24-38,40-61}
// ... the rest of the file

import { useCopilotReadable, useFrontendTool } from "@copilotkit/react-core/v2"; // [!code highlight]
import { z } from "zod"; // [!code highlight]

export const TasksProvider = ({ children }: { children: ReactNode }) => {
  const [tasks, setTasks] = useState<Task[]>(defaultTasks);

  // [!code highlight:10]
  useFrontendTool({
    name: "addTask",
    description: "Adds a task to the todo list",
    parameters: z.object({
      title: z.string().describe("The title of the task"),
    }),
    handler: ({ title }) => {
      addTask(title);
      return `Added task: ${title}`;
    },
  });

  // [!code highlight:10]
  useFrontendTool({
    name: "deleteTask",
    description: "Deletes a task from the todo list",
    parameters: z.object({
      id: z.number().describe("The id of the task"),
    }),
    handler: ({ id }) => {
      deleteTask(id);
      return `Deleted task ${id}`;
    },
  });

  // [!code highlight:11]
  useFrontendTool({
    name: "setTaskStatus",
    description: "Sets the status of a task",
    parameters: z.object({
      id: z.number().describe("The id of the task"),
      status: z.enum(Object.values(TaskStatus) as [string, ...string[]]).describe("The status of the task"),
    }),
    handler: ({ id, status }) => {
      setTaskStatus(id, status);
      return `Set task ${id} status to ${status}`;
    },
  });

  // ... the rest of the file
};
```

The `useFrontendTool` hook is a powerful hook that allows us to register tools with our copilot. It takes an object with the following properties:

- `name` is the name of the tool.
- `description` is a description of the tool. It's important to choose a good description so that our copilot can choose the right tool.
- `parameters` is a Zod schema that defines the parameters the tool accepts. This provides runtime validation and TypeScript type inference.
- `handler` is a function that will be called when the tool is triggered. It's type safe thanks to Zod!

You can check out the full reference for the `useFrontendTool` hook [here](https://docs.copilotkit.ai/reference/v1/hooks/useFrontendTool).

## Try it out!

Now, head back to the app and ask your pilot to do any of the following:

- "Create a task about inviting Daniel to my birthday"
- "Delete all outstanding tasks"
- "Mark task with ID 2 as done"
- etc.

Your copilot is now more helpful than ever 💪
