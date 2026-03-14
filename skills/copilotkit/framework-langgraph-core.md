# LangGraph — Core Setup

Core Setup guide for the LangGraph integration.

> For shared CopilotKit concepts (runtime setup, prebuilt components, troubleshooting, etc.), see the topic guides. This file focuses on framework-specific implementation details.

## Guidance
### Prebuilt Components
- Route: `/langgraph/prebuilt-components`
- Source: `docs/content/docs/integrations/langgraph/prebuilt-components.mdx`
- Description: Drop-in chat components for your LangGraph agent.

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
- Route: `/langgraph/programmatic-control`
- Source: `docs/content/docs/integrations/langgraph/programmatic-control.mdx`
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

### Node-Specific State

If your LangGraph agent tracks which node it's in, you can show contextual UI:

```tsx title="page.tsx"
export function NodeStatus() {
  const { agent } = useAgent();

  // [!code highlight:1]
  const currentNode = agent.state.currentNode;

  return (
    <div>
      {/* [!code highlight:6] */}
      {currentNode === "research_node" && (
        <div className="alert">Agent is researching your query...</div>
      )}
      {currentNode === "summarize_node" && (
        <div className="alert">Agent is summarizing findings...</div>
      )}
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

## Handling LangGraph Interrupts

LangGraph's `interrupt()` function emits custom events that you can capture and respond to.

### Simple Interrupt Handler

```tsx title="page.tsx"
import { useEffect } from "react";
import { useAgent } from "@copilotkit/react-core/v2";
import type { AgentSubscriber } from "@ag-ui/client";

export function InterruptHandler() {
  const { agent } = useAgent();

  useEffect(() => {
    const subscriber: AgentSubscriber = {
      // [!code highlight:12]
      onCustomEvent: ({ event }) => {
        if (event.name === "on_interrupt") {
          // LangGraph interrupt() was called
          const response = prompt(event.value);

          if (response) {
            // Resume the agent with the user's response
            agent.runAgent({
              forwardedProps: {
                command: { resume: response },
              },
            });
          }
        }
      },
    };

    const { unsubscribe } = agent.subscribe(subscriber);
    return () => unsubscribe();
  }, []);

  return null;
}
```

### Custom Interrupt UI

For a more sophisticated UI, you can render a custom component:

```tsx title="page.tsx"
import { useEffect, useState } from "react";
import { useAgent } from "@copilotkit/react-core/v2";
import type { AgentSubscriber } from "@ag-ui/client";

export function CustomInterruptHandler() {
  const { agent } = useAgent();
  const [interrupt, setInterrupt] = useState<{ message: string } | null>(null);

  useEffect(() => {
    const subscriber: AgentSubscriber = {
      onCustomEvent: ({ event }) => {
        // [!code highlight:3]
        if (event.name === "on_interrupt") {
          setInterrupt({ message: event.value });
        }
      },
    };

    const { unsubscribe } = agent.subscribe(subscriber);
    return () => unsubscribe();
  }, []);

  const handleResponse = (response: string) => {
    // [!code highlight:5]
    agent.runAgent({
      forwardedProps: {
        command: { resume: response },
      },
    });
    setInterrupt(null);
  };

  if (!interrupt) return null;

  return (
    <div className="interrupt-modal">
      <h3>Agent Needs Your Input</h3>
      <p>{interrupt.message}</p>
      <form onSubmit={(e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        handleResponse(formData.get("response") as string);
      }}>
        <input type="text" name="response" placeholder="Your response" />
        <button type="submit">Submit</button>
      </form>
    </div>
  );
}
```

For a more declarative approach, see [useLangGraphInterrupt](/reference/v1/hooks/useLangGraphInterrupt).

## See Also

- [Shared State](/langgraph/shared-state) - Deep dive into state management
- [Human-in-the-Loop](/langgraph/human-in-the-loop) - Approval workflows
- [Agent App Context](/langgraph/agent-app-context) - Pass context to your agent
- [useAgent API Reference](/reference/v2/hooks/useAgent) - Complete API documentation

### Quickstart
- Route: `/langgraph/quickstart`
- Source: `docs/content/docs/integrations/langgraph/quickstart.mdx`
- Description: Turn your LangGraph into an agent-native application in 10 minutes.

## Prerequisites

Before you begin, you'll need the following:

- An OpenAI API key
- Node.js 20+
- Your favorite package manager
- (Optional) A LangSmith API key - only required if using an existing LangGraph agent

## Getting started

                    You can either start fresh with our starter template or integrate CopilotKit into your existing LangGraph agent.
                ### Run our CLI

                First, we'll use our CLI to create a new project for us. Choose between Python or JavaScript:

```bash
                        npx copilotkit@latest create -f langgraph-py
