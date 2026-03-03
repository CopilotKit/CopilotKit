# CrewAI Flows Integration

CopilotKit implementation guide for CrewAI Flows.

## Guidance
### Disabling state streaming
- Route: `/crewai-flows/advanced/disabling-state-streaming`
- Source: `docs/content/docs/integrations/crewai-flows/advanced/disabling-state-streaming.mdx`
- Description: Granularly control what is streamed to the frontend.

## What is this?

By default, CopilotKit will stream both your messages and tool calls to the frontend when you use `copilotkit_stream`. You can disable this by choosing when to use `copilotkit_stream` vs calling `completion` directly.

## When should I use this?

Occasionally, you'll want to disable streaming temporarily — for example, the LLM may be doing something the current user should not see, like emitting tool calls or questions pertaining to other employees in an HR system.

## Implementation

### Disable all streaming

You can control whether to stream messages or tool calls by selectively wrapping calls to `completion` with `copilotkit_stream`.

```python
        from copilotkit.crewai import copilotkit_stream
        from typing import cast, Any
        from litellm import completion

        @start()
        async def start(self):

            # 1) Do not emit messages or tool calls, keeping the LLM call private.
            response = completion(
                model="openai/gpt-5.2",
                messages=[
                    {"role": "system", "content": "You are a helpful assistant"},
                    *self.state.messages
                ],
            )
            message = response.choices[0].message

            # 2) Or wrap the LLM call with `copilotkit_stream` to stream message tokens.
            #    Note that we pass `stream=True` to the inner `completion` call.
            response = await copilotkit_stream(
                completion(
                    model="openai/gpt-5.2",
                    messages=[
                        {"role": "system", "content": "You are a helpful assistant"},
                        *self.state.messages
                    ],
                    stream=True
                )
            )
            message = cast(Any, response).choices[0]["message"]
```

### Manually emitting messages
- Route: `/crewai-flows/advanced/emit-messages`
- Source: `docs/content/docs/integrations/crewai-flows/advanced/emit-messages.mdx`

While most agent interactions happen automatically through shared state updates as the agent runs, you can also **manually send messages from within your agent code** to provide immediate feedback to users.

  This video shows the result of `npx copilotkit@latest init` with the [implementation](#implementation) section applied to it!

## What is this?

In CrewAI, messages are only emitted when a function is completed. CopilotKit allows you to manually emit messages
in the middle of a function's execution to provide immediate feedback to the user.

## When should I use this?

Manually emitted messages are great for **when you don't want to wait for the function** to complete **and you**:

- Have a long running task that you want to provide feedback on
- Want to provide a status update to the user
- Want to provide a warning or error message

## Implementation

        ### Run and Connect Your Agent to CopilotKit
        You'll need to run your agent and connect it to CopilotKit before proceeding. If you haven't done so already,
you can follow the instructions in the [Getting Started](/coagents/quickstart/langgraph) guide.

If you don't already have an agent, you can use the [coagent starter](https://github.com/copilotkit/copilotkit/tree/main/examples/coagents-starter) as a starting point
as this guide uses it as a starting point.

        ### Install the CopilotKit SDK
```bash
    poetry add copilotkit
    # including support for crewai
    poetry add copilotkit[crewai]
```

```bash
    pip install copilotkit --extra-index-url https://copilotkit.gateway.scarf.sh/simple/
    # including support for crewai
    pip install copilotkit[crewai] --extra-index-url https://copilotkit.gateway.scarf.sh/simple/
```

```bash
    conda install copilotkit -c copilotkit-channel
    # including support for crewai
    conda install copilotkit[crewai] -c copilotkit-channel
```

        ### Manually emit a message
        The `copilotkit_emit_message` method allows you to emit messages early in a functions's execution to communicate status updates to the user. This is particularly useful for long running tasks.

```python
                from litellm import completion
                from crewai.flow.flow import start
                from copilotkit.crewai import copilotkit_emit_message # [!code highlight]
                # ...

                @start()
                async def start(self):
                    # [!code highlight:2]
                    intermediate_message = "Thinking really hard..."
                    await copilotkit_emit_message(intermediate_message)

                    # simulate a long running task
                    await asyncio.sleep(2)

                    response = copilotkit_stream(
                        completion(
                            model="openai/gpt-5.2",
                            messages=[
                                {"role": "system", "content": "You are a helpful assistant."},
                                *self.state["messages"]
                            ],
                            stream=True
                        )
                    )
                     message = response.choices[0]["message"]

                    self.state["messages"].append(message)
```
        ### Give it a try!
        Now when you talk to your agent you'll notice that it immediately responds with the message "Thinking really hard..."
        before giving you a response 2 seconds later.

### Exiting the agent loop
- Route: `/crewai-flows/advanced/exit-agent`
- Source: `docs/content/docs/integrations/crewai-flows/advanced/exit-agent.mdx`

After your agent has finished a workflow, you'll usually want to explicitly end that loop by calling the `copilotkit_exit()` method in your Python code.

Exiting the agent has different effects depending on mode:

- **Router Mode**: Exiting the agent hands responsibility for handling input back to the router, which can initiate chat, call actions, other agents, etc. The router can return to this agent later (starting a new loop) to satisfy a user request.

- **Agent Lock Mode**: Exiting the agent restarts the workflow loop for the current agent.

In this example from [our email-sending app](https://github.com/copilotkit/copilotkit/tree/main/examples/coagents-qa), the `send_email` node explicitly exits, then manually sends a response back to the user as a `ToolMessage`:

        ### Install the CopilotKit SDK
```bash
    poetry add copilotkit
    # including support for crewai
    poetry add copilotkit[crewai]
```

```bash
    pip install copilotkit --extra-index-url https://copilotkit.gateway.scarf.sh/simple/
    # including support for crewai
    pip install copilotkit[crewai] --extra-index-url https://copilotkit.gateway.scarf.sh/simple/
```

```bash
    conda install copilotkit -c copilotkit-channel
    # including support for crewai
    conda install copilotkit[crewai] -c copilotkit-channel
```

        ### Exit the agent loop
        This will exit the agent session as soon as the current CrewAI run is finished, either by a breakpoint or by reaching the `END` node.

```python
                import uuid
                from litellm import completion
                from crewai.flow.flow import start
                from copilotkit.crewai import copilotkit_exit
                # ...
                @start()
                async def send_email(self):
                    """Send an email."""

                    # get the last message and cast to ToolMessage
                    last_message = self.state["messages"][-1]
                    if last_message["content"] == "CANCEL":
                        text_message = "❌ Cancelled sending email."
                    else:
                        text_message = "✅ Sent email."
                    self.state["messages"].append({"role": "assistant", "content": text_message, "id": str(uuid.uuid4())})
                    # Exit the agent loop after processing
                    await copilotkit_exit() # [!code highlight]
```

### AG-UI
- Route: `/crewai-flows/ag-ui`
- Source: `docs/content/docs/integrations/crewai-flows/ag-ui.mdx`
- Description: The AG-UI protocol connects your frontend to your AI agents via event-based Server-Sent Events (SSE).

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
- Route: `/crewai-flows/coding-agents`
- Source: `docs/content/docs/integrations/crewai-flows/coding-agents.mdx`
- Description: Use our MCP server to connect your CrewAI Flows agents to CopilotKit.

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
- Route: `/crewai-flows/copilot-runtime`
- Source: `docs/content/docs/integrations/crewai-flows/copilot-runtime.mdx`
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
- Route: `/crewai-flows/custom-look-and-feel/headless-ui`
- Source: `docs/content/docs/integrations/crewai-flows/custom-look-and-feel/headless-ui.mdx`
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

### Slots
- Route: `/crewai-flows/custom-look-and-feel/slots`
- Source: `docs/content/docs/integrations/crewai-flows/custom-look-and-feel/slots.mdx`
- Description: Customize any part of the chat UI by overriding individual sub-components via slots.

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
- Route: `/crewai-flows/frontend-tools`
- Source: `docs/content/docs/integrations/crewai-flows/frontend-tools.mdx`
- Description: Create frontend tools and use them within your CrewAI Flows agent.

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

### State Rendering
- Route: `/crewai-flows/generative-ui/state-rendering`
- Source: `docs/content/docs/integrations/crewai-flows/generative-ui/state-rendering.mdx`
- Description: Render the state of your agent with custom UI components.

This video demonstrates the [implementation](#implementation) section applied
  to our [coagents starter
  project](https://github.com/CopilotKit/CopilotKit/tree/main/examples/coagents-starter-crewai-flows).

## What is this?

All CrewAI Flow agents are stateful. This means that as your agent progresses through nodes, a state object is passed between them perserving
the overall state of a session. CopilotKit allows you to render this state in your application with custom UI components, which we call **Agentic Generative UI**.

## When should I use this?

Rendering the state of your agent in the UI is useful when you want to provide the user with feedback about the overall state of a session. A great example of this
is a situation where a user and an agent are working together to solve a problem. The agent can store a draft in its state which is then rendered in the UI.

## Implementation

    ### Run and Connect your CrewAI Flow to CopilotKit
    First, you'll need to make sure you have a running CrewAI Flow. If you haven't already done this, you can follow the [getting started guide](/crewai-flows/quickstart)

    This guide uses the [CoAgents starter repo](https://github.com/CopilotKit/CopilotKit/tree/main/examples/coagents-starter-crewai-flows) as its starting point.

    ### Define your agent state
    If you're not familiar with CrewAI, your flows are stateful. As you progress through function, a state object is updated between them. CopilotKit
    allows you to easily render this state in your application.

    For the sake of this guide, let's say our state looks like this in our agent.

```python title="agent.py"
          # ...
          from copilotkit.crewai import CopilotKitState # extends MessagesState
          # ...

          # This is the state of the agent.
          # It inherits from the CopilotKitState properties from CopilotKit.
          class AgentState(CopilotKitState):
              searches: list[dict]
```

    ### Simulate state updates
    Next, let's write some logic into our agent that will simulate state updates occurring.

```python title="agent.py"
        from crewai.flow.flow import start
        from litellm import completion
        from copilotkit.crewai import copilotkit_stream, CopilotKitState, copilotkit_emit_state
        import asyncio
        from typing import TypedDict

        class Searches(TypedDict):
            query: str
            done: bool

        class AgentState(CopilotKitState):
            searches: list[Searches] = [] # [!code highlight]

        @start
        async def chat(self):
            self.state.searches = [
                {"query": "Initial research", "done": False},
                {"query": "Retrieving sources", "done": False},
                {"query": "Forming an answer", "done": False},
            ]
            await copilotkit_emit_state(self.state)

            # Simulate state updates # [!code highlight:4]
            for search in self.state.searches:
                await asyncio.sleep(1)
                search["done"] = True
                await copilotkit_emit_state(self.state)

            # Run the model to generate a response
            response = await copilotkit_stream(
                completion(
                    model="openai/gpt-5.2",
                    messages=[
                        {"role": "system", "content": "You are a helpful assistant."},
                        *self.state.get("messages", [])
                    ],
                    stream=True
                )
            )
```

    ### Render state of the agent in the chat
    Now we can utilize `useAgent` with a `render` function to render the state of our agent **in the chat**.

```tsx title="app/page.tsx"
    // ...
    import { useAgent } from "@copilotkit/react-core/v2";
    // ...

    // Define the state of the agent, should match the state of the agent in your Flow.
    type AgentState = {
      searches: {
        query: string;
        done: boolean;
      }[];
    };

    function YourMainContent() {
      // ...

      // [!code highlight:13]
      // styles omitted for brevity
      useAgent<AgentState>({
        name: "sample_agent", // the name the agent is served as
        render: ({ agentState }) => (
          <div>
            {agentState.searches?.map((search, index) => (
              <div key={index}>
                {search.done ? "✅" : "❌"} {search.query}{search.done ? "" : "..."}
              </div>
            ))}
          </div>
        ),
      });

      // ...

      return <div>...</div>;
    }
```

    ### Render state outside of the chat
    You can also render the state of your agent **outside of the chat**. This is useful when you want to render the state of your agent anywhere
    other than the chat.

```tsx title="app/page.tsx"
    import { useAgent } from "@copilotkit/react-core/v2"; // [!code highlight]
    // ...

    // Define the state of the agent, should match the state of the agent in your Flow.
    type AgentState = {
      searches: {
        query: string;
        done: boolean;
      }[];
    };

    function YourMainContent() {
      // ...

      // [!code highlight:3]
      const { agentState } = useAgent<AgentState>({
        name: "sample_agent", // the name the agent is served as
      })

      // ...

      return (
        <div>
          {/* ... */}
          <div className="flex flex-col gap-2 mt-4">
            {/* [!code highlight:5] */}
            {agentState.searches?.map((search, index) => (
              <div key={index} className="flex flex-row">
                {search.done ? "✅" : "❌"} {search.query}
              </div>
            ))}
          </div>
        </div>
      )
    }
```

    ### Give it a try!

    You've now created a component that will render the agent's state in the chat.

### Tool Rendering
- Route: `/crewai-flows/generative-ui/tool-rendering`
- Source: `docs/content/docs/integrations/crewai-flows/generative-ui/tool-rendering.mdx`
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
- Route: `/crewai-flows/generative-ui/your-components/display-only`
- Source: `docs/content/docs/integrations/crewai-flows/generative-ui/your-components/display-only.mdx`
- Description: Register React components that your agent can render in the chat.

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
- Route: `/crewai-flows/generative-ui/your-components/interactive`
- Source: `docs/content/docs/integrations/crewai-flows/generative-ui/your-components/interactive.mdx`
- Description: Create components that your agent can use to interact with the user.

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

### CrewAI Flows
- Route: `/crewai-flows/human-in-the-loop/flow`
- Source: `docs/content/docs/integrations/crewai-flows/human-in-the-loop/flow.mdx`
- Description: Learn how to implement Human-in-the-Loop (HITL) using CrewAI Flows.

Pictured above is the [coagent
  starter](https://github.com/copilotkit/copilotkit/tree/main/examples/coagents-starter-crewai-flows)
  with the implementation below applied!

## What is this?

[Flow based agents](https://docs.crewai.com/concepts/flows) are stateful agents that can be interrupted and resumed
to allow for user input.

CopilotKit lets you to add custom UI to take user input and then pass it back to the agent upon completion.

## Why should I use this?

Human-in-the-loop is a powerful way to implement complex workflows that are production ready. By having a human in the loop,
you can ensure that the agent is always making the right decisions and ultimately is being steered in the right direction.

Flow based agents are a great way to implement HITL for more complex workflows where you want to ensure the agent is aware
of everything that has happened during a HITL interaction.

## Implementation

        ### Run and connect your agent

        You'll need to run your agent and connect it to CopilotKit before proceeding. If you haven't done so already,
        you can follow the instructions in the [Getting Started](/crewai-flows/quickstart) guide.

        If you don't already have an agent, you can use the [coagent starter](https://github.com/CopilotKit/CopilotKit/tree/main/examples/coagents-starter-crewai-flows) as a starting point
        as this guide uses it as a starting point.

      ### Install the CopilotKit SDK
```bash
    poetry add copilotkit
    # including support for crewai
    poetry add copilotkit[crewai]
```

```bash
    pip install copilotkit --extra-index-url https://copilotkit.gateway.scarf.sh/simple/
    # including support for crewai
    pip install copilotkit[crewai] --extra-index-url https://copilotkit.gateway.scarf.sh/simple/
```

```bash
    conda install copilotkit -c copilotkit-channel
    # including support for crewai
    conda install copilotkit[crewai] -c copilotkit-channel
```

        ### Add a `useFrontendTool` to your Frontend
        First, we'll create a component that renders the agent's essay draft and waits for user approval.

```tsx title="ui/app/page.tsx"
        import { useFrontendTool } from "@copilotkit/react-core/v2"
        import { Markdown } from "@copilotkit/react-core/v2"

        function YourMainContent() {
          // ...

          useFrontendTool({
            name: "writeEssay",
            available: "remote",
            description: "Writes an essay and takes the draft as an argument.",
            parameters: [
              { name: "draft", type: "string", description: "The draft of the essay", required: true },
            ],
            // [!code highlight:25]
            renderAndWaitForResponse: ({ args, respond, status }) => {
              return (
                <div>
                  <Markdown content={args.draft || 'Preparing your draft...'} />

                  <div className={`flex gap-4 pt-4 ${status !== "executing" ? "hidden" : ""}`}>
                    <button
                      onClick={() => respond?.("CANCEL")}
                      disabled={status !== "executing"}
                      className="border p-2 rounded-xl w-full"
                    >
                      Try Again
                    </button>
                    <button
                      onClick={() => respond?.("SEND")}
                      disabled={status !== "executing"}
                      className="bg-blue-500 text-white p-2 rounded-xl w-full"
                    >
                      Approve Draft
                    </button>
                  </div>
                </div>
              );
            },
          });

          // ...
        }
```

    ### Setup the CrewAI Agent
    Now we'll setup the CrewAI agent. The flow is hard to understand without a complete example, so below
    is the complete implementation of the agent with explanations.

    Some main things to note:
    - The agent's state inherits from `CopilotKitState` to bring in the CopilotKit actions.
    - CopilotKit's actions are bound to the model as tools.
    - If the `writeEssay` action is found in the model's response, the agent will pass control back to the frontend
      to get user feedback.

```python title="agent.py"
        from typing import Any, cast
        from crewai.flow.flow import Flow, start, listen
        from copilotkit import CopilotKitState
        from copilotkit.crewai import copilotkit_stream
        from litellm import completion

        class AgentState(CopilotKitState):
            pass

        class SampleAgentFlow(Flow[AgentState]):

            @start()
            async def check_for_user_feedback(self):
                if not self.state.get("messages"):
                    return

                last_message = cast(Any, self.state["messages"][-1])

                # Expecting the result of a CopilotKit tool call (SEND/CANCEL)
                if last_message["role"] == "tool":
                    user_response = last_message.get("content")

                    if user_response == "SEND":
                        self.state["messages"].append({
                            "role": "assistant",
                            "content": "✅ Great! Sending your essay via email.",
                        })
                        return

                    if user_response == "CANCEL":
                        self.state["messages"].append({
                            "role": "assistant",
                            "content": "❌ Okay, we can improve the draft. What would you like to change?",
                        })
                        return

                # If no tool result yet, or it's a user message, prompt next step
                if last_message.get("role") == "user":
                    self.state["messages"].append({
                        "role": "system",
                        "content": (
                            "You write essays. Use your tools to write an essay; "
                            "don’t just write it in plain text."
                        )
                    })

            @listen(check_for_user_feedback)
            async def chat(self):
                messages = self.state.get("messages", [])

                system_message = {
                    "role": "system",
                    "content": (
                        "You write essays. Use your tools to write an essay; "
                        "don’t just write it in plain text."
                    )
                }

                response = await copilotkit_stream(
                    completion(
                        model="openai/gpt-5.2",
                        messages=[system_message, *messages],
                        tools=self.state["copilotkit"]["actions"],
                        stream=True
                    )
                )

                self.state["messages"].append(response.choices[0].message)
```
        ### Give it a try!
        Try asking your agent to write an essay about the benefits of AI. You'll see that it will generate an essay,
        stream the progress and eventually ask you to review it.

### Human in the Loop (HITL)
- Route: `/crewai-flows/human-in-the-loop`
- Source: `docs/content/docs/integrations/crewai-flows/human-in-the-loop/index.mdx`
- Description: Allow your agent and users to collaborate on complex tasks.

{/*
This video shows an example of our [AI Travel App](/langgraph/tutorials/ai-travel-app) using HITL to get user feedback.

## What is Human-in-the-Loop (HITL)?

Human-in-the-loop (HITL) allows agents to request human input or approval during execution, making AI systems more reliable and trustworthy. This pattern is essential when building AI applications that need to handle complex decisions or actions that require human judgment.

## When should I use this?

HITL combines the efficiency of AI with human judgment, creating a system that's both powerful and reliable. The key advantages include:

- **Quality Control**: Human oversight at critical decision points
- **Edge Cases**: Graceful handling of low-confidence situations
- **Expert Input**: Leverage human expertise when needed
- **Reliability**: More robust system for real-world use

## How can I use this?

Read more about the approach to HITL in CrewAI Flows.

      description:
        "Utilize CrewAI Flows to create Human-in-the-Loop workflows.",

### Inspector
- Route: `/crewai-flows/inspector`
- Source: `docs/content/docs/integrations/crewai-flows/inspector.mdx`
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

### Multi-Agent Flows
- Route: `/crewai-flows/multi-agent-flows`
- Source: `docs/content/docs/integrations/crewai-flows/multi-agent-flows.mdx`
- Description: Use multiple agents to orchestrate complex flows.

## What are Multi-Agent Flows?

When building agentic applications, you often want to orchestrate complex flows together that require the coordination of multiple
agents. This is traditionally called multi-agent orchestration.

## When should I use this?

Multi-agent flows are useful when you want to orchestrate complex flows together that require the coordination of multiple agents. As
your agentic application grows, delegation of sub-tasks to other agents can help you scale key pieces of your application.
- Divide context into smaller chunks
- Delegate sub-tasks to other agents
- Use a single agent to orchestrate the flow

## How does CopilotKit support this?

CopilotKit can be used in either of two distinct modes: **Router Mode**, or **Agent Lock**. By default, CopilotKit
will use Router Mode, leveraging your defined LLM to route requests between agents.

### Router Mode (default)
Router Mode is enabled by default when using CoAgents. To use it, specify a runtime URL prop in the `CopilotKit` provider component and omit the `agent` prop, like so:
```tsx
<CopilotKit runtimeUrl="<copilot-runtime-url>">
  {/* Your application components */}
</CopilotKit>
```

In router mode, CopilotKit acts as a central hub, dynamically selecting and _routing_ requests between different agents or actions based on the user's input. This mode can be good for chat-first experiences where an LLM chatbot is the entry point for a range of interactions, which can stay in the chat UI or expand to include native React UI widgets.

In this mode, CopilotKit will intelligently route requests to the most appropriate agent or action based on the context and user input.

    Router mode requires that you set up an LLM adapter. See how in ["Set up a copilot runtime"](https://docs.copilotkit.ai/direct-to-llm/guides/quickstart?copilot-hosting=self-hosted#set-up-a-copilot-runtime-endpoint) section of the docs.

### Agent Lock Mode
To use Agent Lock Mode, specify the agent name in the `CopilotKit` component with the `agent` prop:
```tsx
// [!code word:agent]
<CopilotKit runtimeUrl="<copilot-runtime-url>" agent="<the-name-of-the-agent>">
  {/* Your application components */}
</CopilotKit>
```

In this mode, CopilotKit is configured to work exclusively with a specific agent. This mode is useful when you want to focus on a particular task or domain. Whereas in Router Mode the LLM and CopilotKit's router are free to switch between agents to handle user requests, in Agent Lock Mode all requests will stay within a single workflow graph, ensuring precise control over the workflow.

Use whichever mode works best for your app experience! Also, note that while you cannot nest `CopilotKit` providers, you can use different agents or modes in different areas of your app — for example, you may want a chatbot in router mode that can call on any agent or tool, but may also want to integrate one specific agent elsewhere for a more focused workflow.

### Loading Agent State
- Route: `/crewai-flows/persistence/loading-agent-state`
- Source: `docs/content/docs/integrations/crewai-flows/persistence/loading-agent-state.mdx`
- Description: Learn how threadId is used to load previous agent states.

### Setting the threadId

When setting the `threadId` property in CopilotKit, i.e:

```tsx
<CopilotKit threadId="2140b272-7180-410d-9526-f66210918b13">
  <YourApp />
</CopilotKit>
```

CopilotKit will restore the complete state of the thread, including the messages, from the database.
(See [Message Persistence](/crewai-flows/persistence/message-persistence) for more details.)

### Loading Agent State

  **Important:** For agent state to be loaded correctly, you must first ensure
  that message history and persistence are properly configured. Follow the
  guides on [Threads &
  Persistence](/crewai-flows/persistence/loading-message-history) and [Message
  Persistence](/crewai-flows/persistence/message-persistence).

This means that the state of any agent will also be restored. For example:

```tsx
const { state } = useAgent({ name: "research_agent" });

// state will now be the state of research_agent in the thread id given above
```

### Learn More

To learn more about persistence and state in CopilotKit, see:

- [Reading agent state](/crewai-flows/shared-state/in-app-agent-read)
- [Writing agent state](/crewai-flows/shared-state/in-app-agent-write)
- [Loading Message History](/crewai-flows/persistence/loading-message-history)

### Threads
- Route: `/crewai-flows/persistence/loading-message-history`
- Source: `docs/content/docs/integrations/crewai-flows/persistence/loading-message-history.mdx`
- Description: Learn how to maintain persistent conversations across sessions with CrewAI Flows.

# Understanding Thread Persistence

CrewAI Flows supports threads, a way to group messages together and maintain a continuous chat history across sessions. CopilotKit provides mechanisms to ensure conversation state is properly persisted between the frontend and backend.

This guide assumes you have already gone through the [quickstart](/crewai-flows/quickstart) guide.

  **Note:** While the frontend uses `threadId` to manage conversation sessions,
  true persistence across sessions requires backend setup. The backend agent
  needs to implement a persistence mechanism (like the one shown in
  [Message Persistence](/crewai-flows/persistence/message-persistence))
  to save and load the state associated with each `threadId`.

See the [sample agent implementation](https://github.com/CopilotKit/CopilotKit/blob/main/examples/coagents-starter-crewai-flows/agent-py/sample_agent/agent.py#L291)
for a concrete example.

## Frontend: Setting the ThreadId

### Loading an Existing Thread

To load an existing thread in CopilotKit, set the `threadId` property on ``:

```tsx
import { CopilotKit } from "@copilotkit/react-core/v2";

<CopilotKit threadId="37aa68d0-d15b-45ae-afc1-0ba6c3e11353">
  <YourApp />
</CopilotKit>;
```

### Dynamically Switching Threads

You can make the `threadId` dynamic. Once set, CopilotKit will load previous messages for that thread.

```tsx
import { useState } from "react";
import { CopilotKit } from "@copilotkit/react-core/v2";

const Page = () => {
  const [threadId, setThreadId] = useState(
    "af2fa5a4-36bd-4e02-9b55-2580ab584f89"
  );
  return (
    <CopilotKit threadId={threadId}>
      <YourApp setThreadId={setThreadId} />
    </CopilotKit>
  );
};

const YourApp = ({ setThreadId }) => {
  return (
    <Button onClick={() => setThreadId("679e8da5-ee9b-41b1-941b-80e0cc73a008")}>
      Change Thread
    </Button>
  );
};
```

### Using setThreadId

CopilotKit provides the current `threadId` and a `setThreadId` function from the `useCopilotContext` hook:

```tsx
import { useCopilotContext } from "@copilotkit/react-core/v2";

const ChangeThreadButton = () => {
  const { threadId, setThreadId } = useCopilotContext();
  return (
    <Button onClick={() => setThreadId("d73c22f3-1f8e-4a93-99db-5c986068d64f")}>
      Change Thread
    </Button>
  );
};
```

### Message Persistence
- Route: `/crewai-flows/persistence/message-persistence`
- Source: `docs/content/docs/integrations/crewai-flows/persistence/message-persistence.mdx`

To learn about how to load previous messages and agent states, check out the
  [Loading Message History](/crewai-flows/persistence/loading-message-history)
  and [Loading Agent State](/crewai-flows/persistence/loading-agent-state)
  pages.

To persist CrewAI Flow messages to a database, you can use the `@persist` decorator. For example, you might use the default `SQLiteFlowPersistence` or provide your own custom persistence class.

For a concrete example of how a custom persistence class like `InMemoryFlowPersistence` can be implemented and used with the `@persist` decorator, see the [sample agent implementation](https://github.com/CopilotKit/CopilotKit/blob/main/examples/coagents-starter-crewai-flows/agent-py/sample_agent/agent.py).

Read more about persistence in the [CrewAI Flows documentation](https://docs.crewai.com/concepts/flows#class-level-persistence).

### Prebuilt Components
- Route: `/crewai-flows/prebuilt-components`
- Source: `docs/content/docs/integrations/crewai-flows/prebuilt-components.mdx`
- Description: Drop-in chat components for your CrewAI Flows agent.

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
- Route: `/crewai-flows/premium/headless-ui`
- Source: `docs/content/docs/integrations/crewai-flows/premium/headless-ui.mdx`
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
- Route: `/crewai-flows/premium/observability`
- Source: `docs/content/docs/integrations/crewai-flows/premium/observability.mdx`
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
- Route: `/crewai-flows/premium/overview`
- Source: `docs/content/docs/integrations/crewai-flows/premium/overview.mdx`
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
- Route: `/crewai-flows/programmatic-control`
- Source: `docs/content/docs/integrations/crewai-flows/programmatic-control.mdx`
- Description: Chat with an agent using CopilotKit's UI components.

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
- Route: `/crewai-flows/quickstart`
- Source: `docs/content/docs/integrations/crewai-flows/quickstart.mdx`
- Description: Turn your CrewAI Flows into an agent-native application in 10 minutes.

## Prerequisites

Before you begin, you must have a [CrewAI Flow](https://docs.crewai.com/guides/flows/first-flow) deployed on [CrewAI Enterprise](https://docs.crewai.com/enterprise/introduction). If you're looking for a sample flows, check out this [example agentic chat implementation](https://github.com/suhasdeshpande/agentic_chat).

## Getting started

                Bootstrap with the new CopilotKit CLI (Beta) or code along with us to get started.
            ### Run the CLI
            Just run this following command in your Next.js application to get started!

                    No problem! Just use `create-next-app` to make one quickly.
```bash
                    npx create-next-app@latest
```

```bash
            npx copilotkit@latest init -m CrewAI --crew-type Flows
```
            ### 🎉 Talk to your agent!

            Congrats! You've successfully integrated a CrewAI Flow agent chatbot to your application. Depending on the
            template you chose, you may see some different UI elements. To start, try asking a few questions to your agent.

```
            Can you tell me a joke?
```

```
            Can you help me understand AI?
```

```
            What do you think about React?
```
            ### Connect to Copilot Cloud
            1. Go to [Copilot Cloud](https://cloud.copilotkit.ai), sign in and click Get Started
            2. Click "Add Remote Endpoint" and fill in the details of your CrewAI Flow. Note: If your Agent Name contains multiple words, use underscores (`_`) as separators.
            3. Click "Save Endpoint"
            4. Copy the Copilot Cloud Public API Key

            ### Install CopilotKit
            First, install the latest packages for CopilotKit into your frontend.
```npm
            npm install @copilotkit/react-ui @copilotkit/react-core
```

            ### Setup the CopilotKit Provider
            The [``](/reference/v1/components/CopilotKit) component must wrap the Copilot-aware parts of your application. For most use-cases,
            it's appropriate to wrap the CopilotKit provider around the entire app, e.g. in your layout.tsx.

```tsx title="layout.tsx"
import "./globals.css";
import { ReactNode } from "react";
import { CopilotKit } from "@copilotkit/react-core"; // [!code highlight]

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body> 
        {/* Use the public api key you got from Copilot Cloud  */}
        {/* [!code highlight:6] */}
        <CopilotKit 
          publicApiKey="<your-copilot-cloud-public-api-key>"
          agent="sample_agent" // the name of the agent you want to use
        >
          {children}
        </CopilotKit>
      </body>
    </html>
  );
}
```
            ### Choose a Copilot UI
            You are almost there! Now it's time to setup your Copilot UI.

First, import the default styles in your root component (typically `layout.tsx`) :

```tsx filename="layout.tsx"
import "@copilotkit/react-ui/v2/styles.css";
```

  Copilot UI ships with a number of built-in UI patterns, choose whichever one you like.

    `CopilotPopup` is a convenience wrapper for `CopilotChat` that lives at the same level as your main content in the view hierarchy. It provides **a floating chat interface** that can be toggled on and off.

```tsx
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

    `CopilotSidebar` is a convenience wrapper for `CopilotChat` that wraps your main content in the view hierarchy. It provides a **collapsible and expandable sidebar** chat interface.

```tsx
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

    `CopilotChat` is a flexible chat interface component that **can be placed anywhere in your app** and can be resized as you desire.

```tsx
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

    The built-in Copilot UI can be customized in many ways -- both through CSS and by using the slot system for component replacement.

    CopilotKit also offers **fully custom headless UI**, through the `useAgent` and `useCopilotKit` hooks. Everything built with the built-in UI (and more) can be implemented with the headless UI, providing deep customizability.

```tsx
    import { useAgent } from "@copilotkit/react-core/v2";
    import { useCopilotKit } from "@copilotkit/react-core/v2";
    import { randomUUID } from "@copilotkit/shared/v2";

    export function CustomChatInterface() {
      const { agent } = useAgent();
      const { copilotkit } = useCopilotKit();

      const sendMessage = async (content: string) => {
        agent.addMessage({
          id: randomUUID(),
          role: "user",
          content,
        });
        await copilotkit.runAgent({ agent });
      };

      return (
        <div>
          {/* Implement your custom chat UI here */}
        </div>
      );
    }
```

            ### Create a CrewAI Flow component
            Place the following snippet in your **main page** (e.g. `page.tsx` in Next.js) or wherever you want to use CopilotKit.

```tsx title="page.tsx"
            "use client";
            import "@copilotkit/react-ui/v2/styles.css";
            import { CopilotKit, useFrontendTool } from "@copilotkit/react-core/v2";
            import { CopilotChat } from "@copilotkit/react-core/v2";
            import React, { useState } from "react";

            const publicApiKey = process.env.NEXT_PUBLIC_COPILOT_API_KEY || "";
            /**
             * AgentName refers to the Crew Flow Agent you have saved via CLI during setup.
             * It is used to identify the agent you want to use for the chat.
             */
            const agentName =
              process.env.NEXT_PUBLIC_COPILOTKIT_AGENT_NAME || "DefaultAgent";

            // Main Chat Component: Handles chat interface and background customization
            const Chat = () => {
              const [background, setBackground] = useState(
                "linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
              );

              // Action: Allow AI to change background color dynamically
              useFrontendTool({
                name: "change_background",
                description:
                  "Change the background color of the chat. Can be anything that the CSS background attribute accepts. Regular colors, linear of radial gradients etc.",
                parameters: [
                  {
                    name: "background",
                    type: "string",
                    description: "The background. Prefer gradients.",
                  },
                ],
                handler: ({ background }) => setBackground(background),
                followUp: false,
              });

              return (
                <div
                  className="h-screen w-full flex items-center justify-center"
                  style={{ background }}
                >
                  <div className="w-full max-w-3xl h-[80vh] px-4">
                    <div className="h-full bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl overflow-hidden">
                      <CopilotChat
                        className="h-full"
                        labels={{
                          welcomeMessageText: "Hi, I'm an agent. Want to chat?",
                          placeholder: "Type a message...",
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            }

            // App Component: Main wrapper that provides CopilotKit context
            const CrewAIFlow: React.FC = () => (
              <CopilotKit publicApiKey={publicApiKey} agent={agentName}>
                <Chat />
              </CopilotKit>
            );

            export default CrewAIFlow;
```
            ### 🎉 Talk to your agent!

            Congrats! You've successfully integrated a CrewAI Flow chatbot to your application. To start, try asking a few questions to your agent.

```
            Can you tell me a joke?
```

```
            Can you help me understand AI?
```

```
            What do you think about React?
```

                    - Try changing the host to `0.0.0.0` or `127.0.0.1` instead of `localhost`.

---

## What's next?

You've now got a CrewAI Flow running in CopilotKit! Now you can start exploring the various ways that CopilotKit
can help you build power agent native applications.

### Reading agent state
- Route: `/crewai-flows/shared-state/in-app-agent-read`
- Source: `docs/content/docs/integrations/crewai-flows/shared-state/in-app-agent-read.mdx`
- Description: Read the realtime agent state in your native application.

Pictured above is the [coagent
  starter](https://github.com/copilotkit/copilotkit/tree/main/examples/coagents-starter-crewai-flows)
  with the [implementation](#implementation) section applied!

## What is this?

You can easily use the realtime agent state not only in the chat UI, but also in the native application UX.

## When should I use this?

You can use this when you want to provide the user with feedback about your agent's state. As your agent's
state updates, you can reflect these updates natively in your application.

## Implementation

    ### Run and Connect Your Agent to CopilotKit

    You'll need to run your agent and connect it to CopilotKit before proceeding. If you haven't done so already,
    you can follow the instructions in the [Getting Started](/crewai-flows/quickstart) guide.

    If you don't already have an agent, you can use the [coagent starter](https://github.com/copilotkit/copilotkit/tree/main/examples/coagents-starter-crewai-flows) as a starting point
    as this guide uses it as a starting point.

    ### Define the Agent State
    CrewAI Flows are stateful. As you transition through the flow, that state is updated and available to the next function. For this example,
    let's assume that our agent state looks something like this.

```python title="agent.py"
        from copilotkit.crewai import CopilotKitState
        from typing import Literal

        class AgentState(CopilotKitState):
            language: Literal["english", "spanish"] = "english"
```

    ### Use the `useAgent` Hook
    With your agent connected and running all that is left is to call the `useAgent` hook, pass the agent's name, and
    optionally provide an initial state.

```tsx title="ui/app/page.tsx"
    import { useAgent } from "@copilotkit/react-core/v2"; // [!code highlight]

    // Define the agent state type, should match the actual state of your agent
    type AgentState = {
      language: "english" | "spanish";
    }

    function YourMainContent() {
      // [!code highlight:4]
      const { agentState } = useAgent<AgentState>({
        name: "sample_agent",
        initialState: { language: "english" }  // optionally provide an initial state
      });

      // ...

      return (
        // style excluded for brevity
        <div>
          <h1>Your main content</h1>
          {/* [!code highlight:1] */}
          <p>Language: {agentState.language}</p>
        </div>
      );
    }
```
      The `agentState` in `useAgent` is reactive and will automatically update when the agent's state changes.

    ### Give it a try!
    As the agent state updates, your `state` variable will automatically update with it! In this case, you'll see the
    language set to "english" as that's the initial state we set.

## Rendering agent state in the chat

You can also render the agent's state in the chat UI. This is useful for informing the user about the agent's state in a
more in-context way. To do this, you can use the `useAgent` hook with a `render` function.

```tsx title="ui/app/page.tsx"
import { useAgent } from "@copilotkit/react-core/v2"; // [!code highlight]

// Define the agent state type, should match the actual state of your agent
type AgentState = {
  language: "english" | "spanish";
};

function YourMainContent() {
  // ...
  // [!code highlight:7]
  useAgent<AgentState>({
    name: "sample_agent",
    render: ({ agentState }) => {
      if (!agentState.language) return null;
      return <div>Language: {agentState.language}</div>;
    },
  });
  // ...
}
```

  The `agentState` in `useAgent` is reactive and will automatically
  update when the agent's state changes.

## Intermediately Stream and Render Agent State

By default, the CrewAI Flow agent state will only update _between_ CrewAI Flow node transitions --
which means state updates will be discontinuous and delayed.

You likely want to render the agent state as it updates **continuously.**

See **[emit intermediate state](/crewai-flows/shared-state/predictive-state-updates).**

### Writing agent state
- Route: `/crewai-flows/shared-state/in-app-agent-write`
- Source: `docs/content/docs/integrations/crewai-flows/shared-state/in-app-agent-write.mdx`
- Description: Write to agent's state from your application.

This video shows the result of `npx copilotkit@latest init` with the [implementation](#implementation) section applied to it!

## What is this?

This guide shows you how to write to your agent's state from your application.

## When should I use this?

You can use this when you want to provide the user with feedback about what your agent is doing, specifically
when your agent is calling tools. CopilotKit allows you to fully customize how these tools are rendered in the chat.

## Implementation

    ### Run and Connect Your Agent to CopilotKit

    You'll need to run your agent and connect it to CopilotKit before proceeding. If you haven't done so already,
    you can follow the instructions in the [Getting Started](/crewai-flows/quickstart) guide.

    If you don't already have an agent, you can use the [coagent starter](https://github.com/copilotkit/copilotkit/tree/main/examples/coagents-starter-crewai-flows) as a starting point
    as this guide uses it as a starting point.

    ### Define the Agent State
    CrewAI Flows are stateful. As you transition through the flow, that state is updated and available to the next function. For this example,
    let's assume that our agent state looks something like this.

```python title="agent.py"
        from copilotkit.crewai import CopilotKitState
        from typing import Literal

        class AgentState(CopilotKitState):
            language: Literal["english", "spanish"] = "english"
```

    ### Call `setAgentState` function from the `useAgent` hook
    `useAgent` returns a `setAgentState` function that you can use to update the agent state. Calling this
    will update the agent state and trigger a rerender of anything that depends on the agent state.

```tsx title="ui/app/page.tsx"
    import { useAgent } from "@copilotkit/react-core/v2"; // [!code highlight]

    // Define the agent state type, should match the actual state of your agent
    type AgentState = {
      language: "english" | "spanish";
    }

    // Example usage in a pseudo React component
    function YourMainContent() {
      const { agentState, setAgentState } = useAgent<AgentState>({ // [!code highlight]
        name: "sample_agent",
        initialState: { language: "english" }  // optionally provide an initial state
      });

      // ...

      const toggleLanguage = () => {
        setAgentState({ language: agentState.language === "english" ? "spanish" : "english" }); // [!code highlight]
      };

      // ...

      return (
        // style excluded for brevity
        <div>
          <h1>Your main content</h1>
          {/* [!code highlight:2] */}
          <p>Language: {agentState.language}</p>
          <button onClick={toggleLanguage}>Toggle Language</button>
        </div>
      );
    }
```

    ### Give it a try!
    You can now use the `setAgentState` function to update the agent state and `agentState` to read it. Try toggling the language button
    and talking to your agent. You'll see the language change to match the agent's state.

## Advanced Usage

### Re-run the agent with a hint about what's changed

The new agent state will be used next time the agent runs.
If you want to re-run it manually, use the `run` argument on the `useAgent` hook.

The agent will be re-run, and it will get not only the latest updated state, but also a **hint** that can depend on the data delta between the previous and the current state.

```tsx title="ui/app/page.tsx"
import { useAgent } from "@copilotkit/react-core/v2";
import { TextMessage, MessageRole } from "@copilotkit/runtime-client-gql";  // [!code highlight]

// ...

function YourMainContent() {
  // [!code word:run:1]
  const { agentState, setAgentState, run } = useAgent<AgentState>({
    name: "sample_agent",
    initialState: { language: "english" }  // optionally provide an initial state
  });

  // setup to be called when some event in the app occurs
  const toggleLanguage = () => {
    const newLanguage = agentState.language === "english" ? "spanish" : "english";
    setAgentState({ language: newLanguage });

    // re-run the agent and provide a hint about what's changed
    // [!code highlight:6]
    run(({ previousState, currentState }) => {
      return new TextMessage({
        role: MessageRole.User,
        content: `the language has been updated to ${currentState.language}`,
      });
    });
  };

  return (
    // ...
  );
}
```

### Intermediately Stream and Render Agent State

By default, the CrewAI Flow agent state will only update _between_ CrewAI Flow node transitions --
which means state updates will be discontinuous and delayed.

You likely want to render the agent state as it updates **continuously.**

See **[predictive state updates](/crewai-flows/shared-state/predictive-state-updates).**

### Shared State
- Route: `/crewai-flows/shared-state`
- Source: `docs/content/docs/integrations/crewai-flows/shared-state/index.mdx`
- Description: Create a two-way connection between your UI and CrewAI Flow agent state.

## What is shared state?

CoAgents maintain a shared state that seamlessly connects your UI with the agent's execution. This shared state system allows you to:

- Display the agent's current progress and intermediate results
- Update the agent's state through UI interactions
- React to state changes in real-time across your application

The foundation of this system is built on CrewAI's stateful architecture.

## When should I use this?

State streaming is perfect when you want to facilitate collaboration between your agent and the user. Any state that your CrewAI Flow
persists will be automatically shared by the UI. Similarly, any state that the user updates in the UI will be automatically reflected

This allows for a consistent experience where both the agent and the user are on the same page.

### Predictive state updates
- Route: `/crewai-flows/shared-state/predictive-state-updates`
- Source: `docs/content/docs/integrations/crewai-flows/shared-state/predictive-state-updates.mdx`
- Description: Stream in-progress agent state updates to the frontend.

This video shows the result of `npx copilotkit@latest init` with the [implementation](#implementation) section applied to it!

## What is this?

A CrewAI Flow's state updates discontinuosly; only across function transitions in the flow.
But even a _single function_ in the flow often takes many seconds to run and contain sub-steps of interest to the user.

**Agent-native applications** reflect to the end-user what the agent is doing **as continuously possible.**

CopilotKit enables this through its concept of **_predictive state updates_**.

## When should I use this?

You can use this when you want to provide the user with feedback about what your agent is doing, specifically to:

- **Keep users engaged** by avoiding long loading indicators
- **Build trust** by demonstrating what the agent is working on
- Enable **agent steering** - allowing users to course-correct the agent if needed

## Important Note

When a function in your CrewAI flow finishes executing, **its returned state becomes the single source of truth**.
While intermediate state updates are great for real-time feedback, any changes you want to persist must be explicitly
included in the function's final returned state. Otherwise, they will be overwritten when the function completes.

## Implementation

        ### Install the CopilotKit SDK
```bash
    poetry add copilotkit
    # including support for crewai
    poetry add copilotkit[crewai]
```

```bash
    pip install copilotkit --extra-index-url https://copilotkit.gateway.scarf.sh/simple/
    # including support for crewai
    pip install copilotkit[crewai] --extra-index-url https://copilotkit.gateway.scarf.sh/simple/
```

```bash
    conda install copilotkit -c copilotkit-channel
    # including support for crewai
    conda install copilotkit[crewai] -c copilotkit-channel
```

        ### Define the state
        We'll be defining a `observed_steps` field in the state, which will be updated as the agent writes different sections of the report.

```python title="agent.py"
                from copilotkit.crewai import CopilotKitState
                from typing import Literal

                class AgentState(CopilotKitState):
                    observed_steps: list[str]  # Array of completed steps
```
        ### Emit the intermediate state
                        You can either manually emit state updates or configure specific tool calls to emit updates.
                For long-running tasks, you can emit state updates progressively as predictions of the final state. In this example, we simulate a long-running task by executing a series of steps with a one second delay between each update.
```python title="agent.py"
                        from copilotkit.crewai import copilotkit_emit_state # [!code highlight]
                        from crewai.flow.flow import Flow, start
                        import asyncio

                        class SampleAgentFlow(Flow):
                            # ...
                            @start()
                            async def start_flow(self):
                                # ...

                                # Simulate executing steps one by one
                                steps = [
                                    "Analyzing input data...",
                                    "Identifying key patterns...",
                                    "Generating recommendations...",
                                    "Formatting final output..."
                                ]

                                for step in steps:
                                    self.state["observed_steps"] = self.state.get("observed_steps", []) + [step]
                                    await copilotkit_emit_state(self.state) # [!code highlight]
                                    await asyncio.sleep(1)

                            # ...
```

                For long-running tasks, you can configure CopilotKit to automatically predict state updates when specific tool calls are made. In this example, we'll configure CopilotKit to predict state updates whenever the LLM calls the step progress tool.
```python
                        from copilotkit.crewai import copilotkit_predict_state
                        from crewai.flow.flow import Flow, start

                        class SampleAgentFlow(Flow):

                            @start
                            async def start_flow(self):
                                # Tell CopilotKit to treat step progress tool calls as predictive of the final state
                                copilotkit_predict_state({
                                    "observed_steps": {
                                        "tool": "StepProgressTool",
                                        "tool_argument": "steps"
                                    }
                                })

                                step_progress_tool = {
                                    "type": "function",
                                    "function": {
                                        "name": "StepProgressTool",
                                        "description": "Records progress by updating the steps array",
                                        "parameters": {
                                            "type": "object",
                                            "properties": {
                                                "steps": {
                                                    "type": "array",
                                                    "items": {"type": "string"},
                                                    "description": "Array of completed steps"
                                                }
                                            },
                                            "required": ["steps"]
                                        }
                                    }
                                }

                                # Provide the tool to the LLM and call the model
                                response = await copilotkit_stream(
                                    completion(
                                        model="openai/gpt-5.2",
                                        messages=[
                                            {
                                                "role": "system",
                                                "content": "You are a task performer. Pretend doing tasks you are given, report the steps using StepProgressTool." # [!code highlight]
                                            },
                                            *self.state.get("messages", [])
                                        ],
                                        tools=[step_progress_tool],
                                        stream=True
                                    )
                                )
```
        ### Observe the predictions
        These predictions will be emitted as the agent runs, allowing you to track its progress before the final state is determined.

```tsx title="ui/app/page.tsx"
        import { useAgent } from "@copilotkit/react-core/v2";

        // ...

        const YourMainContent = () => {
            // Get access to both predicted and final states
            const { agentState } = useAgent({ name: "sample_agent" });

            // Add a state renderer to observe predictions
            useAgent({
                name: "sample_agent",
                render: ({ agentState }) => {
                    if (!agentState.observed_steps?.length) return null;
                    return (
                        <div>
                            <h3>Current Progress:</h3>
                            <ul>
                                {agentState.observed_steps.map((step, i) => (
                                    <li key={i}>{step}</li>
                                ))}
                            </ul>
                        </div>
                    );
                },
            });

            return (
                <div>
                    <h1>Agent Progress</h1>
                    {agentState.observed_steps?.length > 0 && (
                        <div>
                            <h3>Final Steps:</h3>
                            <ul>
                                {agentState.observed_steps.map((step, i) => (
                                    <li key={i}>{step}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )
        }
```
        ### Give it a try!
        Now you'll notice that the state predictions are emitted as the agent makes progress, giving you insight into its work before the final state is determined.
        You can apply this pattern to any long-running task in your agent.

### Common Copilot Issues
- Route: `/crewai-flows/troubleshooting/common-issues`
- Source: `docs/content/docs/integrations/crewai-flows/troubleshooting/common-issues.mdx`
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
- Route: `/crewai-flows/troubleshooting/error-debugging`
- Source: `docs/content/docs/integrations/crewai-flows/troubleshooting/error-debugging.mdx`
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
- Route: `/crewai-flows/troubleshooting/migrate-to-1.10.X`
- Source: `docs/content/docs/integrations/crewai-flows/troubleshooting/migrate-to-1.10.X.mdx`
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
- Route: `/crewai-flows/troubleshooting/migrate-to-1.8.2`
- Source: `docs/content/docs/integrations/crewai-flows/troubleshooting/migrate-to-1.8.2.mdx`
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
- Route: `/crewai-flows/troubleshooting/migrate-to-v2`
- Source: `docs/content/docs/integrations/crewai-flows/troubleshooting/migrate-to-v2.mdx`
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
