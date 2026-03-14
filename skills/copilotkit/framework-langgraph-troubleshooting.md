# LangGraph — Troubleshooting & Ops

Troubleshooting & Ops guide for the LangGraph integration.

> For shared CopilotKit concepts (runtime setup, prebuilt components, troubleshooting, etc.), see the topic guides. This file focuses on framework-specific implementation details.

## Guidance
### Common LangGraph issues
- Route: `/langgraph/coagent-troubleshooting/common-coagent-issues`
- Source: `docs/content/docs/integrations/langgraph/coagent-troubleshooting/common-coagent-issues.mdx`
- Description: Common issues you may encounter when using LangGraph.

Welcome to the CoAgents Troubleshooting Guide! If you're having trouble getting tool calls to work, you've come to the right place.

    Have an issue not listed here? Open a ticket on [GitHub](https://github.com/CopilotKit/CopilotKit/issues) or reach out on [Discord](https://discord.com/invite/6dffbvGU3D)
    and we'll be happy to help.

    We also highly encourage any open source contributors that want to add their own troubleshooting issues to [Github as a pull request](https://github.com/CopilotKit/CopilotKit/blob/main/CONTRIBUTING.md).

## My tool calls are not being streamed

This could be due to a few different reasons.

First, we strongly recommend checking out our [Human In the Loop](/langgraph/human-in-the-loop) guide to follow a more in depth example of how to stream tool calls
in your LangGraph agents. You can also check out our [travel tutorial](/langgraph/tutorials/ai-travel-app/step-6-human-in-the-loop) which talks about how to stream
tool calls in a more complex example.

If you have already done that, you can check the following:

            When you invoke your LangGraph agent, you can invoke it synchronously or asynchronously. If you invoke it synchronously,
            the tool calls will not be streamed progressively, only the final result will be streamed. If you invoke it asynchronously,
            the tool calls will be streamed progressively.

```python
            config = copilotkit_customize_config(config, emit_tool_calls=["say_hello_to"])
            response = await llm_with_tools.ainvoke(
                [ SystemMessage(content=system_message), *state["messages"] ],
                config=config
            )
```

## Error: `'AzureOpenAI' object has no attribute 'bind_tools'`

This error is typically due to the use of an incorrect import from LangGraph. Instead of importing `AzureOpenAI` import `AzureChatOpenAI` and your
issue will be resolved.

```python
from langchain_openai import AzureOpenAI # [!code --]
from langchain_openai import AzureChatOpenAI # [!code ++]
```

## I am getting "agent not found" error

If you're seeing this error, it means CopilotKit couldn't find the LangGraph agent you're trying to use. Here's how to fix it:

        If you're using agent lock mode,
        check that the agent defined in `langgraph.json` matches what's defined in the CopilotKit provider:

```json title="langgraph.json"
        {
            "python_version": "3.12",
            "dockerfile_lines": [],
            "dependencies": ["."],
            "graphs": {
                "my_agent": "./src/agent.py:graph"// In this case, "my_agent" is the agent you're using // [!code highlight]
            },
            "env": ".env"
        }
```

```tsx title="layout.tsx"
        {/* [!code highlight:1] */}
        <CopilotKit agent="my_agent">
            {/* Your application components */}
        </CopilotKit>
```

        Common issues:
        - Typos in agent names
        - Case sensitivity mismatches
        - Missing entries in `langgraph.json`
        When using LangGraph Platform endpoint, make sure your agents are properly specified and are following the definition in your `langgraph.json`:

```json title="langgraph.json"
        {
            "python_version": "3.12",
            "dockerfile_lines": [],
            "dependencies": ["."],
            "graphs": {
                "my_agent": "./src/agent.py:graph"// In this case, "my_agent" is the agent you're using // [!code highlight]
            },
            "env": ".env"
        }
```

```typescript title="/copilotkit/api/route.ts"
        const runtime = new CopilotRuntime({
          // ... The rest of your CopilotRuntime definition
          // [!code highlight:7]
          agents: {
            'my_agent': new LangGraphAgent({
              deploymentUrl: '<your-api-url>',
              graphId: 'my_agent',
              langsmithApiKey: '<your-langsmith-api-key>' // Optional
            }),
          },
        });
```
        Make sure the that the agent defined in `langgraph.json` matches what you use n `useCoAgent` hook:

```json title="langgraph.json"
        {
            "python_version": "3.12",
            "dockerfile_lines": [],
            "dependencies": ["."],
            "graphs": {
                "my_agent": "./src/agent.py:graph"// In this case, "my_agent" is the agent you're using // [!code highlight]
            },
            "env": ".env"
        }
```

```tsx title="MyComponent.tsx"
        // Your React component
        useAgent({
            name: "my_agent", // [!code focus] This must match exactly
        });
```
        Make sure the that the agent defined in `langgraph.json` matches what you use in the `useAgent` hook:

```json title="langgraph.json"
        {
            "python_version": "3.12",
            "dockerfile_lines": [],
            "dependencies": ["."],
            "graphs": {
                "my_agent": "./src/agent.py:graph"// In this case, "my_agent" is the agent you're using // [!code highlight]
            },
            "env": ".env"
        }
```

```tsx title="MyComponent.tsx"
        // Your React component
        useCoAgentStateRender({
            name: "my_agent", // [!code focus] This must match exactly
        });
```

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
        - Consider checking with your ISP about any connection restrictions
        - Try using a mobile hotspot

## I am getting "Failed to find or contact remote endpoint at url, Make sure the API is running and that it's indeed a LangGraph platform url" error

If you're seeing this error, it means the LangGraph platform client cannot connect to your endpoint.

        Check the logs for the backend API running on the remote endpoint url. Make sure it is up and ready to receive requests
        Verify that the backend API is running using `langgraph dev`, `langgraph up`, on a LangGraph cloud url or equivalent methods supplied by LangGraph
        If you are running your remote endpoint using FastAPI, even if it uses LangGraph for the agent, it is not considered a LangGraph platform endpoint.
        You may need to change your `remoteEndpoints` definition for this endpoint to match the expected format.

        Change the endpoint definition, from:
```
        new CopilotRuntime({
          remoteEndpoints: [
            langGraphPlatformEndpoint({
            deploymentUrl: "https://your-fastapi-endpoint:port",
            langsmithApiKey: '<langsmith API key>' // optional
            agents: [], // Your previous agents definition
          ],
        });

        // or

        new CopilotRuntime({
          agents: {
            'agent-name': new LangGraphAgent({
              deploymentUrl: "https://your-fastapi-endpoint:port",
              langsmithApiKey: '<langsmith API key>', // optional
              graphId: 'langgraph.json graph id', // Your previous graphId definition
            }),
          }
        });
```

        To:
```
        new CopilotRuntime({
            agents: {
                'agent-name': new LangGraphHttpAgent({
                    url: 'https://your-fastapi-endpoint:port/your-agent-uri'
                }),
            }
        });
```

## I am getting a "No checkpointer set" error when using LangGraph with FastAPI

If you're encountering this error, it means you are missing a checkpointer in your compiled graph.
You can visit the [LangGraph Persistence guide](https://docs.langchain.com/oss/python/langgraph/persistence#checkpoints) to understand what a checkpointer is and how to add it.

## I see messages being streamed and disappear

LangGraph agents are stateful. As a graph is traversed, the state is saved at the end of each node. CopilotKit uses the agent's state as
the source of truth for what to display in the frontend chat. However, since state is only emitted at the end of a node,  CopilotKit allows
you to stream predictive state updates *in the middle of a node*. By default, CopilotKit will stream messages and tool calls being actively
generated to the frontend chat that initiated the interaction. **If this predictive state is not persisted at the end of the node, it will
disappear in the frontend chat**.

In this situation, the most likely scenario is that the `messages` property in the state is being updated in the middle of a node but those edits are not being
persisted at the end of a node.

        To fix this, you can simply persist the messages by returning the new messages at the end of the node.

```python
                from copilotkit.langgraph import copilotkit_customize_config

                async def chat_node(state: AgentState, config: RunnableConfig):
                    # 1) Call the model with CopilotKit's modified config
                    model = ChatOpenAI(model="gpt-5.2")
                    response = await model.ainvoke(state["messages"], modifiedConfig)

                    # 2) Make sure to return the new messages
                    return {
                        messages: response,
                    }
```
```typescript
                import { copilotkitCustomizeConfig } from '@copilotkit/sdk-js/langgraph';

                async function chatNode(state: AgentState, config: RunnableConfig): Promise<AgentState> {
                    // 1) Call the model with CopilotKit's modified config
                    const model = new ChatOpenAI({ temperature: 0, model: "gpt-5.2" });
                    const response = await model.invoke(state.messages, modifiedConfig);

                    // 2) Make sure to return the new messages
                    return {
                        messages: response,
                    }
                }
```
        In this case, you can reference our document on [disabling streaming](/langgraph/advanced/disabling-state-streaming). More specifically,
        you can use the copilotkit config to disable emitting messages anywhere you'd like a message to not be streamed.

```python
                from copilotkit.langgraph import copilotkit_customize_config

                async def chat_node(state: AgentState, config: RunnableConfig):
                    # 1) Configure CopilotKit not to emit messages
                    modifiedConfig = copilotkit_customize_config(
                        config,
                        emit_messages=False, # if you want to disable message streaming
                    )

                    # 2) Call the model with CopilotKit's modified config
                    model = ChatOpenAI(model="gpt-5.2")
                    response = await model.ainvoke(state["messages"], modifiedConfig)

                    # 3) Don't return the new response to hide it from the user
                    return state
```
```typescript
                import { copilotkitCustomizeConfig } from '@copilotkit/sdk-js/langgraph';

                async function chatNode(state: AgentState, config: RunnableConfig): Promise<AgentState> {
                    // 1) Configure CopilotKit not to emit messages
                    const modifiedConfig = copilotkitCustomizeConfig(config, {
                        emitMessages: false, // if you want to disable message streaming
                    });

                    // 2) Call the model with CopilotKit's modified config
                    const model = new ChatOpenAI({ temperature: 0, model: "gpt-5.2" });
                    const response = await model.invoke(state.messages, modifiedConfig);

                    // 3) Don't return the new response to hide it from the user
                    return state;
                }
```

            Just make sure to pass the modified config we defined above as your `RunnableConfig` for the subgraph or langchain!

### Error Debugging & Observability
- Route: `/langgraph/coagent-troubleshooting/error-debugging`
- Source: `docs/content/docs/integrations/langgraph/coagent-troubleshooting/error-debugging.mdx`
- Description: Learn how to debug errors in CopilotKit with dev console and set up error observability for monitoring services.

CopilotKit provides comprehensive error handling capabilities to help you debug issues and monitor your application's behavior. Whether you're developing locally or running in production, CopilotKit offers tools to capture, understand, and resolve errors effectively.

## Quick Start

### Local Development with Dev Console

For local development, enable the dev console to see errors directly in your UI:

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

  The dev console shows error banner directly in your UI, making it easy to spot
  issues during development. **No API key required** for this feature.

### Production Error Observability

For production applications, use error observability hooks to send errors to monitoring services (requires `publicApiKey`):

```tsx
import { CopilotKit } from "@copilotkit/react-core";

export default function App() {
  return (
    <CopilotKit
      runtimeUrl="<your-runtime-url>"
      publicApiKey="ck_pub_your_key" // [!code highlight]
      onError={(errorEvent) => {
        // [!code highlight]
        // Send to your monitoring service
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

  **Need a publicApiKey?** Go to
  [https://cloud.copilotkit.ai](https://cloud.copilotkit.ai) and get one for
  free!

## Error Handling Options

### Dev Console (`showDevConsole`)

The dev console provides immediate visual feedback during development:

```tsx
<CopilotKit runtimeUrl="<your-runtime-url>" showDevConsole={true}>
  {/* Your app */}
</CopilotKit>
```

**Features:**

- ✅ **No API key required** - works with any setup
- ✅ **Visual error banner** - errors appear as banner in your UI
- ✅ **Real-time feedback** - see errors immediately as they occur
- ✅ **Development-focused** - detailed error information for debugging

**Best for:**

- Local development
- Testing and debugging
- Understanding error flows

  Set `showDevConsole={false}` in production to avoid showing error details to
  end users.

### Error Observability (`onError`)

The error observability hooks provide programmatic access to detailed error information for monitoring and analytics:

```tsx
import { CopilotErrorEvent } from "@copilotkit/shared";

<CopilotKit
  publicApiKey="ck_pub_your_key"
  onError={(errorEvent: CopilotErrorEvent) => {
    // Send error data to monitoring services
    switch (errorEvent.type) {
      case "error":
        logToService("Critical error", errorEvent);
        break;
      case "request":
        logToService("Request started", errorEvent);
        break;
      case "response":
        logToService("Response received", errorEvent);
        break;
      case "agent_state":
        logToService("Agent state change", errorEvent);
        break;
    }
  }}
>
  {/* Your app */}
</CopilotKit>;
```

**Features:**

- ✅ **Rich error context** - detailed information about what went wrong
- ✅ **Request/response tracking** - monitor the full conversation flow
- ✅ **Agent state monitoring** - track agent interactions and state changes
- ✅ **Production-ready** - structured data perfect for monitoring services

**Requirements:**

- Requires `publicApiKey` from [Copilot Cloud](https://cloud.copilotkit.ai)
- Part of CopilotKit's enterprise observability offering

  **Note:** Basic error handling works without Cloud. The `onError` hook is
  specifically for **error observability** - sending error data to monitoring
  services like Sentry, DataDog, etc.

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

## Common Error Observability Patterns

### Basic Error Logging

```tsx
<CopilotKit
  publicApiKey="ck_pub_your_key"
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
  publicApiKey="ck_pub_your_key"
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
  publicApiKey="ck_pub_your_key"
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
  showDevConsole={true} // Show visual errors
  onError={(errorEvent) => {
    // Simple console logging for development
    console.log("CopilotKit Event:", errorEvent);
  }}
>
  {/* Your app */}
</CopilotKit>
```

### Production Environment

```tsx
<CopilotKit
  runtimeUrl="https://your-app.com/api/copilotkit"
  publicApiKey={process.env.NEXT_PUBLIC_COPILOTKIT_API_KEY}
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
  {/* Your app */}
</CopilotKit>
```

## Getting Started with Copilot Cloud

To use error observability hooks, you'll need a Copilot Cloud account:

1. **Sign up for free** at [https://cloud.copilotkit.ai](https://cloud.copilotkit.ai)
2. **Get your public API key** from the dashboard
3. **Add it to your environment variables**:
```bash
   NEXT_PUBLIC_COPILOTKIT_API_KEY=ck_pub_your_key_here
```
4. **Use it in your CopilotKit provider**:
```tsx
   <CopilotKit publicApiKey={process.env.NEXT_PUBLIC_COPILOTKIT_API_KEY}>
     {/* Your app */}
   </CopilotKit>
```

  Copilot Cloud is free to get started and provides production-ready
  infrastructure for your AI copilots, including comprehensive error
  observability and monitoring capabilities.

## Best Practices

### ✅ Do

- **Use `showDevConsole={true}` during development** for immediate feedback
- **Set `showDevConsole={false}` in production** to hide errors from users
- **Implement proper error observability** with the `onError` hook for monitoring
- **Monitor error patterns** to identify and fix issues proactively
- **Use structured logging** to make error analysis easier

### ❌ Don't

- **Don't expose detailed errors to end users** in production
- **Don't ignore error events** - they provide valuable debugging information
- **Don't log sensitive data** in error observability hooks
- **Don't block the UI** with error handling logic

## Troubleshooting

### Error Observability Not Working

If your `onError` hook isn't being called:

1. **Check your publicApiKey** - error observability requires a valid API key
2. **Verify the key format** - should start with `ck_pub_`
3. **Ensure the key is set** - check your environment variables
4. **Test with dev console** - use `showDevConsole={true}` to see if errors are occurring

### Dev Console Not Showing

If the dev console isn't displaying errors:

1. **Check showDevConsole setting** - ensure it's set to `true`
2. **Look for console errors** - check browser dev tools for JavaScript errors
3. **Verify error occurrence** - make sure errors are actually happening

## Next Steps

- Learn about [Copilot Cloud features](https://cloud.copilotkit.ai)
- Explore the [CopilotKit reference documentation](/reference/v1/components/CopilotKit)
- Check out [troubleshooting guides](/troubleshooting/common-issues) for common issues

### Migrate from v0.2 to v0.3
- Route: `/langgraph/coagent-troubleshooting/migrate-from-v0.2-to-v0.3`
- Source: `docs/content/docs/integrations/langgraph/coagent-troubleshooting/migrate-from-v0.2-to-v0.3.mdx`
- Description: How to migrate from v0.2 to v0.3.

## What's new in v0.3?

Starting with `v0.3`, we changed how messages are synced between the agent (LangGraph) and CopilotKit. Essentially, both will now share exactly the same message history.

This means that you need to return the messages you want to appear in CopilotKit chat from your LangGraph nodes, for example:

```python
def my_node(state: State, config: RunnableConfig) -> State:
    response = # ... llm call ...
    return {
        "messages": response,
    }
```

All tool messages are now emitted by default, so you don't need to manually call `copilotkit_customize_config` to configure tool call emissions.

## How do I migrate?

1. Make sure to return any messages (tool calls or text messages) you want to be part of the message history from your LangGraph nodes.

2. Optionally, remove manual `copilotkit_customize_config` calls when you want to emit tool calls.

3. If you want to hide tool calls or messages from the chat, use `copilotkit_customize_config` and set `emit_tool_calls` or `emit_messages` to `False`. Make sure to not return these messages in your nodes so they don't become part of the message history.

### Fully Headless UI
- Route: `/langgraph/premium/headless-ui`
- Source: `docs/content/docs/integrations/langgraph/premium/headless-ui.mdx`
- Description: Build a completely custom chat interface from scratch using useAgent and useCopilotKit

## What is this?

A headless UI gives you full control over the chat experience — you bring your own components, layout, and styling while CopilotKit handles agent communication, message management, and streaming. This is built on top of the same primitives (`useAgent` and `useCopilotKit`) covered in [Programmatic Control](/langgraph/programmatic-control).

## When should I use this?

Use headless UI when the [slot system](/langgraph/custom-look-and-feel/slots) isn't enough — for example, when you need a completely different layout, want to embed the chat into an existing UI, or are building a non-chat interface that still communicates with an agent.

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

### Subscribe to agent events

Use `agent.subscribe()` to listen for lifecycle events — useful for showing progress indicators, handling errors, or responding to custom events like LangGraph interrupts.

```tsx title="components/custom-chat.tsx"
import { useEffect, useState } from "react";
import type { AgentSubscriber } from "@ag-ui/client";

export function CustomChat() {
  const { agent } = useAgent();
  const { copilotkit } = useCopilotKit();
  const [interrupt, setInterrupt] = useState<string | null>(null);

  // [!code highlight:16]
  useEffect(() => {
    const subscriber: AgentSubscriber = {
      onCustomEvent: ({ event }) => {
        if (event.name === "on_interrupt") {
          setInterrupt(event.value);
        }
      },
    };

    const { unsubscribe } = agent.subscribe(subscriber);
    return () => unsubscribe();
  }, [agent]);

  const resolveInterrupt = (response: string) => {
    agent.runAgent({
      forwardedProps: { command: { resume: response } },
    });
    setInterrupt(null);
  };

  return (
    <div>
      {/* Messages and input... */}

      {interrupt && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center">
          <div className="bg-white rounded-xl p-6 max-w-md">
            <p className="font-medium mb-4">{interrupt}</p>
            <form onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              resolveInterrupt(formData.get("response") as string);
            }}>
              <input name="response" className="border rounded px-3 py-2 w-full mb-3" />
              <button type="submit" className="bg-blue-500 text-white px-4 py-2 rounded">
                Submit
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
```

### Access shared state

If your LangGraph agent shares state with the frontend, access it via `agent.state`:

```tsx title="components/custom-chat.tsx"
export function AgentDashboard() {
  const { agent } = useAgent();

  // [!code highlight:3]
  const currentNode = agent.state.currentNode;
  const progress = agent.state.progress;
  const results = agent.state.results;

  return (
    <div>
      {currentNode && <div className="text-sm text-gray-500">Current step: {currentNode}</div>}
      {progress && <div className="w-full bg-gray-200 rounded"><div className="bg-blue-500 h-2 rounded" style={{ width: `${progress}%` }} /></div>}
      {results && <pre className="bg-gray-50 p-4 rounded">{JSON.stringify(results, null, 2)}</pre>}
    </div>
  );
}
```

## See Also

- [Programmatic Control](/langgraph/programmatic-control) — Full `useAgent` reference and advanced patterns
- [Component Slots](/langgraph/custom-look-and-feel/slots) — Customize the built-in UI without going fully headless
- [useAgent API Reference](/reference/v2/hooks/useAgent) — Complete API documentation

### Migrate to AG-UI
- Route: `/langgraph/troubleshooting/migrate-to-agui`
- Source: `docs/content/docs/integrations/langgraph/troubleshooting/migrate-to-agui.mdx`
- Description: Migration guide for agents streaming through the AG-UI protocol

AG-UI is the new agent-to-UI protocol used in CopilotKit.
It already integrates with LangGraph agents.

This guide shows how to make the transition.

        ### Change your current `CopilotRuntime` instantiation from
```typescript
        import { langGraphPlatformEndpoint, CopilotRuntime } from "@copilotkit/runtime";

        let runtime = new CopilotRuntime({
            remoteEndpoints: [
                langGraphPlatformEndpoint({
                    deploymentUrl: "https://your-deployment-url",
                    langsmithApiKey: '<langsmith API key>', // optional
                    agents: [], // Your previous agents definition
                })
            ],
        })
```
        To
```typescript
        import { LangGraphAgent, CopilotRuntime } from "@copilotkit/runtime";

        let runtime = new CopilotRuntime({
            agents: {
                'sample_agent': new LangGraphAgent({
                    deploymentUrl: "https://your-deployment-url",
                    langsmithApiKey: '<langsmith API key>', // optional
                    graphId: 'sample_agent', // Identical to what is defined in the `langgraph.json` graphs config.
                }),
            }
        })
```
        And that's it! You're all set!

Assuming your Python agent setup is as follows:
```python
from fastapi import FastAPI
from copilotkit.integrations.fastapi import add_fastapi_endpoint
from copilotkit import CopilotKitRemoteEndpoint, LangGraphAgent
from .agent import graph

app = FastAPI()
sdk = CopilotKitRemoteEndpoint(
    agents=[
        LangGraphAgent(
            name="sample_agent",
            description="my agent",
            graph=graph,
        ),
    ],
)

add_fastapi_endpoint(app, sdk, "/copilotkit")
```

To migrate, import and use the new endpoint initializer and agent classes.
Everything else (mainly your graph) stays the same.

        ### First, migrate your FastAPI endpoint to use the new agent class
```python
        from fastapi import FastAPI
        from copilotkit import LangGraphAGUIAgent
        from ag_ui_langgraph import add_langgraph_fastapi_endpoint
        from .agent import graph

        app = FastAPI()
        add_langgraph_fastapi_endpoint(
            app=app,
            agent=LangGraphAGUIAgent(
                name="sample_agent",
                description="my agent",
                graph=graph,
            ),
            path="/agent/sample_agent" # Agent will be served at this path. Use "/" to mount at root.
        )
```
        ### Then, in your `CopilotRuntime` instantiation, use the new `LangGraphHttpAgent`
```typescript
        let runtime = new CopilotRuntime({
            agents: {
                'sample_agent': new LangGraphHttpAgent({
                    url: "http://localhost:8000/agent/sample_agent",
                }),
            }
        })
```
                The `langgraph_config` option doesn’t exist on the new agent.
                Configure the agent via the `useCoAgent` hook or with the new `config` parameter on the agent class.