```
```bash
                        npx copilotkit@latest create -f langgraph-js
```
                ### Install dependencies

```npm
                npm install
```
                ### Configure your environment

                Create a `.env` file in your agent directory and add your OpenAI API key:

```plaintext title=".env"
                OPENAI_API_KEY=your_openai_api_key
```

                  The starter template is configured to use OpenAI's GPT-4o by default, but you can modify it to use any language model supported by LangGraph.
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
              ### Initialize your agent project

              If you don't already have a Python project set up, create one using `uv`:

```bash
              uv init my-agent
              cd my-agent
```
              ### Install LangGraph and AG-UI

              Add LangGraph and the required AG-UI packages to your project:

```bash
              uv add langgraph copilotkit langchain-openai langchain-core
```
            ### Expose your agent via AG-UI

            If you already have a LangGraph agent written, just reference the following code. In this step
            we create a simple LangGraph agent for the sake of demonstration.
                  First, we'll create a simple LangGraph agent:

```python title="main.py"
                  from langchain_core.messages import SystemMessage
                  from langchain_openai import ChatOpenAI
                  from langgraph.graph import END, START, MessagesState, StateGraph

                  async def mock_llm(state: MessagesState):
                    model = ChatOpenAI(model="gpt-4.1-mini")
                    system_message = SystemMessage(content="You are a helpful assistant.")
                    response = await model.ainvoke(
                      [
                        system_message,
                        *state["messages"],
                      ]
                    )
                    return {"messages": response}

                  graph = StateGraph(MessagesState)
                  graph.add_node(mock_llm)
                  graph.add_edge(START, "mock_llm")
                  graph.add_edge("mock_llm", END)
                  graph = graph.compile()
```

                  Then to test and deploy with LangSmith, we'll also need a `langgraph.json`

```sh
                  touch langgraph.json
```

```json title="langgraph.json"
                  {
                    "python_version": "3.12",
                    "dockerfile_lines": [],
                    "dependencies": ["."],
                    "package_manager": "uv",
                    "graphs": {
                      "sample_agent": "./main.py:graph"
                    },
                    "env": ".env"
                  }
```
                  First, add the `ag-ui-langgraph` package to your project:

```bash
                  uv add ag-ui-langgraph fastapi uvicorn copilotkit
```

                  Then create a simple LangGraph agent, add a FastAPI app, and build attach our agent as an AG-UI endpoint.

```python title="main.py"
                  import os

                  # [!code highlight:2]
                  from ag_ui_langgraph import add_langgraph_fastapi_endpoint
                  from copilotkit import LangGraphAGUIAgent
                  from fastapi import FastAPI
                  from langgraph.graph import END, START, MessagesState, StateGraph
                  from langchain_core.messages import SystemMessage
                  from langchain_openai import ChatOpenAI

                  async def mock_llm(state: MessagesState):
                    model = ChatOpenAI(model="gpt-4.1-mini")
                    system_message = SystemMessage(content="You are a helpful assistant.")
                    response = await model.ainvoke(
                      [
                        system_message,
                        *state["messages"],
                      ]
                    )
                    return {"messages": response}

                  graph = StateGraph(MessagesState)
                  graph.add_node(mock_llm)
                  graph.add_edge(START, "mock_llm")
                  graph.add_edge("mock_llm", END)
                  graph = graph.compile()

                  app = FastAPI()

                  # [!code highlight:9]
                  add_langgraph_fastapi_endpoint(
                    app=app,
                    agent=LangGraphAGUIAgent(
                      name="sample_agent",
                      description="An example agent to use as a starting point for your own agent.",
                      graph=graph,
                    ),
                    path="/",
                  )

                  def main():
                    """Run the uvicorn server."""
                    uvicorn.run(
                      "main:app",
                      host="0.0.0.0",
                      port="8123",
                      reload=True,
                    )

                  if __name__ == "__main__":
                    main()
```

                AG-UI is an open protocol for frontend-agent communication.
              ### Configure your environment

              Create a `.env` file in your agent directory and add your OpenAI API key:

```plaintext title=".env"
              OPENAI_API_KEY=your_openai_api_key
```

                The starter template is configured to use OpenAI's GPT-4o by default, but you can modify it to use any language model supported by LangGraph.
              ### Create your frontend

              CopilotKit works with any React-based frontend. We'll use Next.js for this example.

```bash
              npx create-next-app@latest frontend
              cd frontend
```
              ### Install CopilotKit packages

```npm
              npm install @copilotkit/react-ui @copilotkit/react-core @copilotkit/runtime
```
              ### Setup Copilot Runtime

              Create an API route to connect CopilotKit to your LangGraph agent:

```sh
              mkdir -p app/api/copilotkit && touch app/api/copilotkit/route.ts
```

```tsx title="app/api/copilotkit/route.ts"
                  import {
                    CopilotRuntime,
                    ExperimentalEmptyAdapter,
                    copilotRuntimeNextJSAppRouterEndpoint,
                  } from "@copilotkit/runtime";
                  // [!code highlight]
                  import { LangGraphAgent } from "@copilotkit/runtime/langgraph";
                  import { NextRequest } from "next/server";

                  const serviceAdapter = new ExperimentalEmptyAdapter();

                  const runtime = new CopilotRuntime({
                    agents: {
                    // [!code highlight:5]
                      sample_agent: new LangGraphAgent({
                        deploymentUrl:  process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8123",
                        graphId: "sample_agent",
                        langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
                      }),
                    }
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
```tsx title="app/api/copilotkit/route.ts"
                import {
                  CopilotRuntime,
                  ExperimentalEmptyAdapter,
                  copilotRuntimeNextJSAppRouterEndpoint,
                } from "@copilotkit/runtime";
                // [!code highlight]
                import { LangGraphHttpAgent } from "@copilotkit/runtime/langgraph";
                import { NextRequest } from "next/server";

                const serviceAdapter = new ExperimentalEmptyAdapter();

                const runtime = new CopilotRuntime({
                  agents: {
                    // [!code highlight:3]
                    sample_agent: new LangGraphHttpAgent({
                      url:  process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8123",
                    }),
                  }
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
              ### Configure CopilotKit Provider

              Wrap your application with the CopilotKit provider:

```tsx title="app/layout.tsx"
              // [!code highlight:2]
              import { CopilotKit } from "@copilotkit/react-core/v2";
              import "@copilotkit/react-ui/v2/styles.css";

              // ...

              export default function RootLayout({ children }: {children: React.ReactNode}) {
                return (
                  <html lang="en">
                    <body>
                      {/* [!code highlight:3] */}
                      <CopilotKit runtimeUrl="/api/copilotkit" agent="sample_agent">
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
            import { CopilotSidebar } from "@copilotkit/react-core/v2"; // [!code highlight:1]

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
              ### Start your agent
              From your agent directory, start the agent server:

```bash
                  cd ..
                  npx @langchain/langgraph-cli dev --port 8123 --no-browser
```
```bash
                  cd ..
                  uv run main.py
```

              Your agent will be available at `http://localhost:8123`.
              ### Start your UI

              In a separate terminal, navigate to your frontend directory and start the development server:

```bash
                      cd frontend
                      npm run dev
```
```bash
                      cd frontend
                      pnpm dev
```
```bash
                      cd frontend
                      yarn dev
```
```bash
                      cd frontend
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
                - Make sure your agent folder contains a `langgraph.json` file
                - In the `langgraph.json` file, reference the path to a `.env` file
                - Check that your OpenAI API key is correctly set in the `.env` file
                - If using an existing agent, ensure your LangSmith API key is also configured
                - Make sure you're in the same folder as your `langgraph.json` file when running the `langgraph dev` command

## What's next?

Now that you have your basic agent setup, explore these advanced features:
