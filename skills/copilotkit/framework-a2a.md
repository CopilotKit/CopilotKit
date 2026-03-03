# A2A Integration

CopilotKit implementation guide for A2A.

## Guidance
### AG-UI
- Route: `/a2a/ag-ui`
- Source: `docs/content/docs/integrations/a2a/ag-ui.mdx`
- Description: The AG-UI protocol connects your frontend to your A2A agents via event-based Server-Sent Events (SSE).

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

### Coding Agents
- Route: `/a2a/coding-agents`
- Source: `docs/content/docs/integrations/a2a/coding-agents.mdx`
- Description: Use our MCP server to connect your A2A agents to CopilotKit.

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
- Route: `/a2a/copilot-runtime`
- Source: `docs/content/docs/integrations/a2a/copilot-runtime.mdx`
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
- Route: `/a2a/custom-look-and-feel/headless-ui`
- Source: `docs/content/docs/integrations/a2a/custom-look-and-feel/headless-ui.mdx`
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
- Route: `/a2a/custom-look-and-feel/slots`
- Source: `docs/content/docs/integrations/a2a/custom-look-and-feel/slots.mdx`
- Description: Customize any part of the chat UI by overriding individual sub-components via slots for A2A.

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

### Declarative (A2UI)
- Route: `/a2a/generative-ui/declarative-a2ui`
- Source: `docs/content/docs/integrations/a2a/generative-ui/declarative-a2ui.mdx`
- Description: Use A2UI to declaratively generate user interfaces.

```bash
    git clone https://github.com/copilotkit/with-a2a-a2ui.git
```
```
    pnpm install
```
```
    pnpm dev
```
```python title="agent/restaurant_finder/prompt_builder.py"
      RESTAURANT_UI_EXAMPLES = """
      ...
      ---BEGIN SINGLE_COLUMN_LIST_EXAMPLE---
      [
        {{ "beginRendering": {{ "surfaceId": "default", "root": "root-column", "styles": {{ "primaryColor": "#FF0000", "font": "Roboto" }} }} }},
        {{ "surfaceUpdate": {{
          "surfaceId": "default",
          "components": [
            {{ "id": "root-column", "component": {{ "Column": {{ "children": {{ "explicitList": ["title-heading", "item-list"] }} }} }} }},
            {{ "id": "title-heading", "component": {{ "Text": {{ "usageHint": "h1", "text": {{ "literalString": "Top Restaurants" }} }} }} }},
            {{ "id": "item-list", "component": {{ "List": {{ "direction": "vertical", "children": {{ "template": {{ "componentId": "item-card-template", "dataBinding": "/items" }} }} }} }} }},
            {{ "id": "item-card-template", "component": {{ "Card": {{ "child": "card-layout" }} }} }},
            {{ "id": "card-layout", "component": {{ "Row": {{ "children": {{ "explicitList": ["template-image", "card-details"] }} }} }} }},
            {{ "id": "template-image", weight: 1, "component": {{ "Image": {{ "url": {{ "path": "imageUrl" }} }} }} }},
            {{ "id": "card-details", weight: 2, "component": {{ "Column": {{ "children": {{ "explicitList": ["template-name", "template-rating", "template-detail", "template-link", "template-book-button"] }} }} }} }},
            {{ "id": "template-name", "component": {{ "Text": {{ "usageHint": "h3", "text": {{ "path": "name" }} }} }} }},
            {{ "id": "template-rating", "component": {{ "Text": {{ "text": {{ "path": "rating" }} }} }} }},
            {{ "id": "template-detail", "component": {{ "Text": {{ "text": {{ "path": "detail" }} }} }} }},
            {{ "id": "template-link", "component": {{ "Text": {{ "text": {{ "path": "infoLink" }} }} }} }},
            {{ "id": "template-book-button", "component": {{ "Button": {{ "child": "book-now-text", "primary": true, "action": {{ "name": "book_restaurant", "context": [ {{ "key": "restaurantName", "value": {{ "path": "name" }} }}, {{ "key": "imageUrl", "value": {{ "path": "imageUrl" }} }}, {{ "key": "address", "value": {{ "path": "address" }} }} ] }} }} }} }},
            {{ "id": "book-now-text", "component": {{ "Text": {{ "text": {{ "literalString": "Book Now" }} }} }} }}
          ]
        }} }},
        {{ "dataModelUpdate": {{
          "surfaceId": "default",
          "path": "/",
          "contents": [
            {{ "key": "items", "valueMap": [
              {{ "key": "item1", "valueMap": [
                {{ "key": "name", "valueString": "The Fancy Place" }},
                {{ "key": "rating", "valueNumber": 4.8 }},
                {{ "key": "detail", "valueString": "Fine dining experience" }},
                {{ "key": "infoLink", "valueString": "https://example.com/fancy" }},
                {{ "key": "imageUrl", "valueString": "https://example.com/fancy.jpg" }},
                {{ "key": "address", "valueString": "123 Main St" }}
              ] }},
              {{ "key": "item2", "valueMap": [
                {{ "key": "name", "valueString": "Quick Bites" }},
                {{ "key": "rating", "valueNumber": 4.2 }},
                {{ "key": "detail", "valueString": "Casual and fast" }},
                {{ "key": "infoLink", "valueString": "https://example.com/quick" }},
                {{ "key": "imageUrl", "valueString": "https://example.com/quick.jpg" }},
                {{ "key": "address", "valueString": "456 Oak Ave" }}
              ] }}
            ] }} // Populate this with restaurant data
          ]
        }} }}
      ]
      ---END SINGLE_COLUMN_LIST_EXAMPLE---
      # ... more examples below
```
```tsx title="app/page.tsx"
    "use client";

    import { CopilotChat, CopilotKitProvider } from "@copilotkitnext/react";
    import { createA2UIMessageRenderer } from "@copilotkitnext/a2ui-renderer";
    import { theme } from "./theme";

    // Disable static optimization for this page
    export const dynamic = "force-dynamic";

    const A2UIMessageRenderer = createA2UIMessageRenderer({ theme });

    export default function Home() {
      return (
        <CopilotKitProvider
          runtimeUrl="/api/copilotkit"
          showDevConsole="auto"
          renderActivityMessages={[A2UIMessageRenderer]}
        >
          <main
            className="flex min-h-screen flex-1 flex-col overflow-hidden"
            style={{ minHeight: "100dvh" }}
          >
            <Chat />
          </main>
        </CopilotKitProvider>
      );
    }

    function Chat() {
      return (
        <div className="flex flex-1 flex-col overflow-hidden">
          <CopilotChat style={{ flex: 1, minHeight: "100%" }} />
        </div>
      );
    }
```
```tsx title="app/theme.ts"
    import { v0_8 } from "@google/a2ui";

    /** Elements */

    const a = {
      "typography-f-sf": true,
      "typography-fs-n": true,
      "typography-w-500": true,
      "layout-as-n": true,
      "layout-dis-iflx": true,
      "layout-al-c": true,
    };

    const audio = {
      "layout-w-100": true,
    };

    const body = {
      "typography-f-s": true,
      "typography-fs-n": true,
      "typography-w-400": true,
      "layout-mt-0": true,
      "layout-mb-2": true,
      "typography-sz-bm": true,
      "color-c-n10": true,
    };

    const button = {
      "typography-f-sf": true,
      "typography-fs-n": true,
      "typography-w-500": true,
      "layout-pt-3": true,
      "layout-pb-3": true,
      "layout-pl-5": true,
      "layout-pr-5": true,
      "layout-mb-1": true,
      "border-br-16": true,
      "border-bw-0": true,
      "border-c-n70": true,
      "border-bs-s": true,
      "color-bgc-s30": true,
      "color-c-n100": true,
      "behavior-ho-80": true,
    };

    const heading = {
      "typography-f-sf": true,
      "typography-fs-n": true,
      "typography-w-500": true,
      "layout-mt-0": true,
      "layout-mb-2": true,
      "color-c-n10": true,
    };

    const h1 = {
      ...heading,
      "typography-sz-tl": true,
    };

    const h2 = {
      ...heading,
      "typography-sz-tm": true,
    };

    const h3 = {
      ...heading,
      "typography-sz-ts": true,
    };

    const iframe = {
      "behavior-sw-n": true,
    };

    const input = {
      "typography-f-sf": true,
      "typography-fs-n": true,
      "typography-w-400": true,
      "layout-pl-4": true,
      "layout-pr-4": true,
      "layout-pt-2": true,
      "layout-pb-2": true,
      "border-br-6": true,
      "border-bw-1": true,
      "color-bc-s70": true,
      "border-bs-s": true,
      "layout-as-n": true,
      "color-c-n10": true,
    };

    const p = {
      "typography-f-s": true,
      "typography-fs-n": true,
      "typography-w-400": true,
      "layout-m-0": true,
      "typography-sz-bm": true,
      "layout-as-n": true,
      "color-c-n10": true,
    };

    const orderedList = {
      "typography-f-s": true,
      "typography-fs-n": true,
      "typography-w-400": true,
      "layout-m-0": true,
      "typography-sz-bm": true,
      "layout-as-n": true,
    };

    const unorderedList = {
      "typography-f-s": true,
      "typography-fs-n": true,
      "typography-w-400": true,
      "layout-m-0": true,
      "typography-sz-bm": true,
      "layout-as-n": true,
    };

    const listItem = {
      "typography-f-s": true,
      "typography-fs-n": true,
      "typography-w-400": true,
      "layout-m-0": true,
      "typography-sz-bm": true,
      "layout-as-n": true,
    };

    const pre = {
      "typography-f-c": true,
      "typography-fs-n": true,
      "typography-w-400": true,
      "typography-sz-bm": true,
      "typography-ws-p": true,
      "layout-as-n": true,
    };

    const textarea = {
      ...input,
      "layout-r-none": true,
      "layout-fs-c": true,
    };

    const video = {
      "layout-el-cv": true,
    };

    const aLight = v0_8.Styles.merge(a, { "color-c-n5": true });
    const inputLight = v0_8.Styles.merge(input, { "color-c-n5": true });
    const textareaLight = v0_8.Styles.merge(textarea, { "color-c-n5": true });
    const buttonLight = v0_8.Styles.merge(button, { "color-c-n100": true });
    const h1Light = v0_8.Styles.merge(h1, { "color-c-n5": true });
    const h2Light = v0_8.Styles.merge(h2, { "color-c-n5": true });
    const h3Light = v0_8.Styles.merge(h3, { "color-c-n5": true });
    const bodyLight = v0_8.Styles.merge(body, { "color-c-n5": true });
    const pLight = v0_8.Styles.merge(p, { "color-c-n35": true });
    const preLight = v0_8.Styles.merge(pre, { "color-c-n35": true });
    const orderedListLight = v0_8.Styles.merge(orderedList, {
      "color-c-n35": true,
    });
    const unorderedListLight = v0_8.Styles.merge(unorderedList, {
      "color-c-n35": true,
    });
    const listItemLight = v0_8.Styles.merge(listItem, {
      "color-c-n35": true,
    });

    export const theme: v0_8.Types.Theme = {
      additionalStyles: {
        Button: {
          "--n-35": "var(--n-100)",
        },
      },
      components: {
        AudioPlayer: {},
        Button: {
          "layout-pt-2": true,
          "layout-pb-2": true,
          "layout-pl-3": true,
          "layout-pr-3": true,
          "border-br-12": true,
          "border-bw-0": true,
          "border-bs-s": true,
          "color-bgc-p30": true,
          "color-c-n100": true,
          "behavior-ho-70": true,
        },
        Card: { "border-br-9": true, "color-bgc-p100": true, "layout-p-4": true },
        CheckBox: {
          element: {
            "layout-m-0": true,
            "layout-mr-2": true,
            "layout-p-2": true,
            "border-br-12": true,
            "border-bw-1": true,
            "border-bs-s": true,
            "color-bgc-p100": true,
            "color-bc-p60": true,
            "color-c-n30": true,
            "color-c-p30": true,
          },
          label: {
            "color-c-p30": true,
            "typography-f-sf": true,
            "typography-v-r": true,
            "typography-w-400": true,
            "layout-flx-1": true,
            "typography-sz-ll": true,
          },
          container: {
            "layout-dsp-iflex": true,
            "layout-al-c": true,
          },
        },
        Column: {
          "layout-g-2": true,
        },
        DateTimeInput: {
          container: {
            "typography-sz-bm": true,
            "layout-w-100": true,
            "layout-g-2": true,
            "layout-dsp-flexhor": true,
            "layout-al-c": true,
          },
          label: {
            "layout-flx-0": true,
          },
          element: {
            "layout-pt-2": true,
            "layout-pb-2": true,
            "layout-pl-3": true,
            "layout-pr-3": true,
            "border-br-12": true,
            "border-bw-1": true,
            "border-bs-s": true,
            "color-bgc-p100": true,
            "color-bc-p60": true,
            "color-c-n30": true,
            "color-c-p30": true,
          },
        },
        Divider: {},
        Image: {
          all: {
            "border-br-5": true,
            "layout-el-cv": true,
            "layout-w-100": true,
            "layout-h-100": true,
          },
          avatar: {},
          header: {},
          icon: {},
          largeFeature: {},
          mediumFeature: {},
          smallFeature: {},
        },
        Icon: {},
        List: {
          "layout-g-4": true,
          "layout-p-2": true,
        },
        Modal: {
          backdrop: { "color-bbgc-p60_20": true },
          element: {
            "border-br-2": true,
            "color-bgc-p100": true,
            "layout-p-4": true,
            "border-bw-1": true,
            "border-bs-s": true,
            "color-bc-p80": true,
          },
        },
        MultipleChoice: {
          container: {},
          label: {},
          element: {},
        },
        Row: {
          "layout-g-4": true,
        },
        Slider: {
          container: {},
          label: {},
          element: {},
        },
        Tabs: {
          container: {},
          controls: { all: {}, selected: {} },
          element: {},
        },
        Text: {
          all: {
            "layout-w-100": true,
            "layout-g-2": true,
            "color-c-p30": true,
          },
          h1: {
            "typography-f-sf": true,
            "typography-v-r": true,
            "typography-w-400": true,
            "layout-m-0": true,
            "layout-p-0": true,
            "typography-sz-tl": true,
          },
          h2: {
            "typography-f-sf": true,
            "typography-v-r": true,
            "typography-w-400": true,
            "layout-m-0": true,
            "layout-p-0": true,
            "typography-sz-tm": true,
          },
          h3: {
            "typography-f-sf": true,
            "typography-v-r": true,
            "typography-w-400": true,
            "layout-m-0": true,
            "layout-p-0": true,
            "typography-sz-ts": true,
          },
          h4: {
            "typography-f-sf": true,
            "typography-v-r": true,
            "typography-w-400": true,
            "layout-m-0": true,
            "layout-p-0": true,
            "typography-sz-bl": true,
          },
          h5: {
            "typography-f-sf": true,
            "typography-v-r": true,
            "typography-w-400": true,
            "layout-m-0": true,
            "layout-p-0": true,
            "typography-sz-bm": true,
          },
          body: {},
          caption: {},
        },
        TextField: {
          container: {
            "typography-sz-bm": true,
            "layout-w-100": true,
            "layout-g-2": true,
            "layout-dsp-flexhor": true,
            "layout-al-c": true,
          },
          label: {
            "layout-flx-0": true,
          },
          element: {
            "typography-sz-bm": true,
            "layout-pt-2": true,
            "layout-pb-2": true,
            "layout-pl-3": true,
            "layout-pr-3": true,
            "border-br-12": true,
            "border-bw-1": true,
            "border-bs-s": true,
            "color-bgc-p100": true,
            "color-bc-p60": true,
            "color-c-n30": true,
            "color-c-p30": true,
          },
        },
        Video: {
          "border-br-5": true,
          "layout-el-cv": true,
        },
      },
      elements: {
        a: aLight,
        audio,
        body: bodyLight,
        button: buttonLight,
        h1: h1Light,
        h2: h2Light,
        h3: h3Light,
        iframe,
        input: inputLight,
        p: pLight,
        pre: preLight,
        textarea: textareaLight,
        video,
      },
      markdown: {
        p: [...Object.keys(pLight)],
        h1: [...Object.keys(h1Light)],
        h2: [...Object.keys(h2Light)],
        h3: [...Object.keys(h3Light)],
        h4: [],
        h5: [],
        h6: [],
        ul: [...Object.keys(unorderedListLight)],
        ol: [...Object.keys(orderedListLight)],
        li: [...Object.keys(listItemLight)],
        a: [...Object.keys(aLight)],
        strong: [],
        em: [],
      },
    };
```

### Prebuilt Components
- Route: `/a2a/prebuilt-components`
- Source: `docs/content/docs/integrations/a2a/prebuilt-components.mdx`
- Description: Drop-in chat components for your A2A agent.

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

### Programmatic Control
- Route: `/a2a/programmatic-control`
- Source: `docs/content/docs/integrations/a2a/programmatic-control.mdx`
- Description: Control your A2A agent programmatically with useAgent and copilotkit.runAgent().

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
- Route: `/a2a/quickstart`
- Source: `docs/content/docs/integrations/a2a/quickstart.mdx`
- Description: Turn your A2A Agents into an agent-native application in 10 minutes.

## Prerequisites

Before you begin, you'll need the following:

- A Google Gemini API key
- Node.js 20+
- Python 3.9+
- Your favorite package manager

## Getting started

        ### Clone the A2A starter template

```bash
        git clone https://github.com/copilotkit/with-a2a-a2ui.git
```
        ### Install dependencies

```
        pnpm install
```
        ### Configure your environment

        Create a `.env` file in your agent directory and add your Google API key:

```plaintext title="agent/.env"
        GOOGLE_API_KEY=your_google_api_key
```

          The starter template is configured to use Google's Gemini by default, but you can modify it to use any language model supported by ADK.
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

        This will start both the UI and agent servers concurrently.
        ### 🎉 Start chatting!

        Your AI agent is now ready to use! Navigate to `localhost:3000` and start prompting it:

```
        Show me chinese restaurants in NYC
```

                - If you're having connection issues, try using `0.0.0.0` or `127.0.0.1` instead of `localhost`
                - Make sure your agent is running on port 8000
                - Check that your Google API key is correctly set

## What's next?

Now that you have your basic agent setup, explore these advanced features:
