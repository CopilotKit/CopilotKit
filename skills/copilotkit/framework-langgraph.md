# LangGraph Integration

CopilotKit implementation guide for LangGraph.

## Guidance
### Disabling state streaming
- Route: `/langgraph/advanced/disabling-state-streaming`
- Source: `docs/content/docs/integrations/langgraph/advanced/disabling-state-streaming.mdx`
- Description: Granularly control what is streamed to the frontend.

## What is this?
By default, CopilotKit will stream both your state and tool calls to the frontend.
You can disable this by using CopilotKit's custom `RunnableConfig`.

## When should I use this?

Occasionally, you'll want to disable streaming temporarily — for example, the LLM may be
doing something the current user should not see, like emitting tool calls or questions
pertaining to other employees in an HR system.

## Implementation

### Disable all streaming
You can disable all message streaming and tool call streaming by passing `emit_messages=False` and `emit_tool_calls=False` to the CopilotKit config.

```python
        from copilotkit.langgraph import copilotkit_customize_config

        async def frontend_actions_node(state: AgentState, config: RunnableConfig):

            # 1) Configure CopilotKit not to emit messages
            modifiedConfig = copilotkit_customize_config(
                config,
                emit_messages=False, # if you want to disable message streaming # [!code highlight]
                emit_tool_calls=False # if you want to disable tool call streaming # [!code highlight]
            )

            # 2) Provide the actions to the LLM
            model = ChatOpenAI(model="gpt-5.2").bind_tools([
              *state["copilotkit"]["actions"],
              # ... any tools you want to make available to the model
            ])

            # 3) Call the model with CopilotKit's modified config  # [!code highlight]
            response = await model.ainvoke(state["messages"], modifiedConfig) # [!code highlight]

            # don't return the new response to hide it from the user
            return state
```

        In LangGraph Python, the `config` variable in the surrounding namespace is **implicitly** passed into LangChain LLM calls, even when not explicitly provided.

        This is why we create a new variable `modifiedConfig` rather than modifying `config` directly. If we modified `config` itself, it would change the default configuration for all subsequent LLM calls in that namespace.

```python
        # if we override the config variable name with a new value
        config = copilotkit_customize_config(config, ...)

        # it will affect every subsequent LangChain LLM call in the same namespace, even when `config` is not explicitly provided
        response = await model2.ainvoke(*state["messages"]) # implicitly uses the modified config!
```
```typescript
        import { copilotkitCustomizeConfig } from '@copilotkit/sdk-js/langgraph';

        async function frontendActionsNode(state: AgentState, config: RunnableConfig): Promise<AgentState> {
            // 1) Configure CopilotKit not to emit messages
            const modifiedConfig = copilotkitCustomizeConfig(config, {
                emitMessages: false, // if you want to disable message streaming
                emitToolCalls: false, // if you want to disable tool call streaming
            });

            // 2) Provide the actions to the LLM
            const model = new ChatOpenAI({ temperature: 0, model: "gpt-5.2" });
            const modelWithTools = model.bindTools!([
                ...convertActionsToDynamicStructuredTools(state.copilotkit?.actions || []),
                ...tools,
            ]);

            // 3) Call the model with CopilotKit's modified config
            const response = await modelWithTools.invoke(state.messages, modifiedConfig);

            // don't return the new response to hide it from the user
            return state;
        }
```

### Manually emitting messages
- Route: `/langgraph/advanced/emit-messages`
- Source: `docs/content/docs/integrations/langgraph/advanced/emit-messages.mdx`

```python
                from langchain_core.messages import SystemMessage, AIMessage
                from langchain_openai import ChatOpenAI
                from langchain_core.runnables import RunnableConfig
                from copilotkit.langgraph import copilotkit_emit_message # [!code highlight]
                # ...

                async def chat_node(state: AgentState, config: RunnableConfig):
                    model = ChatOpenAI(model="gpt-5.2")

                    # [!code highlight:2]
                    intermediate_message = "Thinking really hard..."
                    await copilotkit_emit_message(config, intermediate_message)

                    # simulate a long running task
                    await asyncio.sleep(2)

                    response = await model.ainvoke([
                        SystemMessage(content="You are a helpful assistant."),
                        *state["messages"]
                    ], config)

                    return Command(
                        goto=END,
                        update={
                            # Make sure to include the emitted message in the messages history # [!code highlight:2]
                            "messages": [AIMessage(content=intermediate_message), response]
                        }
                    )
```
```typescript
                import { AIMessage, SystemMessage } from "@langchain/core/messages";
                import { ChatOpenAI } from "@langchain/openai";
                import { RunnableConfig } from "@langchain/core/runnables";
                import { copilotkitEmitMessage } from "@copilotkit/sdk-js/langgraph"; // [!code highlight]
                // ...

                async function chat_node(state: AgentState, config: RunnableConfig) {
                    const model = new ChatOpenAI({ model: "gpt-5.2" });

                    // [!code highlight:2]
                    const intermediateMessage = "Thinking really hard...";
                    await copilotkitEmitMessage(config, intermediateMessage);

                    // simulate a long-running task
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    const response = await model.invoke([
                        new SystemMessage({content: "You are a helpful assistant."}),
                        ...state.messages
                    ], config);

                    return {
                        // [!code highlight:2]
                        // Make sure to include the emitted message in the messages history
                        messages: [new AIMessage(intermediateMessage), response],
                    };
                }
```

### Exiting the agent loop
- Route: `/langgraph/advanced/exit-agent`
- Source: `docs/content/docs/integrations/langgraph/advanced/exit-agent.mdx`

```python
                from copilotkit.langgraph import (copilotkit_exit)
                # ...
                async def send_email_node(state: EmailAgentState, config: RunnableConfig):
                    """Send an email."""

                    await copilotkit_exit(config) # [!code highlight]

                    # get the last message and cast to ToolMessage
                    last_message = cast(ToolMessage, state["messages"][-1])
                    if last_message.content == "CANCEL":
                        return {
                            "messages": [AIMessage(content="❌ Cancelled sending email.")],
                        }
                    else:
                        return {
                            "messages": [AIMessage(content="✅ Sent email.")],
                        }
```
```typescript
                import { copilotkitExit } from "@copilotkit/sdk-js/langgraph";

                // ...

                async function sendEmailNode(state: EmailAgentState, config: RunnableConfig): Promise<{ messages: any[] }> {
                    // Send an email.

                    await copilotkitExit(config); // [!code highlight]

                    // get the last message and cast to ToolMessage
                    const lastMessage = state.messages[state.messages.length - 1] as ToolMessage;
                    if (lastMessage.content === "CANCEL") {
                        return {
                            messages: [new AIMessage(content="❌ Cancelled sending email.")],
                        }
                    } else {
                        return {
                            messages: [new AIMessage(content="✅ Sent email.")],
                        }
                    }
                }
```

### Loading Agent State
- Route: `/langgraph/advanced/persistence/loading-agent-state`
- Source: `docs/content/docs/integrations/langgraph/advanced/persistence/loading-agent-state.mdx`
- Description: Learn how threadId is used to load previous agent states.

### Setting the threadId

When setting the `threadId` property in CopilotKit, i.e:

  When using LangGraph platform, the `threadId` must be a UUID.

```tsx
<CopilotKit threadId="2140b272-7180-410d-9526-f66210918b13">
  <YourApp />
</CopilotKit>
```

CopilotKit will restore the complete state of the thread, including the messages, from the database. (See [Message Persistence](/langgraph/advanced/persistence/message-persistence) for more details.)

### Loading Agent State

This means that the state of any agent will also be restored. For example:

```tsx
import { useAgent } from "@copilotkit/react-core/v2";

const { agent } = useAgent({ agentId: "research_agent" });

// agent.state will now be the state of research_agent in the thread id given above
```

### Learn More

To learn more about persistence and state in CopilotKit, see:

- [Reading agent state](/langgraph/shared-state/in-app-agent-read)
- [Writing agent state](/langgraph/shared-state/in-app-agent-write)
- [Loading Message History](/langgraph/advanced/persistence/loading-message-history)

### Threads
- Route: `/langgraph/advanced/persistence/loading-message-history`
- Source: `docs/content/docs/integrations/langgraph/advanced/persistence/loading-message-history.mdx`
- Description: Learn how to load chat messages and threads within the CopilotKit framework.

LangGraph supports threads, a way to group messages together and ultimately maintain a continuous chat history. CopilotKit
provides a few different ways to interact with this concept.

This guide assumes you have already gone through the [quickstart](/langgraph/quickstart) guide.

## Loading an Existing Thread

To load an existing thread in CopilotKit, you can simply set the `threadId` property on `` like so.

  When using LangGraph platform, the `threadId` must be a UUID.

```tsx
import { CopilotKit } from "@copilotkit/react-core";

{/* [!code highlight:1] */}
<CopilotKit threadId="37aa68d0-d15b-45ae-afc1-0ba6c3e11353">
  <YourApp />
</CopilotKit>
```

## Dynamically Switching Threads

You can also make the `threadId` dynamic. Once it is set, CopilotKit will load the previous messages for that thread.

```tsx
import { useState } from "react";
import { CopilotKit } from "@copilotkit/react-core";

const Page = () => {
  const [threadId, setThreadId] = useState("af2fa5a4-36bd-4e02-9b55-2580ab584f89"); // [!code highlight]
  return (
    {/* [!code highlight:3] */}
    <CopilotKit threadId={threadId}>
      <YourApp setThreadId={setThreadId} />
    </CopilotKit>
  )
}

const YourApp = ({ setThreadId }) => {
  return (
    {/* [!code highlight:1] */}
    <Button onClick={() => setThreadId("679e8da5-ee9b-41b1-941b-80e0cc73a008")}>
      Change Thread
    </Button>
  )
}
```

## Using setThreadId

CopilotKit will also return the current `threadId` and a `setThreadId` function from the `useCopilotContext` hook. You can use `setThreadId` to change the `threadId`.

```tsx
import { useCopilotContext } from "@copilotkit/react-core/v2";

const ChangeThreadButton = () => {
  const { threadId, setThreadId } = useCopilotContext(); // [!code highlight]
  return (
    {/* [!code highlight:1] */}
    <Button onClick={() => setThreadId("d73c22f3-1f8e-4a93-99db-5c986068d64f")}>
      Change Thread
    </Button>
  )
}
```

### Message Persistence
- Route: `/langgraph/advanced/persistence/message-persistence`
- Source: `docs/content/docs/integrations/langgraph/advanced/persistence/message-persistence.mdx`

To learn about how to load previous messages and agent states, check out the [Loading Message History](/langgraph/advanced/persistence/loading-message-history) and [Loading Agent State](/langgraph/advanced/persistence/loading-agent-state) pages.

To persist LangGraph messages to a database, you can use either `AsyncPostgresSaver` or `AsyncSqliteSaver`. Set up the asynchronous memory by configuring the graph within a lifespan function, as follows:

```python
from fastapi import FastAPI
from contextlib import asynccontextmanager
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from copilotkit import LangGraphAGUIAgent
from ag_ui_langgraph import add_langgraph_fastapi_endpoint

graph = None
@asynccontextmanager
async def lifespan(app: FastAPI):
    async with AsyncPostgresSaver.from_conn_string(
        "postgresql://postgres:postgres@127.0.0.1:5432/postgres"
    ) as checkpointer:
        # NOTE: you need to call .setup() the first time you're using your checkpointer
        await checkpointer.setup()
        # Create an async graph
        graph = workflow.compile(checkpointer=checkpointer)
        yield
        # Create SDK with the graph

app = FastAPI(lifespan=lifespan)

add_langgraph_fastapi_endpoint(
    app=app,
    agent=LangGraphAGUIAgent(
        name="research_agent",
        description="Research agent.",
        graph=graph,
    ),
    path="/agents/research_agent"
)

```

To learn more about persistence in LangGraph, check out the [LangGraph documentation](https://docs.langchain.com/oss/python/langgraph/persistence).

### AG-UI
- Route: `/langgraph/ag-ui`
- Source: `docs/content/docs/integrations/langgraph/ag-ui.mdx`
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

### Readables
- Route: `/langgraph/agent-app-context`
- Source: `docs/content/docs/integrations/langgraph/agent-app-context.mdx`
- Description: Share app specific context with your agent.

One of the most common use cases for CopilotKit is to register app state and context using `useAgentContext`.
This way, you can notify CopilotKit of what is going on in your app in real time.
Some examples might be: the current user, the current page, etc.

This context can then be shared with your LangGraph agent.

## Implementation
    Check out the [Frontend Data documentation](https://docs.copilotkit.ai/direct-to-llm/guides/connect-your-data/frontend) to understand what this is and how to use it.

                ### Add the data to the Copilot

                The `useAgentContext` hook is used to add data as context to the agent.

```tsx title="YourComponent.tsx"
                "use client" // only necessary if you are using Next.js with the App Router. // [!code highlight]
                import { useAgentContext } from "@copilotkit/react-core/v2"; // [!code highlight]
                import { useState } from 'react';

                export function YourComponent() {
                  // Create colleagues state with some sample data
                  const [colleagues, setColleagues] = useState([
                    { id: 1, name: "John Doe", role: "Developer" },
                    { id: 2, name: "Jane Smith", role: "Designer" },
                    { id: 3, name: "Bob Wilson", role: "Product Manager" }
                  ]);

                  // Share context with the agent
                  // [!code highlight:4]
                  useAgentContext({
                    description: "The current user's colleagues",
                    value: colleagues,
                  });
                  return (
                    // Your custom UI component
                    <>...</>
                  );
                }
```

                ### Set up your agent state
                Make sure your agent state inherits from CopilotKit state definition

```python title="agent.py"
                        # ...
                        from copilotkit import CopilotKitState # extends MessagesState
                        # ...

                        # This is the state of the agent.
                        # It inherits from the CopilotKitState properties from CopilotKit.
                        class AgentState(CopilotKitState):
                            # ... Your defined state properties
```
```typescript title="agent-js/src/agent.ts"
                        // ...
                        import { Annotation } from "@langchain/langgraph";
                        import { CopilotKitStateAnnotation } from "@copilotkit/sdk-js/langgraph";
                        // ...

                        // This is the state of the agent.
                        // It inherits from the CopilotKitState properties from CopilotKit.
                        export const AgentStateAnnotation = Annotation.Root({
                          // ... Your defined state properties
                          ...CopilotKitStateAnnotation.spec,
                        });
                        export type AgentState = typeof AgentStateAnnotation.State;
```

                ### Consume the data in your LangGraph agent
                The state of a LangGraph agent is the "hub" for applicative information used by the agent.
                Naturally, the context from CopilotKit will be injected there.

```python title="agent.py"
                        from langchain_core.messages import SystemMessage
                        from langchain_openai import ChatOpenAI
                        from copilotkit import CopilotKitState

                        # add the agent state definition from the previous step
                        class AgentState(CopilotKitState):
                            # ... Your defined state properties

                        def chat_node(state: AgentState, config: RunnableConfig):
                            # Extract the colleagues from CopilotKit context
                            colleagues_context_item = next(
                                (item for item in state["copilotkit"]["context"] if item.get("description") == "The current user's colleagues"),
                                None
                            )
                            colleagues = colleagues_context_item.get("value") if colleagues_context_item else []

                            # Provide the list of colleagues to the LLM
                            system_message = SystemMessage(
                                content=f"""You are a helpful assistant that can help emailing colleagues.
                                The user's colleagues are: {colleagues}"""
                            )

                            response = ChatOpenAI(model="gpt-5.2").invoke(
                                [system_message, *state["messages"]],
                                config
                            )

                            return {
                                **state,
                                "messages": response,
                            }
```
```typescript title="agent-js/src/agent.ts"
                        import { SystemMessage } from "@langchain/core/messages";
                        import { ChatOpenAI } from "@langchain/openai";

                        // add the agent state definition from the previous step
                        export const AgentStateAnnotation = Annotation.Root({
                          // ... Your defined state properties
                          ...CopilotKitStateAnnotation.spec,
                        });
                        export type AgentState = typeof AgentStateAnnotation.State;

                        async function chat_node(state: AgentState, config: RunnableConfig) {
                          // Extract the colleagues from CopilotKit context
                          const copilotKitContext = state.copilotKit.context
                          const colleaguesContextItem = copilotKitContext.find(contextItem => contextItem.description === 'The current user\'s colleagues"')

                          // Provide the list of colleagues to the LLM
                          const systemMessage = new SystemMessage({
                            content: `
                              You are a helpful assistant that can help emailing colleagues.
                              The user's colleagues are: ${colleaguesContextItem.value}
                            `,
                          });

                          const response = await new ChatOpenAI({ model: "gpt-5.2" }).invoke(
                            [systemMessage, ...state.messages],
                            config
                          );

                          return {
                            ...state,
                            messages: response,
                          };
                        }
```

                ### Give it a try!
                Ask your agent a question about the context. It should be able to answer!
                ### Add the data to the Copilot

                The `useAgentContext` hook is used to add data as context to the agent.

```tsx title="YourComponent.tsx"
                "use client" // only necessary if you are using Next.js with the App Router. // [!code highlight]
                import { useAgentContext } from "@copilotkit/react-core/v2"; // [!code highlight]
                import { useState } from 'react';

                export function YourComponent() {
                  // Create colleagues state with some sample data
                  const [colleagues, setColleagues] = useState([
                    { id: 1, name: "John Doe", role: "Developer" },
                    { id: 2, name: "Jane Smith", role: "Designer" },
                    { id: 3, name: "Bob Wilson", role: "Product Manager" }
                  ]);

                  // Share context with the agent
                  // [!code highlight:4]
                  useAgentContext({
                    description: "The current user's colleagues",
                    value: colleagues,
                  });
                  return (
                    // Your custom UI component
                    <>...</>
                  );
                }
```

                ### Consume the data in your LangGraph agent
                The state of a LangGraph agent is the "hub" for applicative information used by the agent.
                Naturally, the context from CopilotKit will be injected there.
                In addition, the CopilotKitMiddleware is what takes context, and passes it on to your agent

```python title="agent.py"
                        from langchain.agents import create_agent
                        from copilotkit import CopilotKitMiddleware, CopilotKitState # [!code highlight]

                        graph = create_agent( # Works the same for "create_react_agent" or similar options
                            model="openai:gpt-5.2",
                            tools=[],  # Backend tools go here
                            middleware=[CopilotKitMiddleware()], # [!code highlight]
                            system_prompt="You are a helpful assistant.",
                            state_schema=CopilotKitState # [!code highlight]
                        )
```
```typescript title="agent-js/src/agent.ts"
                        import { createAgent } from "langchain";
                        import { copilotkitMiddleware } from "@copilotkit/sdk-js/langgraph"; // [!code highlight]

                        export const agenticChatGraph = createAgent({ // Works the same for "create_react_agent" or similar options
                          model: "openai:gpt-5.2",
                          tools: [],  // Backend tools go here
                          middleware: [copilotkitMiddleware], // [!code highlight]
                          systemPrompt: "You are a helpful assistant.",
                        });
```

                ### Give it a try!
                Ask your agent a question about the context. It should be able to answer!

### Authentication
- Route: `/langgraph/auth`
- Source: `docs/content/docs/integrations/langgraph/auth.mdx`
- Description: Secure your LangGraph agents with user authentication (Platform & Self-hosted)

## Overview

CopilotKit supports user authentication for LangGraph agents in two deployment modes:

- **LangGraph Platform**: Uses built-in authentication with `@auth.authenticate` decorator
- **Self-hosted**: Uses dynamic agent configuration to pass authentication context

Both approaches enable your agents to access authenticated user context and implement proper authorization.

## How It Works

```mermaid
sequenceDiagram
    participant Frontend
    participant CopilotKit
    participant LangGraphAgent
    participant Agent

    Frontend->>CopilotKit: authorization: "user-token"
    CopilotKit->>LangGraphAgent: Forward auth token
    LangGraphAgent->>Agent: user info via config
    Agent->>Agent: Access authenticated user context
```

## Frontend Setup

Pass your authentication token via the `properties` prop:

```tsx
<CopilotKit
  runtimeUrl="/api/copilotkit"
  properties={{
    authorization: userToken, // Forwarded as Bearer token
  }}
>
  <YourApp />
</CopilotKit>
```

**Note**: For LangGraph Platform, the `authorization` property is forwarded as a Bearer token.

## LangGraph Platform Deployment

**For agents deployed to LangGraph Platform**, authentication works out of the box with the `@auth.authenticate` decorator.

### Setup Authentication Handler

```python
# auth.py in your LangGraph Platform deployment
from langgraph_sdk import Auth

auth = Auth()

@auth.authenticate
async def authenticate(authorization: str | None):
    if not authorization or not authorization.startswith("Bearer "):
        raise Auth.exceptions.HTTPException(status_code=401, detail="Unauthorized")

    token = authorization.replace("Bearer ", "")
    user_info = validate_your_token(token)  # Your validation logic

    return {
        "identity": user_info["user_id"],
        "role": user_info.get("role"),
        "permissions": user_info.get("permissions", [])
    }
```

### Access User in Agent

```python
async def my_agent_node(state: AgentState, config: RunnableConfig):
    # Access user from LangGraph Platform authentication
    user_info = config["configuration"]["langgraph_auth_user"]
    user_id = user_info["identity"]
    user_role = user_info.get("role")

    # Your agent logic with user context
    return state
```

For complete implementation details, see the [LangGraph Platform Authentication documentation](https://docs.langchain.com/langsmith/auth#authentication).

## Self-hosted Deployment

**For self-hosted agents**, you need to manually configure authentication context through dynamic agent creation.

### Setup Dynamic Agent Configuration

```python
# demo.py - Configure agent with authentication context
from copilotkit import CopilotKitRemoteEndpoint, LangGraphAgent

sdk = CopilotKitRemoteEndpoint(
    agents=lambda context: [
        LangGraphAgent(
            name="sample_agent",
            description="Agent with authentication support",
            graph=graph,
            langgraph_config={
                "configurable": {
                    "copilotkit_auth": context["properties"].get("authorization")
                }
            }
        )
    ],
)
```

### Access User in Agent

```python
async def my_agent_node(state: AgentState, config: RunnableConfig):
    # Handle authentication for self-hosted mode
    auth_token = config["configurable"].get("copilotkit_auth")
    if auth_token:
        user_info = validate_your_token(auth_token)
        user_id = user_info["user_id"]
        user_role = user_info.get("role")
    else:
        user_id = "anonymous"
        user_role = None

    # Your agent logic with user context
    return state
```

## Universal Authentication Pattern

For agents that work in both environments, use this pattern:

```python
async def my_agent_node(state: AgentState, config: RunnableConfig):
    user_id = "anonymous"
    user_role = None

    # LangGraph Platform mode
    if "configuration" in config and "langgraph_auth_user" in config["configuration"]:
        user_info = config["configuration"]["langgraph_auth_user"]
        user_id = user_info["identity"]
        user_role = user_info.get("role")

    # Self-hosted mode
    elif "configurable" in config and "copilotkit_auth" in config["configurable"]:
        auth_token = config["configurable"]["copilotkit_auth"]
        if auth_token:
            user_info = validate_your_token(auth_token)
            user_id = user_info["user_id"]
            user_role = user_info.get("role")

    # Your agent logic with user context
    return state
```

## Security Notes

### LangGraph Platform

- **Token Validation**: Automatic validation via `@auth.authenticate` handler
- **Built-in Security**: LangGraph Platform handles token parsing and validation
- **User Scoping**: Use authorization handlers to scope resources to authenticated users

### Self-hosted

- **Manual Validation**: You must implement token validation in your agent logic
- **Context Passing**: Authentication context passed through agent configuration
- **Security Responsibility**: Ensure proper token validation and user scoping

### General Best Practices

- **Permission Checks**: Implement role-based access control in your agents
- **Token Security**: Use secure token generation and validation
- **User Scoping**: Always scope data access to authenticated users

For comprehensive authentication patterns, authorization handlers, and security best practices, refer to the [LangGraph Platform Authentication documentation](https://docs.langchain.com/langsmith/auth#authentication).

## Troubleshooting

### Common Issues

**Token not reaching agent**:

- Ensure you're passing `authorization` in the `properties` prop
- For self-hosted: Verify dynamic agent configuration is set up correctly

**Invalid token format**:

- CopilotKit automatically adds the `Bearer ` prefix for LangGraph Platform
- For self-hosted: Handle token format in your validation logic

**User info not available**:

- **LangGraph Platform**: Verify your `@auth.authenticate` handler is properly configured
- **Self-hosted**: Check that `copilotkit_auth` is properly passed in `langgraph_config`

**Authentication works locally but not in production**:

- Ensure you're using the correct deployment mode (LangGraph Platform vs self-hosted)
- Verify environment-specific configuration differences

## Next Steps

- [Configure your LangGraph Platform deployment →](/langgraph/quickstart)
- [Learn about agent state management →](/langgraph/shared-state)
- [Implement human-in-the-loop workflows →](/langgraph/human-in-the-loop)

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

### Coding Agents
- Route: `/langgraph/coding-agents`
- Source: `docs/content/docs/integrations/langgraph/coding-agents.mdx`
- Description: Use our MCP server to connect your LangGraph agents to CopilotKit.

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

### Configurable
- Route: `/langgraph/configurable`
- Source: `docs/content/docs/integrations/langgraph/configurable.mdx`
- Description: Using agent execution parameters when communicating with an agent.

## What is this?
LangGraph agents are able to take execution parameters, such as auth tokens and similar properties.
You can add these using this feature.

If you wish to read further, you can refer to [the configuration guide by LangGraph](https://docs.langchain.com/oss/python/langgraph/graph-api#add-runtime-configuration)

## When should I use this?

This is useful when you want to send execution-time configuration information (such as different tokens or metadata for a given session) that should not be part of the agent state.

## Implementation

By default, LangGraph agents are invoked with a `config` argument. This config has a `configurable` property which can be accessed and filled with your data.

### Pass configuration from the frontend
First, pass the configuration properties as you would like to receive them in the agent

```tsx title="app/page.tsx"
import { useAgent } from "@copilotkit/react-core/v2"; // [!code highlight]

function YourMainContent() {
  // ...

  // [!code highlight:3]
  const { agent } = useAgent({
    agentId: "sample_agent",
  });

  // Pass configuration when running the agent
  // [!code highlight:8]
  agent.runAgent({
    forwardedProps: {
      config: {
        configurable: {
          authToken: 'example-token'
        },
        recursion_limit: 50,
      }
    }
  });

  // ...

  return (... your component UI markdown)
}
```
### Use configurables in agent
Now you can simply pull the values from the provided config argument in any agent node

```python
        async def agent_node(state: AgentState, config: RunnableConfig):

            auth_token = config['configurable'].get('authToken', None)

            return state
```
```typescript
        async function agentNode(state: AgentState, config: RunnableConfig): Promise<AgentState> {
            const authToken = config.configurable?.authToken ?? null;

            return state;
        }
```
    ### Optional: Define configurables schema
    If you'd like, you can define a schema to indicate which configurables you wish to receive.
    Any item passed to "configurables" which is not included in the schema, will be filtered out.

    You can read more about this [here](https://docs.langchain.com/oss/python/langgraph/graph-api#add-runtime-configuration%23define-graph).
```python
            from typing import TypedDict

            # define which properties will be allowed in the configuration
            class ConfigSchema(TypedDict):
              authToken: str

            # ...add all necessary graph nodes

            # when defining the state graph, apply the config schema
            workflow = StateGraph(AgentState, config_schema=ConfigSchema)
```
```typescript
            import { Annotation } from "@langchain/langgraph";

            // define which properties will be allowed in the configuration
            export const ConfigSchemaAnnotation = Annotation.Root({
              authToken: Annotation<string>
            })

            // ...add all necessary graph nodes

            // when defining the state graph, apply the config schema
            const workflow = new StateGraph(AgentStateAnnotation, ConfigSchemaAnnotation)
```

### Copilot Runtime
- Route: `/langgraph/copilot-runtime`
- Source: `docs/content/docs/integrations/langgraph/copilot-runtime.mdx`
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

### Headless UI
- Route: `/langgraph/custom-look-and-feel/headless-ui`
- Source: `docs/content/docs/integrations/langgraph/custom-look-and-feel/headless-ui.mdx`
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

### Slots
- Route: `/langgraph/custom-look-and-feel/slots`
- Source: `docs/content/docs/integrations/langgraph/custom-look-and-feel/slots.mdx`
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

### Deep Agents
- Route: `/langgraph/deep-agents`
- Source: `docs/content/docs/integrations/langgraph/deep-agents.mdx`
- Description: Leverage LangGraph Deep Agents to build sophisticated agentic applications.

## Prerequisites

Before you begin, you'll need the following:

- An OpenAI API key
- Node.js 20+
- Your favorite package manager
- A LangSmith API key - only required if deploying to LangSmith Platform

## Getting started
        ### Initialize your agent project

        If you don't already have a Python project set up, create one using `uv`:

```bash
        uv init my-agent
        cd my-agent
```
        ### Add necessary dependencies

        For this agent, we'll just need the `deepagents`, `langchain-openai`, and `copilotkit` packages:

```bash
        uv add deepagents copilotkit langchain-openai
```
        If you already have a LangGraph agent written, just reference the following code. In this step
        we create a simple LangGraph agent for the sake of demonstration.

                First, we'll create a simple LangGraph agent:

```python title="main.py"
                from deepagents import create_deep_agent
                from copilotkit import CopilotKitMiddleware
                from langgraph.checkpoint.memory import MemorySaver

                def get_weather(location: str):
                    """Get weather for a location"""
                    return f"The weather in {location} is sunny."

                agent = create_deep_agent(
                    model="openai:gpt-5.2",
                    tools=[get_weather],
                    middleware=[CopilotKitMiddleware()], # for frontend tools and context
                    system_prompt="You are a helpful research assistant.",
                    checkpointer=MemorySaver()
                )
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
                        "sample_agent": "./main.py:agent"
                    },
                    "env": ".env"
                }
```
                First, add the `ag-ui-langgraph`, `fastapi`, and `uvicorn` packages to your project:

```bash
                uv add ag-ui-langgraph fastapi uvicorn
```

                Then create a simple LangGraph agent, add a FastAPI app, and build attach our agent as an AG-UI endpoint.

```python title="main.py"
                import os

                # [!code highlight:2]
                from ag_ui_langgraph import add_langgraph_fastapi_endpoint
                from copilotkit import CopilotKitMiddleware, CopilotKitState, LangGraphAGUIAgent
                from deepagents import create_deep_agent
                from langgraph.checkpoint.memory import MemorySaver

                def get_weather(location: str):
                    """Get weather for a location"""
                    return f"The weather in {location} is sunny."

                agent = create_deep_agent(
                    model="openai:gpt-5.2",
                    tools=[get_weather],
                    middleware=[CopilotKitMiddleware()], # for frontend tools and context
                    system_prompt="You are a helpful research assistant.",
                    checkpointer=MemorySaver()
                )

                # [!code highlight:9]
                add_langgraph_fastapi_endpoint(
                    app=app,
                    agent=LangGraphAGUIAgent(
                        name="sample_agent",
                        description="An example agent to use as a starting point for your own agent.",
                        graph=agent,
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
    "use client";

    import { CopilotSidebar } from "@copilotkit/react-core/v2";
    import { useDefaultTool } from "@copilotkit/react-core/v2";

    export default function Page() {
        useDefaultTool({
        render: ({name, status, args, result}) => (
            <details>
                <summary>
                    {status === "complete"? `Called ${name}` : `Calling ${name}`}
                </summary>

                <p>Status: {status}</p>
                <p>Args: {JSON.stringify(args)}</p>
                <p>Result: {JSON.stringify(result)}</p>
            </details>
        )})

        return (
            <main>
                <h1>Your App</h1>
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

### Frontend Tools
- Route: `/langgraph/frontend-tools`
- Source: `docs/content/docs/integrations/langgraph/frontend-tools.mdx`
- Description: Create frontend tools and use them within your LangGraph agent.

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
```python title="agent.py"
                from copilotkit import CopilotKitState # [!code highlight]

                class YourAgentState(CopilotKitState): # [!code highlight]
                    your_additional_properties: str
```
```typescript title="agent-js/src/agent.ts"
                import { Annotation } from "@langchain/langgraph";
                import { CopilotKitStateAnnotation } from "@copilotkit/sdk-js/langgraph"; // [!code highlight]

                export const YourAgentStateAnnotation = Annotation.Root({
                    yourAdditionalProperty: Annotation<string>,
                    ...CopilotKitStateAnnotation.spec, // [!code highlight]
                });
                export type YourAgentState = typeof YourAgentStateAnnotation.State;
```

### State Rendering
- Route: `/langgraph/generative-ui/state-rendering`
- Source: `docs/content/docs/integrations/langgraph/generative-ui/state-rendering.mdx`
- Description: Render your agent's state with custom UI components in real-time.

```python title="agent.py"
          from copilotkit import CopilotKitState

          class AgentState(CopilotKitState):
              searches: list[dict]
```
```typescript title="agent-js/src/agent.ts"
          import { Annotation } from "@langchain/langgraph";
          import { CopilotKitStateAnnotation } from "@copilotkit/sdk-js/langgraph";

          export const AgentStateAnnotation = Annotation.Root({
            searches: Annotation<{ query: string; done: boolean }[]>,
            ...CopilotKitStateAnnotation.spec,
          });
          export type AgentState = typeof AgentStateAnnotation.State;
```
```python title="agent.py"
        import asyncio
        from copilotkit.langgraph import copilotkit_emit_state # [!code highlight]

        async def chat_node(state: AgentState, config: RunnableConfig):
            state["searches"] = [
                {"query": "Initial research", "done": False},
                {"query": "Retrieving sources", "done": False},
                {"query": "Forming an answer", "done": False},
            ]
            await copilotkit_emit_state(config, state) # [!code highlight]

            for search in state["searches"]:
                await asyncio.sleep(1)
                search["done"] = True
                await copilotkit_emit_state(config, state) # [!code highlight]

            response = await ChatOpenAI(model="gpt-5.2").ainvoke(
                [SystemMessage(content="You are a helpful assistant."), *state["messages"]],
                config,
            )
            return {**state, "messages": response}
```
```typescript title="agent-js/src/agent.ts"
        import { copilotkitEmitState } from "@copilotkit/sdk-js/langgraph"; // [!code highlight]

        async function chat_node(state: AgentState, config: RunnableConfig) {
          state.searches = [
            { query: "Initial research", done: false },
            { query: "Retrieving sources", done: false },
            { query: "Forming an answer", done: false },
          ];
          await copilotkitEmitState(config, state); // [!code highlight]

          for (const search of state.searches) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            search.done = true;
            await copilotkitEmitState(config, state); // [!code highlight]
          }

          const response = await new ChatOpenAI({ model: "gpt-5.2" }).invoke(
            [new SystemMessage("You are a helpful assistant."), ...state.messages],
            config,
          );
          return { ...state, messages: response };
        }
```
```tsx title="app/page.tsx"
    import { useAgent } from "@copilotkit/react-core/v2"; // [!code highlight]

    function YourMainContent() {
      // [!code highlight:3]
      const { agent } = useAgent({
        agentId: "sample_agent",
      });

      const searches = agent.state.searches as { query: string; done: boolean }[] ?? [];

      return (
        <div>
          {searches.map((search, index) => (
            <div key={index}>
              {search.done ? "✅" : "⏳"} {search.query}
            </div>
          ))}
        </div>
      );
    }
```

### Tool Rendering
- Route: `/langgraph/generative-ui/tool-rendering`
- Source: `docs/content/docs/integrations/langgraph/generative-ui/tool-rendering.mdx`
- Description: Render your agent's tool calls with custom UI components.

```python title="agent.py"
        from langchain_openai import ChatOpenAI
        from langchain.tools import tool
        # ...

        # [!code highlight:6]
        @tool
        def get_weather(location: str):
            """
            Get the weather for a given location.
            """
            return f"The weather for {location} is 70 degrees."

        # ...

        async def chat_node(state: AgentState, config: RunnableConfig):
            model = ChatOpenAI(model="gpt-5.2")
            model_with_tools = model.bind_tools([get_weather]) # [!code highlight]

            response = await model_with_tools.ainvoke([
                SystemMessage(content=f"You are a helpful assistant."),
                *state["messages"],
            ], config)

            # ...
```
```typescript title="agent-js/src/agent.ts"
        import { ChatOpenAI } from "@langchain/openai";
        import { tool } from "@langchain/core/tools";
        import { z } from "zod";

        // [!code highlight:12]
        const get_weather = tool(
          (args) => {
            return `The weather for ${args.location} is 70 degrees.`;
          },
          {
            name: "get_weather",
            description: "Get the weather for a given location.",
            schema: z.object({
              location: z.string().describe("The location to get weather for"),
            }),
          }
        );

        async function chat_node(state: AgentState, config: RunnableConfig) {
          const model = new ChatOpenAI({ temperature: 0, model: "gpt-5.2" });
          const modelWithTools = model.bindTools([get_weather]); // [!code highlight]

          const response = await modelWithTools.invoke([
            new SystemMessage("You are a helpful assistant."),
            ...state.messages,
          ], config);

          // ...
        }
```
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
- Route: `/langgraph/generative-ui/your-components/display-only`
- Source: `docs/content/docs/integrations/langgraph/generative-ui/your-components/display-only.mdx`
- Description: Register React components that your agent can render in the chat.

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
```python title="agent.py"
        from copilotkit import CopilotKitState # [!code highlight]

        class AgentState(CopilotKitState): # [!code highlight]
            pass
```
```typescript title="agent-js/src/agent.ts"
        import { Annotation } from "@langchain/langgraph";
        import { CopilotKitStateAnnotation } from "@copilotkit/sdk-js/langgraph"; // [!code highlight]

        export const AgentStateAnnotation = Annotation.Root({
          ...CopilotKitStateAnnotation.spec, // [!code highlight]
        });
        export type AgentState = typeof AgentStateAnnotation.State;
```
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
```tsx
useComponent({
  name: "renderProfile",
  parameters: z.object({ userId: z.string() }),
  render: ProfileCard,
  agentId: "support-agent",
});
```

### Interactive
- Route: `/langgraph/generative-ui/your-components/interactive`
- Source: `docs/content/docs/integrations/langgraph/generative-ui/your-components/interactive.mdx`
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
```python title="agent.py"
                from copilotkit import CopilotKitState # [!code highlight]

                class YourAgentState(CopilotKitState): # [!code highlight]
                    your_additional_properties: str
```
```typescript title="agent-js/src/agent.ts"
                import { Annotation } from "@langchain/langgraph";
                import { CopilotKitStateAnnotation } from "@copilotkit/sdk-js/langgraph"; // [!code highlight]

                export const YourAgentStateAnnotation = Annotation.Root({
                    yourAdditionalProperty: Annotation<string>,
                    ...CopilotKitStateAnnotation.spec, // [!code highlight]
                });
                export type YourAgentState = typeof YourAgentStateAnnotation.State;
```

### Interrupt-based
- Route: `/langgraph/generative-ui/your-components/interrupt-based`
- Source: `docs/content/docs/integrations/langgraph/generative-ui/your-components/interrupt-based.mdx`
- Description: Learn how to implement Human-in-the-Loop (HITL) using a interrupt-based flow.

This example demonstrates interrupt-based human-in-the-loop (HITL) in the [CopilotKit Feature Viewer](https://feature-viewer.copilotkit.ai/langgraph/feature/human_in_the_loop).

## What is this?

[LangGraph's interrupt flow](https://docs.langchain.com/oss/python/langgraph/interrupts) provides an intuitive way to implement Human-in-the-loop workflows.

This guide will show you how to both use `interrupt` and how to integrate it with CopilotKit.

## When should I use this?

Human-in-the-loop is a powerful way to implement complex workflows that are production ready. By having a human in the loop,
you can ensure that the agent is always making the right decisions and ultimately is being steered in the right direction.

Interrupt-based flows are a very intuitive way to implement HITL. Instead of having a node await user input before or after its execution,
nodes can be interrupted in the middle of their execution to allow for user input. The trade-off is that the agent is not aware of the
interaction, however [CopilotKit's SDKs provide helpers to alleviate this](#make-your-agent-aware-of-interruptions).

## Implementation

  ### Run and connect your agent

You'll need to run your agent and connect it to CopilotKit before proceeding.

If you don't already have CopilotKit and your agent connected, choose one of the following options:

    You can follow the instructions in the [quickstart](/langgraph/quickstart) guide.
    Run the following command to create a brand new project with a pre-configured agent:

```bash
        npx copilotkit@latest create -f langgraph-py
```
```bash
       npx copilotkit@latest create -f langgraph-js
```

  ### Install the CopilotKit SDK

Any LangGraph agent can be used with CopilotKit. However, creating deep agentic
experiences with CopilotKit requires our LangGraph SDK.

```bash
    uv add copilotkit
```
```bash
    poetry add copilotkit
```

```bash
    pip install copilotkit --extra-index-url https://copilotkit.gateway.scarf.sh/simple/
```

```bash
    conda install copilotkit -c copilotkit-channel
```

```npm
    npm install @copilotkit/sdk-js
```

### Set up your agent state
We're going to have the agent ask us to name it, so we'll need a state property to store the name.

```python title="agent.py"
        # ...
        from copilotkit import CopilotKitState # extends MessagesState
        # ...

        # This is the state of the agent.
        # It inherits from the CopilotKitState properties from CopilotKit.
        class AgentState(CopilotKitState):
            agent_name: str
```
```typescript title="agent-js/src/agent.ts"
        // ...
        import { Annotation } from "@langchain/langgraph";
        import { CopilotKitStateAnnotation } from "@copilotkit/sdk-js/langgraph";
        // ...

        // This is the state of the agent.
        // It inherits from the CopilotKitState properties from CopilotKit.
        export const AgentStateAnnotation = Annotation.Root({
          agentName: Annotation<string>,
          ...CopilotKitStateAnnotation.spec,
        });
        export type AgentState = typeof AgentStateAnnotation.State;
```

    ### Call `interrupt` in your LangGraph agent
    Now we can call `interrupt` in our LangGraph agent.

        Your agent will not be aware of the `interrupt` interaction by default in LangGraph.

        If you want this behavior, see the [section on it below](#make-your-agent-aware-of-interruptions).

```python title="agent.py"
            from langgraph.types import interrupt # [!code highlight]
            from langchain_core.messages import SystemMessage
            from langchain_openai import ChatOpenAI
            from copilotkit import CopilotKitState

            # add the agent state definition from the previous step
            class AgentState(CopilotKitState):
                agent_name: str

            def chat_node(state: AgentState, config: RunnableConfig):
                if not state.get("agent_name"):
                    # Interrupt and wait for the user to respond with a name
                    state["agent_name"] = interrupt("Before we start, what would you like to call me?") # [!code highlight]

                # Tell the agent its name
                system_message = SystemMessage(
                    content=f"You are a helpful assistant named {state.get('agent_name')}..."
                )

                response = ChatOpenAI(model="gpt-5.2").invoke(
                    [system_message, *state["messages"]],
                    config
                )

                return {
                    **state,
                    "messages": response,
                }
```
```typescript title="agent-js/src/agent.ts"
            import { interrupt } from "@langchain/langgraph"; // [!code highlight]
            import { SystemMessage } from "@langchain/core/messages";
            import { ChatOpenAI } from "@langchain/openai";

            // add the agent state definition from the previous step
            export const AgentStateAnnotation = Annotation.Root({
                agentName: Annotation<string>,
                ...CopilotKitStateAnnotation.spec,
            });
            export type AgentState = typeof AgentStateAnnotation.State;

            async function chat_node(state: AgentState, config: RunnableConfig) {
                const agentName = state.agentName
                ?? interrupt("Before we start, what would you like to call me?"); // [!code highlight]

                // Tell the agent its name
                const systemMessage = new SystemMessage({
                    content: `You are a helpful assistant named ${agentName}...`,
                });

                const response = await new ChatOpenAI({ model: "gpt-5.2" }).invoke(
                    [systemMessage, ...state.messages],
                    config
                );

                return {
                    ...state,
                    agentName,
                    messages: response,
                };
            }
```
    ### Handle the interrupt in your frontend
    At this point, your LangGraph agent's `interrupt` will be called. However, we currently have no handling for rendering or
    responding to the interrupt in the frontend.

    To do this, we'll use the `useInterrupt` hook, give it a component to render, and then call `resolve` with the user's response.

```tsx title="app/page.tsx"
    import { useInterrupt } from "@copilotkit/react-core/v2"; // [!code highlight]
    // ...

    const YourMainContent = () => {
    // ...
    // [!code highlight:15]
    // styles omitted for brevity
    useInterrupt({
        render: ({ event, resolve }) => (
            <div>
                <p>{event.value}</p>
                <form onSubmit={(e) => {
                    e.preventDefault();
                    resolve((e.target as HTMLFormElement).response.value);
                }}>
                    <input type="text" name="response" placeholder="Enter your response" />
                    <button type="submit">Submit</button>
                </form>
            </div>
        )
    });
    // ...

    return <div>{/* ... */}</div>
    }
```

### Give it a try!
Try talking to your agent, you'll see that it now pauses execution and waits for you to respond!

## Advanced usage

### Condition UI executions

When rendering multiple `interrupt` events in the agent, there could be conflicts between multiple `useInterrupt` hooks calls in the UI.
For this reason, the hook can take an `enabled` argument which will apply it conditionally:

        ### Define multiple interrupts
        First, let's define two different interrupts. We will include a "type" property to differentiate them.
```python title="agent.py"
                from langgraph.types import interrupt # [!code highlight]
                from langchain_core.messages import SystemMessage
                from langchain_openai import ChatOpenAI

                # ... your full state definition

                def chat_node(state: AgentState, config: RunnableConfig):

                  state["approval"] = interrupt({ "type": "approval", "content": "please approve" }) # [!code highlight]

                  if not state.get("agent_name"):
                    # Interrupt and wait for the user to respond with a name
                    state["agent_name"] = interrupt({ "type": "ask", "content": "Before we start, what would you like to call me?" }) # [!code highlight]

                  # Tell the agent its name
                  system_message = SystemMessage(
                    content=f"You are a helpful assistant..."
                  )

                  response = ChatOpenAI(model="gpt-5.2").invoke(
                    [system_message, *state["messages"]],
                    config
                  )

                  return {
                    **state,
                    "messages": response,
                  }
```
```typescript title="agent-js/src/agent.ts"
                import { interrupt } from "@langchain/langgraph"; // [!code highlight]
                import { SystemMessage } from "@langchain/core/messages";
                import { ChatOpenAI } from "@langchain/openai";

                // ... your full state definition

                async function chat_node(state: AgentState, config: RunnableConfig) {
                  state.approval = await interrupt({ type: "approval", content: "please approve" }); // [!code highlight]

                  if (!state.agentName) {
                    state.agentName = await interrupt({ type: "ask", content: "Before we start, what would you like to call me?" }); // [!code highlight]
                  }

                  // Tell the agent its name
                  const systemMessage = new SystemMessage({
                    content: `You are a helpful assistant...`,
                  });

                  const response = await new ChatOpenAI({ model: "gpt-5.2" }).invoke(
                    [systemMessage, ...state.messages],
                    config
                  );

                  return {
                    ...state,
                    messages: response,
                  };
                }
```
        ### Add multiple frontend handlers
        With the differentiator in mind, we will add a handler that takes care of any "ask" and any "approve" types.
        With two `useInterrupt` hooks in our page, we can leverage the `enabled` property to enable each in the right time:

```tsx title="app/page.tsx"
        import { useInterrupt } from "@copilotkit/react-core/v2"; // [!code highlight]
        // ...

        const ApproveComponent = ({ content, onAnswer }: { content: string; onAnswer: (approved: boolean) => void }) => (
            // styles omitted for brevity
            <div>
                <h1>Do you approve?</h1>
                <button onClick={() => onAnswer(true)}>Approve</button>
                <button onClick={() => onAnswer(false)}>Reject</button>
            </div>
        )

        const AskComponent = ({ question, onAnswer }: { question: string; onAnswer: (answer: string) => void }) => (
        // styles omitted for brevity
            <div>
                <p>{question}</p>
                <form onSubmit={(e) => {
                    e.preventDefault();
                    onAnswer((e.target as HTMLFormElement).response.value);
                }}>
                    <input type="text" name="response" placeholder="Enter your response" />
                    <button type="submit">Submit</button>
                </form>
            </div>
        )

        const YourMainContent = () => {
            // ...
            // [!code highlight:13]
            useInterrupt({
                enabled: ({ eventValue }) => eventValue.type === 'ask',
                render: ({ event, resolve }) => (
                    <AskComponent question={event.value.content} onAnswer={answer => resolve(answer)} />
                )
            });

            useInterrupt({
                enabled: ({ eventValue }) => eventValue.type === 'approval',
                render: ({ event, resolve }) => (
                    <ApproveComponent content={event.value.content} onAnswer={answer => resolve(answer)} />
                )
            });

            // ...
        }
```

### Preprocessing of an interrupt and programmatically handling an interrupt value

When opting for custom chat UI, some cases may require pre-processing of the incoming values of interrupt event or even resolving it entirely without showing a UI for it.
This can be achieved using the `handler` property, which is not required to return a React component.

The return value of the handler will be passed to the `render` method as the `result` argument.
```tsx title="app/page.tsx"
// We will assume an interrupt event in the following shape
type Department = 'finance' | 'engineering' | 'admin'
interface AuthorizationInterruptEvent {
    type: 'auth',
    accessDepartment: Department,
}

import { useInterrupt } from "@copilotkit/react-core/v2";

const YourMainContent = () => {
    const [userEmail, setUserEmail] = useState({ email: 'example@user.com' })
    function getUserByEmail(email: string): { id: string; department: Department } {
        // ... an implementation of user fetching
    }

    // ...
    // styles omitted for brevity
    // [!code highlight:28]
    useInterrupt({
        handler: async ({ result, event, resolve }) => {
            const { department } = await getUserByEmail(userEmail)
            if (event.value.accessDepartment === department || department === 'admin') {
                // Following the resolution of the event, we will not proceed to the render method
                resolve({ code: 'AUTH_BY_DEPARTMENT' })
                return;
            }

            return { department, userId }
        },
        render: ({ result, event, resolve }) => (
            <div>
                <h1>Request for {event.value.type}</h1>
                <p>Members from {result.department} department cannot access this information</p>
                <p>You can request access from an administrator to continue.</p>
                <button
                    onClick={() => resolve({ code: 'REQUEST_AUTH', data: { department: result.department, userId: result.userId } })}
                >
                    Request Access
                </button>
                <button
                    onClick={() => resolve({ code: 'CANCEL' })}
                >
                    Cancel
                </button>
            </div>
        )
    });
    // ...

    return <div>{/* ... */}</div>
}
```

### Interrupts
- Route: `/langgraph/human-in-the-loop/interrupt-flow`
- Source: `docs/content/docs/integrations/langgraph/human-in-the-loop/interrupt-flow.mdx`
- Description: Learn how to implement Human-in-the-Loop (HITL) using a interrupt-based flow.

This example demonstrates interrupt-based human-in-the-loop (HITL) in the [CopilotKit Feature Viewer](https://feature-viewer.copilotkit.ai/langgraph/feature/human_in_the_loop).

## What is this?

[LangGraph's interrupt flow](https://docs.langchain.com/oss/python/langgraph/interrupts) provides an intuitive way to implement Human-in-the-loop workflows.

This guide will show you how to both use `interrupt` and how to integrate it with CopilotKit.

## When should I use this?

Human-in-the-loop is a powerful way to implement complex workflows that are production ready. By having a human in the loop,
you can ensure that the agent is always making the right decisions and ultimately is being steered in the right direction.

Interrupt-based flows are a very intuitive way to implement HITL. Instead of having a node await user input before or after its execution,
nodes can be interrupted in the middle of their execution to allow for user input. The trade-off is that the agent is not aware of the
interaction, however [CopilotKit's SDKs provide helpers to alleviate this](#make-your-agent-aware-of-interruptions).

## Implementation

  ### Run and connect your agent

You'll need to run your agent and connect it to CopilotKit before proceeding.

If you don't already have CopilotKit and your agent connected, choose one of the following options:

    You can follow the instructions in the [quickstart](/langgraph/quickstart) guide.
    Run the following command to create a brand new project with a pre-configured agent:

```bash
        npx copilotkit@latest create -f langgraph-py
```
```bash
       npx copilotkit@latest create -f langgraph-js
```

  ### Install the CopilotKit SDK

Any LangGraph agent can be used with CopilotKit. However, creating deep agentic
experiences with CopilotKit requires our LangGraph SDK.

```bash
    uv add copilotkit
```
```bash
    poetry add copilotkit
```

```bash
    pip install copilotkit --extra-index-url https://copilotkit.gateway.scarf.sh/simple/
```

```bash
    conda install copilotkit -c copilotkit-channel
```

```npm
    npm install @copilotkit/sdk-js
```

### Set up your agent state
We're going to have the agent ask us to name it, so we'll need a state property to store the name.

```python title="agent.py"
        # ...
        from copilotkit import CopilotKitState # extends MessagesState
        # ...

        # This is the state of the agent.
        # It inherits from the CopilotKitState properties from CopilotKit.
        class AgentState(CopilotKitState):
            agent_name: str
```
```typescript title="agent-js/src/agent.ts"
        // ...
        import { Annotation } from "@langchain/langgraph";
        import { CopilotKitStateAnnotation } from "@copilotkit/sdk-js/langgraph";
        // ...

        // This is the state of the agent.
        // It inherits from the CopilotKitState properties from CopilotKit.
        export const AgentStateAnnotation = Annotation.Root({
          agentName: Annotation<string>,
          ...CopilotKitStateAnnotation.spec,
        });
        export type AgentState = typeof AgentStateAnnotation.State;
```

    ### Call `interrupt` in your LangGraph agent
    Now we can call `interrupt` in our LangGraph agent.

        Your agent will not be aware of the `interrupt` interaction by default in LangGraph.

        If you want this behavior, see the [section on it below](#make-your-agent-aware-of-interruptions).

```python title="agent.py"
            from langgraph.types import interrupt # [!code highlight]
            from langchain_core.messages import SystemMessage
            from langchain_openai import ChatOpenAI
            from copilotkit import CopilotKitState

            # add the agent state definition from the previous step
            class AgentState(CopilotKitState):
                agent_name: str

            def chat_node(state: AgentState, config: RunnableConfig):
                if not state.get("agent_name"):
                    # Interrupt and wait for the user to respond with a name
                    state["agent_name"] = interrupt("Before we start, what would you like to call me?") # [!code highlight]

                # Tell the agent its name
                system_message = SystemMessage(
                    content=f"You are a helpful assistant named {state.get('agent_name')}..."
                )

                response = ChatOpenAI(model="gpt-5.2").invoke(
                    [system_message, *state["messages"]],
                    config
                )

                return {
                    **state,
                    "messages": response,
                }
```
```typescript title="agent-js/src/agent.ts"
            import { interrupt } from "@langchain/langgraph"; // [!code highlight]
            import { SystemMessage } from "@langchain/core/messages";
            import { ChatOpenAI } from "@langchain/openai";

            // add the agent state definition from the previous step
            export const AgentStateAnnotation = Annotation.Root({
                agentName: Annotation<string>,
                ...CopilotKitStateAnnotation.spec,
            });
            export type AgentState = typeof AgentStateAnnotation.State;

            async function chat_node(state: AgentState, config: RunnableConfig) {
                const agentName = state.agentName
                ?? interrupt("Before we start, what would you like to call me?"); // [!code highlight]

                // Tell the agent its name
                const systemMessage = new SystemMessage({
                    content: `You are a helpful assistant named ${agentName}...`,
                });

                const response = await new ChatOpenAI({ model: "gpt-5.2" }).invoke(
                    [systemMessage, ...state.messages],
                    config
                );

                return {
                    ...state,
                    agentName,
                    messages: response,
                };
            }
```
    ### Handle the interrupt in your frontend
    At this point, your LangGraph agent's `interrupt` will be called. However, we currently have no handling for rendering or
    responding to the interrupt in the frontend.

    To do this, we'll use the `useLangGraphInterrupt` hook, give it a component to render, and then call `resolve` with the user's response.

```tsx title="app/page.tsx"
    import { useLangGraphInterrupt } from "@copilotkit/react-core/v2"; // [!code highlight]
    // ...

    const YourMainContent = () => {
    // ...
    // [!code highlight:15]
    // styles omitted for brevity
    useLangGraphInterrupt({
        render: ({ event, resolve }) => (
            <div>
                <p>{event.value}</p>
                <form onSubmit={(e) => {
                    e.preventDefault();
                    resolve((e.target as HTMLFormElement).response.value);
                }}>
                    <input type="text" name="response" placeholder="Enter your response" />
                    <button type="submit">Submit</button>
                </form>
            </div>
        )
    });
    // ...

    return <div>{/* ... */}</div>
    }
```

### Give it a try!
Try talking to your agent, you'll see that it now pauses execution and waits for you to respond!

## Advanced usage

### Condition UI executions

When rendering multiple `interrupt` events in the agent, there could be conflicts between multiple `useLangGraphInterrupt` hooks calls in the UI.
For this reason, the hook can take an `enabled` argument which will apply it conditionally:

        ### Define multiple interrupts
        First, let's define two different interrupts. We will include a "type" property to differentiate them.
```python title="agent.py"
                from langgraph.types import interrupt # [!code highlight]
                from langchain_core.messages import SystemMessage
                from langchain_openai import ChatOpenAI

                # ... your full state definition

                def chat_node(state: AgentState, config: RunnableConfig):

                  state["approval"] = interrupt({ "type": "approval", "content": "please approve" }) # [!code highlight]

                  if not state.get("agent_name"):
                    # Interrupt and wait for the user to respond with a name
                    state["agent_name"] = interrupt({ "type": "ask", "content": "Before we start, what would you like to call me?" }) # [!code highlight]

                  # Tell the agent its name
                  system_message = SystemMessage(
                    content=f"You are a helpful assistant..."
                  )

                  response = ChatOpenAI(model="gpt-5.2").invoke(
                    [system_message, *state["messages"]],
                    config
                  )

                  return {
                    **state,
                    "messages": response,
                  }
```
```typescript title="agent-js/src/agent.ts"
                import { interrupt } from "@langchain/langgraph"; // [!code highlight]
                import { SystemMessage } from "@langchain/core/messages";
                import { ChatOpenAI } from "@langchain/openai";

                // ... your full state definition

                async function chat_node(state: AgentState, config: RunnableConfig) {
                  state.approval = await interrupt({ type: "approval", content: "please approve" }); // [!code highlight]

                  if (!state.agentName) {
                    state.agentName = await interrupt({ type: "ask", content: "Before we start, what would you like to call me?" }); // [!code highlight]
                  }

                  // Tell the agent its name
                  const systemMessage = new SystemMessage({
                    content: `You are a helpful assistant...`,
                  });

                  const response = await new ChatOpenAI({ model: "gpt-5.2" }).invoke(
                    [systemMessage, ...state.messages],
                    config
                  );

                  return {
                    ...state,
                    messages: response,
                  };
                }
```
        ### Add multiple frontend handlers
        With the differentiator in mind, we will add a handler that takes care of any "ask" and any "approve" types.
        With two `useLangGraphInterrupt` hooks in our page, we can leverage the `enabled` property to enable each in the right time:

```tsx title="app/page.tsx"
        import { useLangGraphInterrupt } from "@copilotkit/react-core/v2"; // [!code highlight]
        // ...

        const ApproveComponent = ({ content, onAnswer }: { content: string; onAnswer: (approved: boolean) => void }) => (
            // styles omitted for brevity
            <div>
                <h1>Do you approve?</h1>
                <button onClick={() => onAnswer(true)}>Approve</button>
                <button onClick={() => onAnswer(false)}>Reject</button>
            </div>
        )

        const AskComponent = ({ question, onAnswer }: { question: string; onAnswer: (answer: string) => void }) => (
        // styles omitted for brevity
            <div>
                <p>{question}</p>
                <form onSubmit={(e) => {
                    e.preventDefault();
                    onAnswer((e.target as HTMLFormElement).response.value);
                }}>
                    <input type="text" name="response" placeholder="Enter your response" />
                    <button type="submit">Submit</button>
                </form>
            </div>
        )

        const YourMainContent = () => {
            // ...
            // [!code highlight:13]
            useLangGraphInterrupt({
                enabled: ({ eventValue }) => eventValue.type === 'ask',
                render: ({ event, resolve }) => (
                    <AskComponent question={event.value.content} onAnswer={answer => resolve(answer)} />
                )
            });

            useLangGraphInterrupt({
                enabled: ({ eventValue }) => eventValue.type === 'approval',
                render: ({ event, resolve }) => (
                    <ApproveComponent content={event.value.content} onAnswer={answer => resolve(answer)} />
                )
            });

            // ...
        }
```

### Preprocessing of an interrupt and programmatically handling an interrupt value

When opting for custom chat UI, some cases may require pre-processing of the incoming values of interrupt event or even resolving it entirely without showing a UI for it.
This can be achieved using the `handler` property, which is not required to return a React component.

The return value of the handler will be passed to the `render` method as the `result` argument.
```tsx title="app/page.tsx"
// We will assume an interrupt event in the following shape
type Department = 'finance' | 'engineering' | 'admin'
interface AuthorizationInterruptEvent {
    type: 'auth',
    accessDepartment: Department,
}

import { useLangGraphInterrupt } from "@copilotkit/react-core/v2";

const YourMainContent = () => {
    const [userEmail, setUserEmail] = useState({ email: 'example@user.com' })
    function getUserByEmail(email: string): { id: string; department: Department } {
        // ... an implementation of user fetching
    }

    // ...
    // styles omitted for brevity
    // [!code highlight:28]
    useLangGraphInterrupt({
        handler: async ({ result, event, resolve }) => {
            const { department } = await getUserByEmail(userEmail)
            if (event.value.accessDepartment === department || department === 'admin') {
                // Following the resolution of the event, we will not proceed to the render method
                resolve({ code: 'AUTH_BY_DEPARTMENT' })
                return;
            }

            return { department, userId }
        },
        render: ({ result, event, resolve }) => (
            <div>
                <h1>Request for {event.value.type}</h1>
                <p>Members from {result.department} department cannot access this information</p>
                <p>You can request access from an administrator to continue.</p>
                <button
                    onClick={() => resolve({ code: 'REQUEST_AUTH', data: { department: result.department, userId: result.userId } })}
                >
                    Request Access
                </button>
                <button
                    onClick={() => resolve({ code: 'CANCEL' })}
                >
                    Cancel
                </button>
            </div>
        )
    });
    // ...

    return <div>{/* ... */}</div>
}
```

### Inspector
- Route: `/langgraph/inspector`
- Source: `docs/content/docs/integrations/langgraph/inspector.mdx`
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
- Route: `/langgraph/multi-agent-flows`
- Source: `docs/content/docs/integrations/langgraph/multi-agent-flows.mdx`
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

Be advised that when using this mode, you'll have to "exit the workflow" explicitly in your agent code.
You can find more information about it in the ["Exiting the agent loop" section](https://docs.copilotkit.ai/langgraph/advanced/exit-agent).

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

### Observability
- Route: `/langgraph/premium/observability`
- Source: `docs/content/docs/integrations/langgraph/premium/observability.mdx`
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
- Route: `/langgraph/premium/overview`
- Source: `docs/content/docs/integrations/langgraph/premium/overview.mdx`
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

### Reading agent state
- Route: `/langgraph/shared-state/in-app-agent-read`
- Source: `docs/content/docs/integrations/langgraph/shared-state/in-app-agent-read.mdx`
- Description: Read the realtime agent state in your native application.

```python title="agent.py"
        from copilotkit import CopilotKitState
        from typing import Literal

        class AgentState(CopilotKitState):
            language: Literal["english", "spanish"] = "english"

        def chat_node(state: AgentState, config: RunnableConfig):
          # If language is not defined, set a value.
          # this is because a default value in a state class is not read on runtime
          language = state.get("language", "english")

          # ... add the rest of the node implementation and use the language variable

          return {
            # ... add the rest of state to return
            # return the language to make it available for the next nodes & frontend to read
            "language": language
          }
```
```ts title="agent-js/src/agent.ts"
        import { Annotation } from "@langchain/langgraph";
        import { CopilotKitStateAnnotation } from "@copilotkit/sdk-js/langgraph";

        export const AgentStateAnnotation = Annotation.Root({
            language: Annotation<"english" | "spanish">,
            ...CopilotKitStateAnnotation.spec,
        });
        export type AgentState = typeof AgentStateAnnotation.State;

        async function chat_node(state: AgentState, config: RunnableConfig) {
          // If language is not defined, use a default value.
          const language = state.language ?? 'english'

          // ... add the rest of the node implementation and use the language variable

          return {
            // ... add the rest of state to return
            // return the language to make it available for the next nodes & frontend to read
            language
          }
        }
```
```tsx title="ui/app/page.tsx"
    import { useAgent } from "@copilotkit/react-core/v2"; // [!code highlight]

    function YourMainContent() {
      // [!code highlight:3]
      const { agent } = useAgent({
        agentId: "sample_agent",
      });

      const language = (agent.state.language as string) ?? "english";

      // ...

      return (
        // style excluded for brevity
        <div>
          <h1>Your main content</h1>
          {/* [!code highlight:1] */}
          <p>Language: {language}</p>
        </div>
      );
    }
```
```tsx title="ui/app/page.tsx"
import { useAgent } from "@copilotkit/react-core/v2"; // [!code highlight]

function YourMainContent() {
  // [!code highlight:3]
  const { agent } = useAgent({
    agentId: "sample_agent",
  });

  const language = (agent.state.language as string) ?? "english";

  return (
    <div>
      <p>Language: {language}</p>
    </div>
  );
}
```

### Writing agent state
- Route: `/langgraph/shared-state/in-app-agent-write`
- Source: `docs/content/docs/integrations/langgraph/shared-state/in-app-agent-write.mdx`
- Description: Write to agent's state from your application.

```python title="agent.py"
        from copilotkit import CopilotKitState
        from typing import Literal

        class AgentState(CopilotKitState):
            language: Literal["english", "spanish"] = "english"
```
```ts title="agent-js/src/agent.ts"
        import { Annotation } from "@langchain/langgraph";
        import { CopilotKitStateAnnotation } from "@copilotkit/sdk-js/langgraph";

        export const AgentStateAnnotation = Annotation.Root({
            language: Annotation<"english" | "spanish">,
            ...CopilotKitStateAnnotation.spec,
        });
        export type AgentState = typeof AgentStateAnnotation.State;
```
```tsx title="ui/app/page.tsx"
    import { useAgent } from "@copilotkit/react-core/v2"; // [!code highlight]

    // Example usage in a pseudo React component
    function YourMainContent() {
      // [!code highlight:3]
      const { agent } = useAgent({
        agentId: "sample_agent",
      });

      const language = (agent.state.language as string) ?? "english";

      // ...

      const toggleLanguage = () => {
        agent.setState({ language: language === "english" ? "spanish" : "english" }); // [!code highlight]
      };

      // ...

      return (
        // style excluded for brevity
        <div>
          <h1>Your main content</h1>
          {/* [!code highlight:1] */}
          <p>Language: {language}</p>
          <button onClick={toggleLanguage}>Toggle Language</button>
        </div>
      );
    }
```
```tsx title="ui/app/page.tsx"
import { useAgent } from "@copilotkit/react-core/v2"; // [!code highlight]

// ...

function YourMainContent() {
  const { agent } = useAgent({
    agentId: "sample_agent",
  });

  const language = (agent.state.language as string) ?? "english";

  // setup to be called when some event in the app occurs
  const toggleLanguage = () => {
    const newLanguage = language === "english" ? "spanish" : "english";
    agent.setState({ language: newLanguage });

    // [!code highlight:2]
    // re-run the agent with updated state
    agent.runAgent();
  };

  return (
    // ...
  );
}
```

### State streaming
- Route: `/langgraph/shared-state/predictive-state-updates`
- Source: `docs/content/docs/integrations/langgraph/shared-state/predictive-state-updates.mdx`
- Description: Stream in-progress agent state updates to the frontend.

```python title="agent.py"
                from copilotkit import CopilotKitState
                from typing import Literal

                class AgentState(CopilotKitState):
                    observed_steps: list[str]  # Array of completed steps
```
```ts title="agent-js/src/agent.ts"
                import { Annotation } from "@langchain/langgraph";
                import { CopilotKitStateAnnotation } from "@copilotkit/sdk-js/langgraph";

                export const AgentStateAnnotation = Annotation.Root({
                    observed_steps: Annotation<string[]>,  // Array of completed steps
                    ...CopilotKitStateAnnotation.spec,
                });
                export type AgentState = typeof AgentStateAnnotation.State;
```
```python title="agent.py"
                        from copilotkit.langgraph import copilotkit_emit_state # [!code highlight]
                        # ...
                        async def chat_node(state: AgentState, config: RunnableConfig) -> Command[Literal["cpk_action_node", "tool_node", "__end__"]]:
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
                                await copilotkit_emit_state(config, state) # [!code highlight]
                                await asyncio.sleep(1)

                            # ...
```
```ts title="agent-js/src/agent.ts"
                        import { copilotkitEmitState } from "@copilotkit/sdk-js/langgraph"; // [!code highlight]
                        // ...
                        async function chat_node(state: AgentState, config: RunnableConfig) {
                            // ...

                            // Simulate executing steps one by one
                            const steps = [
                                "Analyzing input data...",
                                "Identifying key patterns...",
                                "Generating recommendations...",
                                "Formatting final output..."
                            ];

                            for (const step of steps) {
                                state.observed_steps = [...(state.observed_steps ?? []), step];
                                copilotkitEmitState(config, state);
                                await new Promise(resolve => setTimeout(resolve, 1000));
                            }
                        }
```
```python
                        from copilotkit.langgraph import copilotkit_customize_config
                        from copilotkit import CopilotKitState
                        from langgraph.types import Command
                        from langgraph.graph import END
                        from langchain.tools import tool
                        from langchain_openai import ChatOpenAI
                        from langchain_core.messages import SystemMessage, AIMessage
                        from langchain_core.runnables import RunnableConfig

                        # Define a step progress tool for the llm to report the steps
                        @tool
                        def step_progress_tool(steps: list[str])
                            """Reads and reports steps"""

                        async def frontend_actions_node(state: AgentState, config: RunnableConfig):
                            # Configure CopilotKit to treat step progress tool calls as predictive of the final state
                            config = copilotkit_customize_config(
                                config,
                                emit_intermediate_state=[
                                    {
                                        "state_key": "observed_steps",
                                        "tool": "step_progress_tool",
                                        "tool_argument": "steps"
                                    },
                                ]
                            )

                            system_message = SystemMessage(
                                content=f"You are a task performer. Pretend doing tasks you are given, report the steps using step_progress_tool."
                            )

                            # Provide the actions to the LLM
                            model = ChatOpenAI(model="gpt-4").bind_tools(
                                [
                                    *state["copilotkit"]["actions"],
                                    step_progress_tool
                                    # your other tools here
                                ],
                            )

                            # Call the model with CopilotKit's modified config
                            response = await model.ainvoke([
                                system_message,
                                *state["messages"],
                            ], config)

                            # Set the steps in state so they are persisted and communicated to the frontend
                            if isinstance(response, AIMessage) and response.tool_calls and response.tool_calls[0].get("name") == 'step_progress_tool':
                                return Command(
                                    goto=END,
                                    update={
                                        "messages": response,
                                        "observed_steps": response.tool_calls[0].get("args", None).get('steps')
                                    }
                                )

                            return Command(goto=END, update={"messages": response})
```
```typescript
                        import { copilotkitCustomizeConfig } from '@copilotkit/sdk-js/langgraph';

                        async function frontendActionsNode(state: AgentState, config: RunnableConfig): Promise<AgentState> {
                            const modifiedConfig = copilotkitCustomizeConfig(config, {
                                emitIntermediateState: [
                                {
                                    stateKey: "observed_steps",
                                    tool: "StepProgressTool",
                                    toolArgument: "steps",
                                },
                                ],
                            });

                            const stepProgress = tool(
                                async (args) => args,
                                {
                                    name: "StepProgressTool",
                                    description: "Records progress by updating the steps array",
                                    schema: z.object({
                                        steps: z.array(z.string()),
                                    }),
                                }
                            );

                            const model = new ChatOpenAI({
                                model: "gpt-5.2",
                            }).bindTools([stepProgress]);

                            const system_message = new SystemMessage("You are a task performer. Pretend doing tasks you are given, report the steps using StepProgressTool.")
                            const response = await model.invoke([system_message, ...state.messages], modifiedConfig);

                            if (response.tool_calls?.length) {
                                return {
                                    messages: response;
                                    observed_steps: response.tool_calls[0].args.steps,
                                }

                            return { messages: response };
                        }
```
```tsx title="ui/app/page.tsx"
        import { useAgent } from '@copilotkit/react-core/v2'; // [!code highlight]

        const YourMainContent = () => {
            // [!code highlight:3]
            const { agent } = useAgent({
                agentId: "sample_agent",
            });

            const observedSteps = (agent.state.observed_steps as string[]) ?? [];

            return (
                <div>
                    <h1>Agent Progress</h1>
                    {observedSteps.length > 0 && (
                        <div>
                            <h3>Steps:</h3>
                            <ul>
                                {observedSteps.map((step, i) => (
                                    <li key={i}>{step}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )
        }
```

### Input/Output Schemas
- Route: `/langgraph/shared-state/state-inputs-outputs`
- Source: `docs/content/docs/integrations/langgraph/shared-state/state-inputs-outputs.mdx`
- Description: Decide which state properties are received and returned to the frontend

## What is this?

Not all state properties are relevant for frontend-backend sharing.
This guide shows how to ensure only the right portion of state is communicated back and forth.

This guide is based on [LangGraph's Input/Output Schema feature](https://docs.langchain.com/oss/python/langgraph/use-graph-api#define-input-and-output-schemas)

## When should I use this?

Depending on your implementation, some properties are meant to be processed internally, while some others are the way for the UI to communicate user input.
In addition, some state properties contain a lot of information. Syncing them back and forth between the agent and UI can be costly, while it might not have any practical benefit.

## Implementation

      ### Examine our old state
      LangGraph is stateful. As you transition between nodes, that state is updated and passed to the next node. For this example,
      let's assume that the state our agent should be using, can be described like this:
```python title="agent.py"
        from copilotkit import CopilotKitState
        from typing import Literal

        class AgentState(CopilotKitState):
            question: str
            answer: str
            resources: List[str]
```
```typescript title="agent-js/sample_agent/agent.ts"
        import { Annotation } from "@langchain/langgraph";
        import { CopilotKitStateAnnotation } from "@copilotkit/sdk-js/langgraph";

        const AgentState = Annotation.Root({
          ...CopilotKitStateAnnotation.spec,
          question: Annotation<string>,
          answer: Annotation<string>,
          resources: Annotation<string[]>,
        })
```
    ### Divide state to Input and Output
    Our example case lists several state properties, which with its own purpose:
      - The question is being asked by the user, expecting the llm to answer
      - The answer is what the LLM returns
      - The resources list will be used by the LLM to answer the question, and should not be communicated to the user, or set by them.

```python title="agent.py"
          from copilotkit import CopilotKitState
          from typing import Literal

          # Divide the state to 3 parts

          # Input schema for inputs you are willing to accept from the frontend
          class InputState(CopilotKitState):
            question: str

          # Output schema for output you are willing to pass to the frontend
          class OutputState(CopilotKitState):
            answer: str

          # The full schema, including the inputs, outputs and internal state ("resources" in our case)
          class OverallState(InputState, OutputState):
            resources: List[str]

          async def answer_node(state: OverallState, config: RunnableConfig):
            """
            Standard chat node, meant to answer general questions.
            """

            model = ChatOpenAI()

            # add the input question in the system prompt so it's passed to the LLM
            system_message = SystemMessage(
              content=f"You are a helpful assistant. Answer the question: {state.get('question')}"
            )

            response = await model.ainvoke([
              system_message,
              *state["messages"],
            ], config)

            # ...add the rest of the agent implementation

            # extract the answer, which will be assigned to the state soon
            answer = response.content

            return {
               "messages": response,
                # include the answer in the returned state
               "answer": answer
            }

          # finally, before compiling the graph, we define the 3 state components
          builder = StateGraph(OverallState, input=InputState, output=OutputState)

          # add all the different nodes and edges and compile the graph
          builder.add_node("answer_node", answer_node)
          builder.add_edge(START, "answer_node")
          builder.add_edge("answer_node", END)
          graph = builder.compile()
```
              While we work on adding Zod schema support for LangGraph TypeScript, a workaround is required to ignore a typescript error when defining "full state".

              You can see this at the very end of the TypeScript implementation snippet.
```typescript title="agent-js/sample_agent/agent.ts"
              import { Annotation } from "@langchain/langgraph";
              import { CopilotKitStateAnnotation } from "@copilotkit/sdk-js/langgraph";

              // Divide the state to 3 parts

              // An input schema for inputs you are willing to accept from the frontend
              const InputAnnotation = Annotation.Root({
                ...CopilotKitStateAnnotation.spec,
                question: Annotation<string>,
              });

              // Output schema for output you are willing to pass to the frontend
              const OutputAnnotation = Annotation.Root({
                ...CopilotKitStateAnnotation.spec,
                answer: Annotation<string>,
              });

              // The full schema, including the inputs, outputs and internal state ("resources" in our case)
              export const AgentStateAnnotation = Annotation.Root({
                ...CopilotKitStateAnnotation.spec,
                ...OutputAnnotation.spec,
                ...InputAnnotation.spec,
                resources: Annotation<string[]>,
              });

              // Define a typed state that supports the entire
              export type AgentState = typeof AgentStateAnnotation.State;

              async function answerNode(state: AgentState, config: RunnableConfig) {
                const model = new ChatOpenAI()

                const systemMessage = new SystemMessage({
                  content: `You are a helpful assistant. Answer the question: ${state.question}.`,
                });

                const response = await modelWithTools.invoke(
                  [systemMessage, ...state.messages],
                  config
                );

                // ...add the rest of the agent implementation
                // extract the answer, which will be assigned to the state soon
                const answer = response.content

                return {
                  messages: response,
                  // include the answer in the returned state
                  answer,
                }
              }

              // finally, before compiling the graph, we define the 3 state components
              const workflow = new StateGraph({
                input: InputAnnotation,
                output: OutputAnnotation,
                // @ts-expect-error -- LangGraph does not expect a "full schema with internal properties".
                stateSchema: AgentStateAnnotation,
              })
                .addNode("answer_node", answerNode) // add all the different nodes and edges and compile the graph
                .addEdge(START, "answer_node")
                .addEdge("answer_node", END)
              export const graph = workflow.compile()
```
    ### Give it a try!
    Now that we know which state properties our agent emits, we can inspect the state and expect the following to happen:
    - While we are able to provide a question, we will not receive it back from the agent. If we are using it in our UI, we need to remember the UI is the source of truth for it
    - Answer will change once it's returned back from the agent
    - The UI has no access to resources.

```tsx
    import { useAgent } from "@copilotkit/react-core/v2"; // [!code highlight]

    const { agent } = useAgent({
      agentId: "sample_agent",
    });

    const answer = agent.state.answer as string;

    console.log(answer) // You can expect seeing "answer" change, while the others are not returned from the agent
```

### Workflow Execution
- Route: `/langgraph/shared-state/workflow-execution`
- Source: `docs/content/docs/integrations/langgraph/shared-state/workflow-execution.mdx`
- Description: Decide which state properties are received and returned to the frontend

## What is this?

Not all state properties are relevant for frontend-backend sharing.
This guide shows how to ensure only the right portion of state is communicated back and forth.

This guide is based on [LangGraph's Input/Output Schema feature](https://docs.langchain.com/oss/python/langgraph/use-graph-api#define-input-and-output-schemas)

## When should I use this?

Depending on your implementation, some properties are meant to be processed internally, while some others are the way for the UI to communicate user input.
In addition, some state properties contain a lot of information. Syncing them back and forth between the agent and UI can be costly, while it might not have any practical benefit.

## Implementation

      ### Examine our old state
      LangGraph is stateful. As you transition between nodes, that state is updated and passed to the next node. For this example,
      let's assume that the state our agent should be using, can be described like this:
```python title="agent.py"
        from copilotkit import CopilotKitState
        from typing import Literal

        class AgentState(CopilotKitState):
            question: str
            answer: str
            resources: List[str]
```
```typescript title="agent-js/sample_agent/agent.ts"
        import { Annotation } from "@langchain/langgraph";
        import { CopilotKitStateAnnotation } from "@copilotkit/sdk-js/langgraph";

        const AgentState = Annotation.Root({
          ...CopilotKitStateAnnotation.spec,
          question: Annotation<string>,
          answer: Annotation<string>,
          resources: Annotation<string[]>,
        })
```
    ### Divide state to Input and Output
    Our example case lists several state properties, which with its own purpose:
      - The question is being asked by the user, expecting the llm to answer
      - The answer is what the LLM returns
      - The resources list will be used by the LLM to answer the question, and should not be communicated to the user, or set by them.

```python title="agent.py"
          from copilotkit import CopilotKitState
          from typing import Literal

          # Divide the state to 3 parts

          # Input schema for inputs you are willing to accept from the frontend
          class InputState(CopilotKitState):
            question: str

          # Output schema for output you are willing to pass to the frontend
          class OutputState(CopilotKitState):
            answer: str

          # The full schema, including the inputs, outputs and internal state ("resources" in our case)
          class OverallState(InputState, OutputState):
            resources: List[str]

          async def answer_node(state: OverallState, config: RunnableConfig):
            """
            Standard chat node, meant to answer general questions.
            """

            model = ChatOpenAI()

            # add the input question in the system prompt so it's passed to the LLM
            system_message = SystemMessage(
              content=f"You are a helpful assistant. Answer the question: {state.get('question')}"
            )

            response = await model.ainvoke([
              system_message,
              *state["messages"],
            ], config)

            # ...add the rest of the agent implementation

            # extract the answer, which will be assigned to the state soon
            answer = response.content

            return {
               "messages": response,
                # include the answer in the returned state
               "answer": answer
            }

          # finally, before compiling the graph, we define the 3 state components
          builder = StateGraph(OverallState, input=InputState, output=OutputState)

          # add all the different nodes and edges and compile the graph
          builder.add_node("answer_node", answer_node)
          builder.add_edge(START, "answer_node")
          builder.add_edge("answer_node", END)
          graph = builder.compile()
```
              While we work on adding Zod schema support for LangGraph TypeScript, a workaround is required to ignore a typescript error when defining "full state".

              You can see this at the very end of the TypeScript implementation snippet.
```typescript title="agent-js/sample_agent/agent.ts"
              import { Annotation } from "@langchain/langgraph";
              import { CopilotKitStateAnnotation } from "@copilotkit/sdk-js/langgraph";

              // Divide the state to 3 parts

              // An input schema for inputs you are willing to accept from the frontend
              const InputAnnotation = Annotation.Root({
                ...CopilotKitStateAnnotation.spec,
                question: Annotation<string>,
              });

              // Output schema for output you are willing to pass to the frontend
              const OutputAnnotation = Annotation.Root({
                ...CopilotKitStateAnnotation.spec,
                answer: Annotation<string>,
              });

              // The full schema, including the inputs, outputs and internal state ("resources" in our case)
              export const AgentStateAnnotation = Annotation.Root({
                ...CopilotKitStateAnnotation.spec,
                ...OutputAnnotation.spec,
                ...InputAnnotation.spec,
                resources: Annotation<string[]>,
              });

              // Define a typed state that supports the entire
              export type AgentState = typeof AgentStateAnnotation.State;

              async function answerNode(state: AgentState, config: RunnableConfig) {
                const model = new ChatOpenAI()

                const systemMessage = new SystemMessage({
                  content: `You are a helpful assistant. Answer the question: ${state.question}.`,
                });

                const response = await modelWithTools.invoke(
                  [systemMessage, ...state.messages],
                  config
                );

                // ...add the rest of the agent implementation
                // extract the answer, which will be assigned to the state soon
                const answer = response.content

                return {
                  messages: response,
                  // include the answer in the returned state
                  answer,
                }
              }

              // finally, before compiling the graph, we define the 3 state components
              const workflow = new StateGraph({
                input: InputAnnotation,
                output: OutputAnnotation,
                // @ts-expect-error -- LangGraph does not expect a "full schema with internal properties".
                stateSchema: AgentStateAnnotation,
              })
                .addNode("answer_node", answerNode) // add all the different nodes and edges and compile the graph
                .addEdge(START, "answer_node")
                .addEdge("answer_node", END)
              export const graph = workflow.compile()
```
    ### Give it a try!
    Now that we know which state properties our agent emits, we can inspect the state and expect the following to happen:
    - While we are able to provide a question, we will not receive it back from the agent. If we are using it in our UI, we need to remember the UI is the source of truth for it
    - Answer will change once it's returned back from the agent
    - The UI has no access to resources.

```tsx
    import { useAgent } from "@copilotkit/react-core/v2"; // [!code highlight]

    const { agent } = useAgent({
      agentId: "sample_agent",
    });

    const answer = agent.state.answer as string;

    console.log(answer) // You can expect seeing "answer" change, while the others are not returned from the agent
```

### Subgraphs
- Route: `/langgraph/subgraphs`
- Source: `docs/content/docs/integrations/langgraph/subgraphs.mdx`
- Description: Use multiple agents as subgraphs in your application.

```tsx
import { useAgent } from "@copilotkit/react-core/v2"; // [!code highlight]

const { agent } = useAgent({
  agentId: "sample_agent",
});

// Access agent state as usual - subgraph streaming is handled automatically
const state = agent.state;
```

### Common Copilot Issues
- Route: `/langgraph/troubleshooting/common-issues`
- Source: `docs/content/docs/integrations/langgraph/troubleshooting/common-issues.mdx`
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

### Migrate to 1.10.X
- Route: `/langgraph/troubleshooting/migrate-to-1.10.X`
- Source: `docs/content/docs/integrations/langgraph/troubleshooting/migrate-to-1.10.X.mdx`
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
- Route: `/langgraph/troubleshooting/migrate-to-1.8.2`
- Source: `docs/content/docs/integrations/langgraph/troubleshooting/migrate-to-1.8.2.mdx`
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

### Migrate to V2
- Route: `/langgraph/troubleshooting/migrate-to-v2`
- Source: `docs/content/docs/integrations/langgraph/troubleshooting/migrate-to-v2.mdx`
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

### Overview
- Route: `/langgraph/tutorials/agent-native-app`
- Source: `docs/content/docs/integrations/langgraph/tutorials/agent-native-app/index.mdx`

# Research Agent Native Application (ANA)

## What you'll learn

In this tutorial, we'll build a Research Agent Native Application (ANA) using CopilotKit. Starting with a basic application, we'll add agent capabilities step by step.

You'll learn:
- 🎯 Core principles of agent native applications
- 🔄 How LangGraph helps structure LLM behavior
- 🧱 Building blocks of a Copilot Agent (CoAgent)
- 🛠️ Creating interactive agent experiences with CopilotKit

## Let's get started!
Next, we'll set up the project and install dependencies.

### Next Steps
- Route: `/langgraph/tutorials/agent-native-app/next-steps`
- Source: `docs/content/docs/integrations/langgraph/tutorials/agent-native-app/next-steps.mdx`

This is the end of the tutorial. You now know the basics of how to build complex agentic experiences into your own applications.

## Source code

You can find the source code and interactive sandboxes here:
- [Start app](https://github.com/CopilotKit/open-research-ANA/tree/tutorial-start)
- [Final app](https://github.com/CopilotKit/open-research-ANA/tree/main)

## What's next?

For next steps, here are some ideas:

- Add persistence for [messages](/langgraph/advanced/persistence/loading-message-history) and [agent state](/langgraph/advanced/persistence/loading-agent-state).
- Enhance the back-and-fourth with the agent by adding more tools that can update the agent's state.
- Allow the human to ask for inline editing of the research report.

We have more tutorials coming soon, please let us know if you have any ideas for what you'd like to see next!

## Need help?

If you have any questions, feel free to reach out to us on [Discord](https://discord.gg/6dffbvGU3D).

### Step 1: Checkout the repo
- Route: `/langgraph/tutorials/agent-native-app/step-1-checkout-repo`
- Source: `docs/content/docs/integrations/langgraph/tutorials/agent-native-app/step-1-checkout-repo.mdx`

## Get the starting code
We'll use the [open-research-ana repository](https://github.com/CopilotKit/open-research-ana) as our starting point. Clone the `tutorial-start` branch:

```shell
git clone -b tutorial-start https://github.com/CopilotKit/open-research-ana.git
cd open-research-ana
```

The repository contains:
- `frontend/`: A NextJS application where we'll integrate our agent
- `agent/`: A Python-based LangGraph agent we'll enhance with CopilotKit

## Install frontend dependencies
Navigate to the frontend directory and install dependencies:

```shell
cd frontend
pnpm install
```
## Start the application
Launch the development server:

```shell
pnpm run dev
```

Visit [http://localhost:3000](http://localhost:3000) to see the initial application. You'll see an empty chat interface and document - this is our starting point.

Next, we'll explore how our LangGraph agent works.

### Step 2: Start the Agent
- Route: `/langgraph/tutorials/agent-native-app/step-2-start-the-agent`
- Source: `docs/content/docs/integrations/langgraph/tutorials/agent-native-app/step-2-start-the-agent.mdx`

```shell
cd agent
touch .env
```
```txt title=".env"
OPENAI_API_KEY=<your-openai-api-key>
TAVILY_API_KEY=<your-tavily-api-key>
```
```shell
pip install -r requirements.txt # Install dependencies
brew install langgraph-cli # Install LangGraph CLI
langgraph dev --host localhost --port 8000 # Start the agent
```

### Step 3: Setup CopilotKit
- Route: `/langgraph/tutorials/agent-native-app/step-3-setup-copilotkit`
- Source: `docs/content/docs/integrations/langgraph/tutorials/agent-native-app/step-3-setup-copilotkit.mdx`

Now that we have both our application and agent running, let's connect them using CopilotKit. The necessary dependencies are already installed in the `frontend` directory:

- `@copilotkit/react-core`: Core CopilotKit functionality and hooks
- `@copilotkit/react-ui`: Pre-built UI components for chat interfaces

  **The package versions in this tutorial are pinned, so updating the dependencies could break the tutorial.**

```npm
  npm install @copilotkit/react-core @copilotkit/react-ui
```

### Set up Copilot Cloud
Create a [Copilot Cloud account](https://cloud.copilotkit.ai/sign-in) to get started. This provides a production-ready proxy to your LLMs.

Copilot Cloud includes free LLM credits for development.

### Get a Copilot Cloud API Key

Once logged in, you'll see some on boarding steps. The main thing we'll need is a public API key. To do this,
you'll need to create an OpenAI API key and provide it to Copilot Cloud.

### Configure environment variables
Create and populate the frontend environment file:

```shell
touch frontend/.env
```

Then, add your Copilot Cloud API key to the file like so:

```txt title="frontend/.env"
NEXT_PUBLIC_CPK_PUBLIC_API_KEY=...
```

### Add the CopilotKit provider
Wrap your application with the CopilotKit provider:

```tsx title="frontend/src/app/layout.tsx"
"use client";

// ...
import { CopilotKit } from "@copilotkit/react-core/v2"; // [!code ++]
import "@copilotkit/react-ui/v2/styles.css"; // [!code ++]
// ...

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    return (
      <html lang="en" className="h-full">
        <body className={`${lato.variable} ${noto.className} antialiased h-full`}>
          // [!code ++:4]
          <CopilotKit
            publicApiKey={process.env.NEXT_PUBLIC_CPK_PUBLIC_API_KEY}
          >
            <TooltipProvider>
              <ResearchProvider>
                {children}
              </ResearchProvider>
            </TooltipProvider>
          </CopilotKit> // [!code ++]
        </body>
      </html>
    );
}
```

### Adding a chat interface

We provide several customizeable components for you to interact with your copilot. Some of these are [``](/reference/v1/components/chat/CopilotPopup), [``](/reference/v1/components/chat/CopilotSidebar), and [``](/reference/v1/components/chat/CopilotChat), and your own fully custom UI via [`useCopilotChat`](/reference/v1/hooks/useCopilotChat).

In this tutorial, we'll use the `` component as we want to aim for a non-modal chat interface.

  The `Chat` component will serve as a wrapper around the CopilotKit `CopilotChat` component. This is to help simplify
  what you'll need to write along the way.

```tsx title="frontend/src/components/Chat.tsx"
"use client"

import { CopilotChat } from "@copilotkit/react-core/v2";
import { INITIAL_MESSAGE, MAIN_CHAT_INSTRUCTIONS, MAIN_CHAT_TITLE } from "@/lib/consts";

export default function Chat({ onSubmitMessage }: { onSubmitMessage: () => void }) {
  return (
      // [!code ++:10]
      <CopilotChat
          labels={{
              modalHeaderTitle: MAIN_CHAT_TITLE,
              welcomeMessageText: INITIAL_MESSAGE,
          }}
          className="h-full w-full font-noto"
          onSubmitMessage={onSubmitMessage}
      />
      // [!code --:4]
      <h1 className="text-2xl font-bold flex items-center justify-center h-full mx-auto mr-20">
        It'd be really cool if we had chat here!
      </h1>
  )
}
```

## Recap

And we're done! Here's what we did:

- We setup our Copilot cloud account and got an API key.
- We configured the CopilotKit provider in our application to use our API key.
- We added the CopilotSidebar to our application.

Now, head back to the app and you'll find a chat interface on the left side of the page. At this point, you can start interacting with your copilot! 🎉

This is a very simple copilot that isn't talking to our LangGraph yet. In the next step, we'll be adding the LangGraph agent to the mix.

### Step 4: Agentic Chat UI
- Route: `/langgraph/tutorials/agent-native-app/step-4-agentic-chat-ui`
- Source: `docs/content/docs/integrations/langgraph/tutorials/agent-native-app/step-4-agentic-chat-ui.mdx`

At this point, we have a LangGraph agent running in LangGraph Studio and have a simple copilot. Now, let's
combine the two together to make an copilot agent (CoAgent)!

## Connect the agent to CopilotKit
We need to make CopilotKit aware of our running LangGraph agent. To do this, we will setup a remote
endpoint to connect to our locally running agent.

Since we're using Copilot Cloud, this is as simple as running the following command for local development.

```bash
npx copilotkit@latest dev --port 8000
```
```sh
✔ Select a project Local (ID: <project_id>)
✅ LangGraph Platform endpoint detected
⠹ Creating tunnel...

Tunnel Information:

• Tunnel URL:            https://<tunnel_id>.tunnels.devcopilotkit.com
• Endpoint Type:         LangGraph Platform
• Project:               projects/<project_id>

Press Ctrl+C to stop the tunnel

✔ 🚀 Local tunnel is live and linked to Copilot Cloud!
```

This allows Copilot Cloud to know where to send requests to when the agent is called.

## Specify the agent to use

Now we need to let the CopilotKit provider know which agent to use, we can do this by specifying the `agent` prop.
By default, CopilotKit will intelligently route requests to the appropriate agent based on context. This allows
you to have multiple agents and actions and not have to worry about manually routing requests.

In our case however, we only have a single agent and its ideal to lock all requests to that agent. We can do this
by updating the props of our `CopilotKit` provider.

Our agent name is `agent` which is specified in the `langgraph.json` file.

```tsx title="frontend/src/app/layout.tsx"
// ...
<CopilotKit
  // ...
  agent="agent" // [!code ++]
>
  {...}
</CopilotKit>
```

## Recap
And we're done! Here's what we did:

- We connected the agent to CopilotKit.
- We specified the agent to use.

Now when you head back to the app, you'll notice that we're talking to our LangGraph agent!

Next, let's process and sync the state between our application and the agent.

### Step 5: Human in the Loop
- Route: `/langgraph/tutorials/agent-native-app/step-5-human-in-the-loop`
- Source: `docs/content/docs/integrations/langgraph/tutorials/agent-native-app/step-5-human-in-the-loop.mdx`

Now that we have the ability to chat with our agent, we can move on to implementing human-in-the-loop. This is where the user can review the agent's output and provide feedback. We'll be
implementing this in our application by allowing the user to review and approve an outline prior to the research being conducted.

## Understanding Human-in-the-Loop

In LangGraph, the current suggested way to implement human-in-the-loop is to use the [interrupt](https://docs.langchain.com/oss/python/langgraph/interrupts) method. Calling this
function will pause the node at the call site and rerun the node with the user's decision. You can learn more about interrupt [here](https://docs.langchain.com/langsmith/interrupt-concurrent).

All together, this process will look like this:

The implementation of all of this is actually quite simple, but understanding how it all fits together is key.
## Add `useLangGraphInterrupt` to the frontend

If you recall from when we started the agent, the interrupt will stop the node when its time to review a proposed research outline.

CopilotKit allows us to render a UI to get the user's decision for this interrupt and respond accordingly via the `useLangGraphInterrupt` hook.

In our `page.tsx` file, add the following code.
```tsx title="frontend/src/app/page.tsx"
// ...
import { useLangGraphInterrupt } from "@copilotkit/react-core/v2"; // [!code ++]
// ...

export default function HomePage() {
    // ...
    const { state: researchState, setResearchState } = useResearch()

    const streamingSection = useStreamingContent(researchState);

    // [!code ++:12]
    useLangGraphInterrupt<Proposal>({
      render: ({ resolve, event }) => {
        return <ProposalViewer
          proposal={event.value}
          onSubmit={(approved, proposal) => resolve(
            JSON.stringify({
              ...proposal,
              approved,
            })
          )}
        />
      }
    })
    // ...
}
```

Now, when the LangGraph is interrupted the `ProposalViewer` component will be rendered to the user with the `event.value` as the proposal. On submit, the hook's `resolve` function
will be called with the user's decision.

Checkout the `ProposalViewer` component code in the `frontend/src/components/ProposalViewer.tsx` file for more details about rendering.

It's just a standard React component with some styling, a form, and a submit button.

## Recap
It is really as simple as that! Now, we've implemented human-in-the-loop for our agent. To recap, we did the following:
- Learned about human-in-the-loop in LangGraph.
- Added the `useLangGraphInterrupt` hook to our application.
- Rendered a `ProposalViewer` component to the user in the chat

Try asking the agent to research something, like Dogs. Eventually you'll see it ask you for feedback about the proposal.

```
Please research dogs!
```

Now, we can completely run our agent from start to finish to conduct research. However, you may notice that the research does not populate in the right window
as it completes. In the next step, we'll leverage the CoAgent concept of shared state to populate the research in the right window.

### Step 6: Shared State
- Route: `/langgraph/tutorials/agent-native-app/step-6-shared-state`
- Source: `docs/content/docs/integrations/langgraph/tutorials/agent-native-app/step-6-shared-state.mdx`

In LangGraph, your agents are stateful. This means that they as your graph traverses nodes, the overall application state will be updated and persisted.

CopilotKit allows you to easily read and update this state through the use of two main hooks:
- [`useCoAgent`](/reference/v1/hooks/useCoAgent) - Provides a way to read and write Agent state anywhere in your application.
- [`useCoAgentStateRender`](/reference/v1/hooks/useCoAgentStateRender) - Provides a way to render Agent state in the chat.

With this in mind, our current goal is to create a bidirectional connection between the application's state and the LangGraph agent's state. This will
allow us to render the agent's completed research in the right panel.

For this, we'll be using the `useCoAgent` hook.

The `useCoAgentStateRender` will be used in the next step to render the agent's progress in the chat.

## Understanding our agent's state
The state of our agent can be found in `agent/state.py`.

```python title="agent/state.py"
# ...
from typing import Dict, Union, List
from langgraph.graph import MessagesState

class ResearchState(MessagesState):
    title: str
    proposal: Dict[str, Union[str, bool, Dict[str, Union[str, bool]]]]  # Stores proposed structure before user approval
    outline: dict
    sections: List[dict]  # list of dicts with 'title','content',and 'idx'
    footnotes: str
    sources: Dict[str, Dict[str, Union[str, float]]]
    tool: str
    logs: List[dict]  # list of dicts logs to be sent to frontend with 'message', 'status'
```

There are a few things to note here, but let's focus on the `proposal` field and `sections` field.

- The `proposal` field is a dictionary that stores the proposed research structure before the user approves it.
- The `sections` field is a list of dictionaries, each containing a `title`, `content`, and `idx`. This is the actual research that will be displayed in the right panel.

We've already wired up the approval of the `proposal` field in the previous step, so now we need to wire up rendering for the `sections` field.

## The `useCoAgent` hook
Our current goal is to create a bidirectional connection between these two states. Luckily, the [`useCoAgent`](/reference/v1/hooks/useCoAgent) hook makes this easy.

In the `useResearch` hook, we'll just replace our React state objects with the `useCoAgent` hook.

```tsx title="frontend/src/components/research-context.tsx" {3,8-11}
// ...
import { useAgent } from "@copilotkit/react-core/v2"; // [!code ++]
// ...

interface ResearchContextType {
    state: ResearchState;
    setResearchState: (newState: ResearchState | ((prevState: ResearchState) => ResearchState)) => void
    sourcesModalOpen: boolean
    setSourcesModalOpen: (open: boolean) => void
    runAgent: () => void
}

const ResearchContext = createContext<ResearchContextType | undefined>(undefined)

export function ResearchProvider({ children }: { children: ReactNode }) {
    const [sourcesModalOpen, setSourcesModalOpen] = useState<boolean>(false)
    // [!code ++:5]
    const { state, setState, run } = useAgent<ResearchState>({
        name: 'agent',
        initialState: {},
    });
    const [state, setState] = useState<ResearchState>({} as ResearchState) // [!code --]

    // ...

    return (
        <ResearchContext.Provider
            value={{
              state,
              setResearchState: setState as ResearchContextType['setResearchState'],
              setSourcesModalOpen,
              sourcesModalOpen,
              runAgent: run  // [!code ++]
              runAgent: () => {} // [!code --]
            }}>
            {children}
        </ResearchContext.Provider>
    )
}

export function useResearch() {
    const context = useContext(ResearchContext)
    if (context === undefined) {
        throw new Error('useResearch must be used within a ResearchProvider')
    }
    return context
}
```

The `useCoAgent` hook is generic. What this means is that we can specify a type for that represents the state of the LangGraph agent.
If you are going to specify a type, you should be very careful that the type has the same shape as the state of your LangGraph agent.

It is not recommended, but you can ditch the type parameter and instead get an `any` type.

In this example, we use the `useCoAgent` hook to wire up the application's state to the LangGraph agent's state.
- For the generic type, we pass the `AgentState` type that was already defined for the application in `@/lib/types.ts`.
- For the `name` parameter, we pass the name of the graph as defined in `agent/langgraph.json`.
- For the `initialState` parameter, we pass the initial state of the LangGraph agent which is already defined in `@/lib/trips.ts`.

## Recap
Now we can see the final result of the research in the right panel! To recap, we did the following:
- Learned about the agent's state.
- Added the `useCoAgent` hook to our application to render the `sections` field.

Now, try running the agent again and going through the same steps. At the end, you'll see the completed research in the right panel.

```
Please research dogs!
```

Now, we can completely run our agent from start to finish *and* see the finalized research in the right window.

However, you may notice that the research takes a long time to complete without any indication of progress. In the next step, we'll leverage the CoAgent concepts
of **generative ui** to communicate the agent's progress in the chat.

### Step 7: Agentic Generative UI
- Route: `/langgraph/tutorials/agent-native-app/step-7-generative-ui`
- Source: `docs/content/docs/integrations/langgraph/tutorials/agent-native-app/step-7-generative-ui.mdx`

We're almost done! In this step, we're going to add generative UI to the application so that we can visualize the agent
state in the chat UI. The end goal with this is to allow the user to see the progress of the agent's research as it is
completed.

We call UI that is rendered from the state of the agent or its tool calls "Generative UI".

For this guide, we're going to start using the CopilotKit SDK to emit the state of the agent manually. This is because
in LangGraph, state is only updated when a node change occurs (i.e, an edge is traversed).

As such, in-progress work is not emitted to the user by default. However, we can manually emit the state using the `copilotkit_emit_state`
function. With that emitted state, we'll be using the `useCoAgentStateRender` hook to render updates in the chat to give the user
a sense of progress.

## CopilotKit Python SDK
This tutorial already comes with the CopilotKit Python SDK installed. This allows us to utilize various CopilotKit specific
features, such as emitting state.

  **The package versions in this tutorial are pinned, so updating the dependencies could break the tutorial.**

```bash
    uv add copilotkit
```
```bash
    poetry add copilotkit
```

```bash
    pip install copilotkit --extra-index-url https://copilotkit.gateway.scarf.sh/simple/
```

```bash
    conda install copilotkit -c copilotkit-channel
```

## Manually emit state
The research ANA emits state in a variety of places. For the sake of simplicity, we'll be adding the `copilotkit_emit_state` function
to the `agent/graph.py` file so you can understand how it works. However, state is also emitted in the following files if you'd like to
look at them:
- `agent/tools/outline_writer.py`
- `agent/tools/section_writer.py`
- `agent/tools/tavily_extract.py`
- `agent/tools/tavily_search.py`

Each of these files will write their progress to the `logs` field of the agent's state. Directly after that, we call `copilotkit_emit_state` to emit the state to the frontend.

For example, in the `tool_node` we update some state based on the tool result and then use `copilotkit_emit_state` to emit the state to the frontend.

```python title="agent/graph.py"
# ...
from copilotkit.langchain import copilotkit_emit_state # [!code ++]
#...

async def tool_node(self, state: ResearchState, config: RunnableConfig) -> Command[Literal["process_feedback_node", "call_model_node"]]:
        # ...
        for tool_call in state["messages"][-1].tool_calls:
            # ...

            tool_state = {
                "title": new_state.get("title", ""),
                "outline": new_state.get("outline", {}),
                "sections": new_state.get("sections", []),
                "sources": new_state.get("sources", {}),
                "proposal": new_state.get("proposal", {}),
                "logs": new_state.get("logs", []),
                "tool": new_state.get("tool", {}),
                "messages": msgs
            }
            await copilotkit_emit_state(config, tool_state) # [!code ++]

        return tool_state
```

As this loop is iterated through, the intermediate state that the tools write will be emitted to the frontend. Basically, any time that
you want to emit state to the frontend, you can do so by calling `copilotkit_emit_state`.

## Render the emitted state
Now, our state is being emitted to the frontend. However, we need to render it in the chat. To do this, we'll be using the `useCoAgentStateRender` hook.

```tsx title="frontend/src/app/layout.tsx"
import { useCoAgentStateRender, useLangGraphInterrupt } from "@copilotkit/react-core/v2"; // [!code ++]

export default function HomePage() {
    //...
    const { state: researchState, setResearchState } = useResearch()
    // ...

    // [!code ++:10]
    useCoAgentStateRender<ResearchState>({
        name: 'agent',
        render: ({ state }) => {
            if (state.logs?.length > 0) {
                return <Progress logs={state.logs} />;
            }
            return null;
        },
    }, [researchState]);

    // ...
}
```

## Recap
Try running the agent again and going through the same steps. You'll now notice that the state is streaming intermediately and
the user can see the progress of the agent's research.

```
Please research dogs!
```

To recap, we did the following:
- Learned about how to emit state whenever we want with `copilotkit_emit_state`.
- Added the `useCoAgentStateRender` hook to our application to render the intermediate state in the chat.

We're almost done, just one step to go! Now we're going to learn about **progressive state updates** which will allow us to render the sections as they are written into state. This will
complete the agentic experience.

### Step 8: Progressive State Updates
- Route: `/langgraph/tutorials/agent-native-app/step-8-progressive-state-updates`
- Source: `docs/content/docs/integrations/langgraph/tutorials/agent-native-app/step-8-progressive-state-updates.mdx`

At this point, we've got a pretty functional application. We can run the agent, see the progress in the chat, and see the final research in the right panel.

However, we're still missing one thing. We don't see the LLM actually generating the research, we just see the final result.

In this step, we'll learn how to leverage predictive state rendering to render the agent's progress in the chat. Specifically, we'll be rendering the
sections of the research as they are generated.

For this, we'll be using the `copilotkit_customize_config`.

The `copilotkit_customize_config` function will be used in the next step to render the agent's progress in the chat.

## Create a copilotkit_customize_config and emit intermediate state
CopilotKit allows you to customize the configuration of how your frontend and agent interact with each other. In this case, we want to
setup the `emit_intermediate_state` property. We define a list of objects which will be used to emit the state to the frontend based on
tool calls.

```python title="agent/section_writer.py"
from copilotkit.langchain import copilotkit_customize_config, copilotkit_emit_state // [!code ++]

# ...
@tool("section_writer", args_schema=SectionWriterInput, return_direct=True)
async def section_writer(research_query, section_title, idx, state):
    """Writes a specific section of a research report based on the query, section title, and provided sources."""

    # ...

    # Define the state keys that we want to emit, pre-created for this tutorial
    content_state = {
        "state_key": f"section_stream.content.{idx}.{section_id}.{section_title}",
        "tool": "WriteSection",
        "tool_argument": "content"
    }
    footer_state = {
        "state_key": f"section_stream.footer.{idx}.{section_id}.{section_title}",
        "tool": "WriteSection",
        "tool_argument": "footer"
    }

    # [!code ++:5]
    config = copilotkit_customize_config(
        config,
        emit_intermediate_state=[content_state, footer_state]
    )

    # ...

    # [!code highlight:3]
    # The LLM will take this new config and the tool calls
    # we defined will be emitted to the frontend predictively.
    response = await model.bind_tools([WriteSection]).ainvoke(lc_messages, config)

    # ...

```

There are three main pieces to predictively emit state:
1. The `state_key` is the key of the agent's state that we want to emit.
2. The `tool` is the tool that will be called to generate the state.
3. The `tool_argument` is the argument that will be passed to the tool which will be the predicted state.

## Recap
That's it! Now when the LLM calls the tools that we defined, the state will be predictively emitted to the frontend.

To give it a try, go through the full flow of conducting research. You'll now be able to see the sections as they are being generated.

```
Please research dogs!
```

To recap, we did the following:
- Learned about the `copilotkit_customize_config` function.
- Used the config to emit the state of the agent predictively

You've successfully created a CoAgent using the core concepts of CopilotKit. In the next step, we'll wrap up this tutorial by recapping the entire process
and showing some next steps.

### Overview
- Route: `/langgraph/tutorials/ai-travel-app`
- Source: `docs/content/docs/integrations/langgraph/tutorials/ai-travel-app/index.mdx`

# AI Travel Agentic Copilot Tutorial

## What you'll learn

In this tutorial, you will take a simple travel application and supercharge it with an agentic copilot. You will learn:

- 💡 What an agentic copilot is and how it can be used to enhance your application
- 💡 How to use `useCoAgent` to allow for shared state between your UI and agent execution
- 💡 How to use `useCoAgentStateRender` to implement human-in-the-loop workflows
- 💡 How to render intermediate states of your agent's execution

In the next step, we'll checkout the repo, install dependencies, and start the project locally.

### Next Steps
- Route: `/langgraph/tutorials/ai-travel-app/next-steps`
- Source: `docs/content/docs/integrations/langgraph/tutorials/ai-travel-app/next-steps.mdx`

This is the end of the tutorial. You can now start building your own CoAgents into your appications!

## Source code

You can find the source code and interactive sandboxes here:
- [Start app](https://github.com/CopilotKit/CopilotKit/tree/coagents-travel-tutorial-start/examples/coagents-travel)
- [Final app](https://github.com/CopilotKit/CopilotKit/tree/main/examples/coagents-travel)

## What's next?

For next steps, here are some ideas:

- Add suggestions to your copilot, using the [`useCopilotChatSuggestions`](/reference/v1/hooks/useCopilotChatSuggestions) hook.
- Implement a custom UI for your agent, using the [`useCopilotChat`](/reference/v1/hooks/useCopilotChat) hook.
- Add human editing of tool call arguments to the human in the loop implementation.

We have more tutorials coming soon.

## Need help?

If you have any questions, feel free to reach out to us on [Discord](https://discord.gg/6dffbvGU3D).

### Step 1: Checkout the repo
- Route: `/langgraph/tutorials/ai-travel-app/step-1-checkout-repo`
- Source: `docs/content/docs/integrations/langgraph/tutorials/ai-travel-app/step-1-checkout-repo.mdx`

### Checkout the starting branch
We'll be working with the CopilotKit repository, specifically using a branch called `coagents-travel-tutorial-start`. This branch contains the starting code for our travel app tutorial.

```shell
git clone -b coagents-travel-tutorial-start https://github.com/CopilotKit/CopilotKit.git
cd CopilotKit
```

The tutorial code is located in the `examples/coagents-travel` directory, which contains:
- `ui/`: A NextJS application where we'll integrate our LangGraph agent
- `agent/`: A Python-based LangGraph agent that we'll be enhancing

Go ahead and navigate to the example directory:

```shell
cd examples/coagents-travel
```
### Install dependencies
First, let's set up the NextJS application. Navigate to the `ui` directory and install the dependencies:

```shell
cd ui
pnpm install
```
### Start the project
Launch the development server:

```shell
pnpm run dev
```

Visit [http://localhost:3000](http://localhost:3000) to see the travel app in action. Take some time to explore the interface and familiarize yourself with its features.

Next, let's understand the LangGraph agent and how it works.

### Step 2: LangGraph Agent
- Route: `/langgraph/tutorials/ai-travel-app/step-2-langgraph-agent`
- Source: `docs/content/docs/integrations/langgraph/tutorials/ai-travel-app/step-2-langgraph-agent.mdx`

Before we start integrating the LangGraph agent, let's understand how it works.

For the sake of this tutorial we won't be building the LangGraph together from scratch.
Instead, we'll be using the LangGraph constructed in the `agent/` directory.

If you're interested in a step-by-step guide for building a LangGraph agent, you can checkout the
[LangGraph quickstart guide](https://docs.langchain.com/oss/python/langgraph/quickstart).

Let's walk through the LangGraph agent to understand how it works before we integrate it into the application.

### Install LangGraph Studio

LangGraph Studio is a tool for visualizing and debugging LangGraph workflows. It is not required for using CopilotKit but it is highly recommended
for understanding how LangGraph works.

To install LangGraph Studio, checkout the [setup guide](https://studio.langchain.com/).

### Retreive API keys

For this application, we'll need two API keys:
- OpenAI API key: You can get an API key from the OpenAI console [here](https://platform.openai.com/api-keys).
- Google Maps API key: This can be retrieved from the Google Cloud Console [here](https://developers.google.com/maps/documentation/places/web-service/get-api-key#creating-api-keys).

### Setup the .env file

In a new terminal, navigate to the agent directory.

```shell
cd examples/coagents-travel/agent
```

Now create a .env file there.

```shell
touch .env
```

With that created, we'll want to add your OPENAI_API_KEY and GOOGLE_MAPS_API_KEY to the file.

```txt title=".env"
OPENAI_API_KEY=<your-openai-api-key>
GOOGLE_MAPS_API_KEY=<your-google-maps-api-key>
```

### Visualizing the LangGraph Agent

With LangGraph Studio installed, you can run and visualize the LangGraph agent by opening the `examples/coagents-travel/agent/` directory in the studio.

The agent will take some time to load as things get setup but once finished it will look something like this.

![LangGraph Studio](https://cdn.copilotkit.ai/docs/copilotkit/images/coagents/tutorials/ai-travel-app/lgs-overview.png)

### Understanding the LangGraph Agent

As we're building this agent into an agentic experience, we'll want to understand how it works. The key concepts at play here are:

- **State**: The state is the data that the agent is using to make and communicate its decisions. You can see all of the state variables in the bottom left of the screen.
- **Nodes**: Nodes are the building blocks of a LangGraph agent. They are the steps that the agent will take to complete a task. In this case, we have nodes for **chatting**, **searching** and **performing operations** on trips.
- **Edges**: Edges are the arrows that connect nodes together. They define the logic for how the agent will move from one node to the next. They are defined in code and conditional logic is handled with a `route` function.
- **Interrupts**: Interrupts are a way to allow for a user to work along side the agent and review its decisions. In this case, we have an **interrupt** before the **trips_node** which blocks the agent from proceeding until the user has approved the Agent's actions.

### Testing the LangGraph Agent

You can submit a message to the agent by adding a message to the `messages` state variable and then clicking "Submit".

You'll see the agent respond in the chat and direct appropriately through the various nodes. In this case, you should notice that the
agent calls the `search_node` and, once it has received a response, will add a new trip based on its findings to the state via the
`trips_node`.

### Understanding breakpoints
A very important concept for agentic copilots is [human-in-the-loop](/langgraph/human-in-the-loop). This is the idea that the agent should be able to pause and wait for a human to review and approve its decisions.
LangGraph allows for this by using **breakpoints**. Let's take a look at what that looks like in action.

First, click on the `trips_node` and select the `interrupt_after` option.

Now, try to have the agent create a new trip again. You'll notice that it now asks for approval before proceeding via a `continue` button.

![LangGraph Studio Progress](https://cdn.copilotkit.ai/docs/copilotkit/images/coagents/tutorials/ai-travel-app/lgs-progress.png)

Make sure to remove the `interrupt_after` option before proceeding, this will break things later if you don't.

### Leave LangGraph Studio running

In order to create an agentic copilot, you'll need to have your LangGraph agent running somewhere. In our case, LangGraph studio is
running this locally for us. We can see this by looking at the URL at the bottom left of the application.

![LangGraph Studio URL](https://cdn.copilotkit.ai/docs/copilotkit/images/coagents/tutorials/ai-travel-app/lgs-url.png)

Later in this tutorial, we'll be using this URL to connect CopilotKit to the LangGraph agent.

Here's what we did:
- Installed LangGraph Studio
- Setup the .env file
- Visualized the LangGraph agent
- Tested the LangGraph agent
- Left LangGraph Studio running

In the next step, we'll be integrating the LangGraph agent into the application as an agentic copilot.

### Step 3: Setup CopilotKit
- Route: `/langgraph/tutorials/ai-travel-app/step-3-setup-copilotkit`
- Source: `docs/content/docs/integrations/langgraph/tutorials/ai-travel-app/step-3-setup-copilotkit.mdx`

Now that we have the application and agent running, we're ready to connect both via CopilotKit. For this tutorial, we will install the following dependencies:

- `@copilotkit/react-core`: The core library for CopilotKit, which contains the CopilotKit provider and useful hooks.
- `@copilotkit/react-ui`: The UI library for CopilotKit, which contains the CopilotKit UI components such as the sidebar, chat popup, textarea and more.

## Install Dependencies

Navigate back to the `ui` directory and install the CopilotKit dependencies:

```shell
pnpm add @copilotkit/react-core @copilotkit/react-ui
```

## Setup CopilotKit

There are two ways of setting up CopilotKit, either by using Copilot Cloud or by self-hosting. Self-hosting will give you more control
over CopilotKit's runtime (our interface to the LLM) but will also require you to manage the extra complexity of running a server. Copilot Cloud
on the other hand is a fully managed service that you can get started with in just a few clicks.

For this tutorial, you can select either option.

We're using CopiloKit cloud as a hosted version of the CopilotKit runtime. The runtime serves as an interface between the application and the LLM
(agentic or not). Copilot Cloud will manage all of the complexity for us but in return we need to provide a valid API key.
### Create an account on Copilot Cloud

First, you'll need to create an account for Copilot Cloud [here](https://cloud.copilotkit.ai/sign-in). You can
use whatever authentication method you'd like.

### Get a Copilot Cloud API Key

Once logged in, you'll see some steps guiding you to getting our Copilot Cloud public API key. For this, you'll need an OpenAI API key since it's the only
provider currently supported (more providers coming soon!).

Set your OpenAI API key, click the green checkmark and you'll see your API key created right below the input.

### Setting up the environment variables

First, create a `.env` file in the `ui` directory.

```shell
touch ui/.env
```

Then, add your Copilot Cloud API key to the file like so:

```txt title="ui/.env"
NEXT_PUBLIC_CPK_PUBLIC_API_KEY=...
```

### Configure the CopilotKit Provider

Now we're ready to configure the CopilotKit provider in our application.

```tsx title="ui/app/page.tsx" showLineNumbers
"use client";

import { CopilotKit } from "@copilotkit/react-core/v2"; // [!code ++]

export default function Home() {
  // [!code ++:5]
  return (
    <CopilotKit
      publicApiKey={process.env.NEXT_PUBLIC_CPK_PUBLIC_API_KEY}
    >
      <TooltipProvider>
        <TripsProvider>
          <main className="h-screen w-screen">
            <MapCanvas />
          </main>
        </TripsProvider>
      </TooltipProvider>
    </CopilotKit> // [!code ++]
  );
}
```

### CopilotKit Chat Popup

We provide several plug-and-play components for you to interact with your copilot. Some of these are ``, ``, and ``. You can of course use CopilotKit in headless mode and provide your own fully custom UI via [`useCopilotChat`](/reference/v1/hooks/useCopilotChat).

In this tutorial, we'll use the `` component to display the chat sidebar.

```tsx title="ui/app/page.tsx" showLineNumbers {6-7,15}
"use client";

import { TasksList } from "@/components/TasksList";
import { TasksProvider } from "@/lib/hooks/use-tasks";
import { CopilotKit } from "@copilotkit/react-core/v2";
import { CopilotSidebar } from "@copilotkit/react-core/v2"; // [!code ++]
import "@copilotkit/react-ui/v2/styles.css"; // [!code ++]

export default function Home() {
  return (
    <CopilotKit
      publicApiKey={process.env.NEXT_PUBLIC_CPK_PUBLIC_API_KEY}
    >
      /* [!code ++:9] */
      <CopilotSidebar
        defaultOpen={true}
        clickOutsideToClose={false}
        labels={{
          modalHeaderTitle: "Travel Planner",
          welcomeMessageText: "Hi! 👋 I'm here to plan your trips. I can help you manage your trips, add places to them, or just generally work with you to plan a new one.",
        }}
      />
      <TooltipProvider>
        <TripsProvider>
          <main className="h-screen w-screen">
            <MapCanvas />
          </main>
        </TripsProvider>
      </TooltipProvider>
    </CopilotKit>
  );
}
```

And we're done! Here's what we did:

- We setup our Copilot cloud account and got an API key.
- We configured the CopilotKit provider in our application to use our API key.
- We added the CopilotSidebar to our application.

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
```tsx title="app/page.tsx" showLineNumbers
"use client";

import { TasksList } from "@/components/TasksList";
import { TasksProvider } from "@/lib/hooks/use-tasks";
import { CopilotKit } from "@copilotkit/react-core/v2"; // [!code ++]

export default function Home() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit"> // [!code ++]
      <TasksProvider>
        <TasksList />
      </TasksProvider>
    </CopilotKit> // [!code ++]
  );
}
```

### CopilotKit Chat Popup

We provide several plug-and-play components for you to interact with your copilot. Some of these are ``, ``, and ``. You can of course use CopilotKit in headless mode and provide your own fully custom UI via [`useCopilotChat`](/reference/v1/hooks/useCopilotChat).

In this tutorial, we'll use the `` component to display the chat sidebar.

```tsx title="ui/app/page.tsx" showLineNumbers {6-7,15}
"use client";

import { TasksList } from "@/components/TasksList";
import { TasksProvider } from "@/lib/hooks/use-tasks";
import { CopilotKit } from "@copilotkit/react-core/v2";
import { CopilotSidebar } from "@copilotkit/react-core/v2"; // [!code ++]
import "@copilotkit/react-ui/v2/styles.css"; // [!code ++]

export default function Home() {
  return (
    <CopilotKit
      publicApiKey={process.env.NEXT_PUBLIC_CPK_PUBLIC_API_KEY}
    >
      /* [!code ++:9] */
      <CopilotSidebar
        defaultOpen={true}
        clickOutsideToClose={false}
        labels={{
          modalHeaderTitle: "Travel Planner",
          welcomeMessageText: "Hi! 👋 I'm here to plan your trips. I can help you manage your trips, add places to them, or just generally work with you to plan a new one.",
        }}
      />
      <TooltipProvider>
        <TripsProvider>
          <main className="h-screen w-screen">
            <MapCanvas />
          </main>
        </TripsProvider>
      </TooltipProvider>
    </CopilotKit>
  );
}
```

Here's what we did:

- We imported the `` component from `@copilotkit/react-ui`.
- We wrapped the page with the `` provider.
- We imported the built-in styles from `@copilotkit/react-ui`.

Now, head back to the app and you'll find a chat sidebar on the left side of the page. At this point, you can start interacting with your copilot! 🎉

This is very exciting! In the next step we'll be making this copilot agentic through the use of LangGraph.

### Step 4: Integrate the Agent
- Route: `/langgraph/tutorials/ai-travel-app/step-4-integrate-the-agent`
- Source: `docs/content/docs/integrations/langgraph/tutorials/ai-travel-app/step-4-integrate-the-agent.mdx`

At this point, we have a LangGraph agent running in LangGraph Studioand have our own non-agentic copilot that we can interact with. Now, let's
combine the two together to make an agentic copilot!

## The React State

Let's quickly review how the app's state works. Open up the [`lib/hooks/use-trips.tsx`](https://github.com/CopilotKit/CopilotKit/blob/coagents-travel-tutorial-start/examples/coagents-travel/ui/lib/hooks/use-trips.tsx) file.

At a glance, we can see that the file exposes a provider (`TripsProvider`), which defines a lot useful things. The main thing we care about is the `state` object which takes the shape of the `AgentState` type. This is consumable by a `useTrips` hook, which we use in the rest of the application (feel free to check out the `TripCard`,
`TripContent` and `TripSelect` components).

This resembles the majority of React apps, where frontend state, either for a feature or the entire app, is managed by a context or state management library.

## Integrate the Agent

To integrate the agent into this state, we're going to need to register an agent with CopilotKit and then use the `useCoAgent` hook to connect the two.

## Register the agent

Make sure you have the LangGraph Studio endpoint from the previous step!

We're going to use the CopilotKit CLI to setup a tunnel between our locally running LangGraph agent and Copilot Cloud. You'll
need the port number of the LangGraph Studio endpoint we setup earlier.

It'll be on the bottom left of the LangGraph Studio interface like this.

To open a tunnel, run the following command.

```bash
# replace <port_number> with the port number of the LangGraph Studio endpoint
npx copilotkit@latest dev --port <port_number>
```

It will guide you through the process of selecting a project and creating a tunnel. You should see output similar to the following.

```bash
✔ Select a project Local (ID: <project_id>)
✅ LangGraph Platform endpoint detected
⠹ Creating tunnel...

Tunnel Information:

• Tunnel URL:            https://<tunnel_id>.tunnels.devcopilotkit.com
• Endpoint Type:         LangGraph Platform
• Project:               projects/<project_id>

Press Ctrl+C to stop the tunnel

✔ 🚀 Local tunnel is live and linked to Copilot Cloud!
```

In our previously setup `/api/copilotkit` route, we're going to add the following.

```tsx title="ui/app/api/copilotkit/route.ts"
// ...

import { CopilotRuntime, LangGraphAgent } from '@copilotkit/runtime'; // [!code ++]

// ...

const runtime = new CopilotRuntime();// [!code --]
// [!code ++:10]
const runtime = new CopilotRuntime({
  // [!code highlight:7]
  agents: {
    'travel': new LangGraphAgent({
      deploymentUrl: "http://localhost:<port_number>",
      graphId: 'travel',
      langsmithApiKey: "your-langsmith-api-key" // Optional
    }),
  },
});

// ...
```

The `deploymentUrl` is the URL from LangGraph Studio but it can also be a graph hosted in LangGraph Platform!

This allows CopilotKit to know where to send requests to when the agent is called.

## Lock the agent

By default, CopilotKit will intelligently route requests to the appropriate agent based on context. This allows
you to have multiple agents and actions and not have to worry about manually routing requests.

In our case however, we only have a single agent and its ideal to lock all requests to that agent. We can do this
by updating the props of our `CopilotKit` provider.

```tsx title="ui/app/page.tsx"
// ...
<CopilotKit
  // ...
  agent="travel" // [!code ++]
>
  {...}
</CopilotKit>
```

This will ensure that every request is sent to the `travel` agent. The `travel` name is defined in the [agents/langgraph.json](https://github.com/CopilotKit/CopilotKit/blob/main/examples/coagents-travel/agent/langgraph.json)
file. When we deploy our agent to Copilot Cloud this is automatically handled for us. When self-hosting, we need to specify the name of the agent in the `langGraphPlatformEndpoint` constructor.

## The `useCoAgent` hook

LangGraph agents are stateful, meaning that they can maintain their own state. We saw this earlier when we were using LangGraph Studio, in the bottom left. We
also have the application's state through React.

Our current goal is to create a bidirectional connection between these two states. Luckily, the [`useCoAgent`](/reference/v1/hooks/useCoAgent) hook makes this easy.

```tsx title="ui/lib/hooks/use-trips.tsx" {3,8-11}
// ...
// [!code word:AgentState:1]
import { Trip, Place, AgentState, defaultTrips} from "@/lib/trips";
import { useAgent } from "@copilotkit/react-core/v2"; // [!code ++]

export const TripsProvider = ({ children }: { children: ReactNode }) => {
  // [!code --:5]
  const [state, setState] = useState<{ trips: Trip[], selected_trip_id: string | null }>({
    trips: defaultTrips,
    selected_trip_id: defaultTrips && defaultTrips[0] ? defaultTrips[0].id : null
  });
  // [!code ++:9]
  const { state, setState } = useAgent<AgentState>({
    name: "travel",
    initialState: {
      trips: defaultTrips,
      selected_trip_id: defaultTrips[0].id,
    },
  });

  // ...
```

The `useCoAgent` hook is generic. What this means is that we can specify a type for that represents the state of the LangGraph agent.
If you are going to specify a type, you should be very careful that the type has the same shape as the state of your LangGraph agent.

It is not recommended, but you can ditch the type parameter and instead get an `any` type.

In this example, we use the `useCoAgent` hook to wire up the application's state to the LangGraph agent's state.
- For the generic type, we pass the `AgentState` type that was already defined for the application in `@/lib/types.ts`.
- For the `name` parameter, we pass the name of the graph as defined in `agent/langgraph.json`.
- For the `initialState` parameter, we pass the initial state of the LangGraph agent which is already defined in `@/lib/trips.ts`.

## Try it out!

Now, try it out! Ask the Copilot something about the state of your trips. For example:

```
What trips do I currently have?
```

The state is shared between the application and the agent, so you can edit a trip manually, ask the same question,
and the agent will know about it.

```
What trips do I have now?
```

In the same vein, you can ask the agent to update your trips and it will render in the UI. For example:

```
Add some hotels to my NYC trip
```

Its really that simple, you have now integrated a LangGraph agent into the application as an agentic copilot. In the following
steps, we'll be improving the user experience but the core agent is now accessible through the application's chat interface.

### Step 5: Stream Progress
- Route: `/langgraph/tutorials/ai-travel-app/step-5-stream-progress`
- Source: `docs/content/docs/integrations/langgraph/tutorials/ai-travel-app/step-5-stream-progress.mdx`

Now that we have integrated the LangGraph agent into the application, we can start utilizing features that will enhance the
user agentic experience even further. For example, what if we could stream the progress of a search to the user?

In this step, we'll be doing just that. To do so we'll be using the `copilotkit_emit_state` CopilotKit SDK function in the
`search_node` of our LangGraph agent.

## Install the CopilotKit SDK

CopilotKit comes ready with an SDK for building both Python and Typescript agents. In this case, the agent is written in Python
(manged with `poetry`), so we'll be installing the Python SDK.

Don't have poetry installed? [Install it here](https://python-poetry.org/docs/#installation).

```shell title="agent/"
poetry add copilotkit
# or including support for crewai
poetry add copilotkit[crewai]
```

Now we're ready to use the CopilotKit SDK in our agent! Since we're editing the `search_node` in agent, we'll be
editing the `search.py` file.

## Manually emitting the agent's state

With CoAgents, the LangGraph agent's state is only emitted when node change occurs (i.e, an edge is traversed). This means
that in-progress work is not emitted to the user by default. However, we can manually emit the state using the `copilotkit_emit_state`
function that we mentioned earlier.

### Add the custom CopilotKit config to the `search_node`
First, we're going to add a custom copilotkit config to the `search_node` to describe what intermediate state
we'll be emitting.

```python title="agent/travel/search.py" {3-5}
# ...
from copilotkit.langgraph import copilotkit_emit_state, copilotkit_customize_config # [!code ++]

async def search_node(state: AgentState, config: RunnableConfig):
    """
    The search node is responsible for searching the for places.
    """
    ai_message = cast(AIMessage, state["messages"][-1])

    # [!code ++:9]
    config = copilotkit_customize_config(
        config,
        emit_intermediate_state=[{
            "state_key": "search_progress",
            "tool": "search_for_places",
            "tool_argument": "search_progress",
        }],
    )

    # ...
```
### Emit the intermediate state
Now we can call `copilotkit_emit_state` to emit the intermediate state wherever we want. In this case, we'll be emitting it
progress at the beginning of our search and as we receive results.

One piece of this that has already been setup for you is the `search_progress` state key. In order to emit progress, we add
an object to our state that we'll manually update with the results and progress of our search. Then we'll be calling `copilotkit_emit_state`
to manually emit that state.

```python title="agent/travel/search.py"
# ...
async def search_node(state: AgentState, config: RunnableConfig):
    """
    The search node is responsible for searching the for places.
    """
    ai_message = cast(AIMessage, state["messages"][-1])

    config = copilotkit_customize_config(
        config,
        emit_intermediate_state=[{
            "state_key": "search_progress",
            "tool": "search_for_places",
            "tool_argument": "search_progress",
        }],
    )

    # ^ Previous code

    state["search_progress"] = state.get("search_progress", [])
    queries = ai_message.tool_calls[0]["args"]["queries"]

    for query in queries:
        state["search_progress"].append({
            "query": query,
            "results": [],
            "done": False
        })

    await copilotkit_emit_state(config, state) # [!code ++]

    # ...
```

Now the state of our search will be emitted through the `search_progress` state key to CopilotKit! However, we still need to update this
state as we receive results from our search.

```python title="agent/travel/search.py"
# ...
async def search_node(state: AgentState, config: RunnableConfig):
    """
    The search node is responsible for searching the for places.
    """
    ai_message = cast(AIMessage, state["messages"][-1])

    config = copilotkit_customize_config(
        config,
        emit_intermediate_state=[{
            "state_key": "search_progress",
            "tool": "search_for_places",
            "tool_argument": "search_progress",
        }],
    )

    state["search_progress"] = state.get("search_progress", [])
    queries = ai_message.tool_calls[0]["args"]["queries"]

    for query in queries:
        state["search_progress"].append({
            "query": query,
            "results": [],
            "done": False
        })

    await copilotkit_emit_state(config, state)

    # ^ Previous code

    places = []
    for i, query in enumerate(queries):
        response = gmaps.places(query)
        for result in response.get("results", []):
            place = {
                "id": result.get("place_id", f"{result.get('name', '')}-{i}"),
                "name": result.get("name", ""),
                "address": result.get("formatted_address", ""),
                "latitude": result.get("geometry", {}).get("location", {}).get("lat", 0),
                "longitude": result.get("geometry", {}).get("location", {}).get("lng", 0),
                "rating": result.get("rating", 0),
            }
            places.append(place)
        state["search_progress"][i]["done"] = True
        await copilotkit_emit_state(config, state) # [!code ++]

    state["search_progress"] = []
    await copilotkit_emit_state(config, state) # [!code ++]

    # ...

```

## Recieving and rendering the manaully emitted state

Now that we are manually emitting the state of our search, we can recieve and render that state in the UI. To do this,
we'll be using the [useCoAgentStateRender](/reference/v1/hooks/useCoAgentStateRender) function in our `use-trips.tsx` hook.

All we need to do is tell CopilotKit to conditionally render the `search_progress` state key through the `useCoAgentStateRender` hook.

```tsx title="ui/lib/hooks/use-trips.tsx"
// ...
import { useAgent } from "@copilotkit/react-core/v2"; // [!code --]
import { useAgent, useCoAgentStateRender } from "@copilotkit/react-core/v2"; // [!code ++]
import { SearchProgress } from "@/components/SearchProgress"; // [!code ++]

export const TripsProvider = ({ children }: { children: ReactNode }) => {
  // ...

  const { state, setState } = useAgent<AgentState>({
    name: "travel",
    initialState: {
      trips: defaultTrips,
      selected_trip_id: defaultTrips[0].id,
    },
  });

  // [!code ++:10]
  useCoAgentStateRender<AgentState>({
    name: "travel",
    render: ({ state }) => {
      if (state.search_progress) {
        return <SearchProgress progress={state.search_progress} />
      }
      return null;
    },
  });

  // ...
}

```

The `` component is a custom component that was created for you ahead of time. If you'd like to
learn more about it feel free to check it out in `ui/components/SearchProgress.tsx`!

One other thing done for you ahead of time is that the `search_progress` key is already present in the `AgentState` type. You
can look at that type in `ui/lib/types.ts`.

Give it a try! Ask the agent to search for places and we'll see the progress of each search as it comes in.

The final step is to add human in the loop to the application to allow the user to approve or reject mutative actions the
agent wants to perform.

### Step 6: Human in the Loop
- Route: `/langgraph/tutorials/ai-travel-app/step-6-human-in-the-loop`
- Source: `docs/content/docs/integrations/langgraph/tutorials/ai-travel-app/step-6-human-in-the-loop.mdx`

Now its time to add human in the loop to the application. This will allow the user to approve, reject, or modify mutative actions the
agent wants to perform. For simplicity, we'll be only implementing approve and reject actions in this step.

Our plan is to add a "breakpoint" to the application. This is a LangGraph concept that will force the agent to pause and wait for the
human approval before continuing execution.

You can learn more about breakpoints [here](https://docs.langchain.com/oss/python/langgraph/interrupts#debugging-with-interrupts).

The breakpoint will then be communicated to our front-end which we'll use to render and take the user's decision. Finally, the user's
decision will be communicated back to the agent and execution will continue.

All together, this process will look like this:

If you'd like to learn even more about human in the loop before proceeding, checkout our [Human in the Loop concept guide](/langgraph/human-in-the-loop).

Otherwise, let's get started!

## Add the breakpoint to the `trips_node`

The way that this LangGraph has been implemented allows for easy human in the loop integration. Essentially, we have a `trips_node`
that serves as a proxy to the `perform_trips_node`. This means that we can block entrance to the `perform_trips_node` by adding a breakpoint
to the `trips_node`. This will then force the agent to pause and wait for the human to approve the action before execution can continue.

To add a breakpoint to the agent, we'll be editing the graph definition in the `agent/travel/agent.py` file.

At the very bottom of the file, add the following line to the `compile` function:
```python title="agent/travel/agent.py"
# ...

graph = graph_builder.compile(
    checkpointer=MemorySaver(),
    interrupt_after=["trips_node"], # [!code ++]
)
```

This will force the agent to pause execution at the `trips_node` and wait for the human to approve the action before continuing.
## Update the perform_trips_node node to properly handle the user's decision

Prior to this step, entrance to the `perform_trips_node` was standard. We would recieve the requested tool call, call the appropriate
tool, edit the message state to reflect the tool call results, and then move on to the next node.

However, this will no longer work since we've added a breakpoint to the `trips_node`. In a future step, we'll be utilizing this
breakpoint to render a UI to the user for approval or rejection. Their decision will be communicated back via the message state.

In this step, we'll be retrieving that decison from the message state and acting accordingly.

First, let's grab the tool call message and the tool call being requested.

```python title="agent/travel/trips.py"
# ...

async def perform_trips_node(state: AgentState, config: RunnableConfig):
    """Execute trip operations"""
    ai_message = state["messages"][-1] # [!code --]
    ai_message = cast(AIMessage, state["messages"][-2]) # [!code ++]
    tool_message = cast(ToolMessage, state["messages"][-1]) # [!code ++]

    # ...
```

Now, let's add a conditional that will check the user's decision and act accordingly.

```python title="agent/travel/trips.py"
from copilotkit.langchain import copilotkit_emit_message # [!code ++]

# ...
async def perform_trips_node(state: AgentState, config: RunnableConfig):
    """Execute trip operations"""
    ai_message = cast(AIMessage, state["messages"][-2])
    tool_message = cast(ToolMessage, state["messages"][-1])

    # [!code ++:8]
    if tool_message.content == "CANCEL":
      await copilotkit_emit_message(config, "Cancelled operation of trip.")
      return state

    # handle the edge case where the AI message is not an AIMessage or does not have tool calls, should never happen.
    if not isinstance(ai_message, AIMessage) or not ai_message.tool_calls:
        return state

    # ...
```

In this case, we are checking if the user decided to cancel the operation. If so, we emit a message to the UI and return the state. Any
other decision returned will result in the requested actions being performed.

## Emitting the tool calls
In order for the front-end to recieve the breakpoint and take the user's decision, we'll need to emit the tool calls that the agent is requesting.
To do this, we'll be editing the `chat_node` in the `chat.py` file.
```python title="agent/travel/chat.py"
# ...
from copilotkit.langchain import copilotkit_customize_config # [!code ++]
async def chat_node(state: AgentState, config: RunnableConfig):
    """Handle chat operations"""
    # [!code ++:5]
    config = copilotkit_customize_config(
        config,
        emit_tool_calls=["add_trips", "update_trips", "delete_trips"],
    )
    # ...
```
We don't want to just set True here because doing so will emit all tool calls. By specifying these, we hand are handing off tool
handling to CopilotKit. If, for example, `search_for_places` was called here then it would break the state of tool calls.
With that, our work on the agent is complete and we are ready to update the front-end to properly take and communicate the user's decision.

## Rendering the tool calls and taking the user's decision

Now we need to update the front-end to render the tool calls and emit the user's decision back to the agent. To do this,
we'll be adding `useCopilotAction` hooks for each tool call with the `renderAndWait` option.

```typescript title="ui/lib/hooks/use-trips.tsx"
// ...
import { AddTrips, EditTrips, DeleteTrips } from "@/components/humanInTheLoop"; // [!code ++]
import { useAgent, useCoAgentStateRender } from "@copilotkit/react-core/v2"; // [!code --]
import { useAgent, useCoAgentStateRender, useFrontendTool } from "@copilotkit/react-core/v2"; // [!code ++]
// ...

export const TripsProvider = ({ children }: { children: ReactNode }) => {
  // ...

  useCoAgentStateRender<AgentState>({
    name: "travel",
    render: ({ state }) => {
      return <SearchProgress progress={state.search_progress} />
    },
  });

  // [!code ++:42]
  useFrontendTool({
    name: "add_trips",
    description: "Add some trips",
    parameters: [
      {
        name: "trips",
        type: "object[]",
        description: "The trips to add",
        required: true,
      },
    ],
    renderAndWait: AddTrips,
  });

  useFrontendTool({
    name: "update_trips",
    description: "Update some trips",
    parameters: [
      {
        name: "trips",
        type: "object[]",
        description: "The trips to update",
        required: true,
      },
    ],
    renderAndWait: EditTrips,
  });

  useFrontendTool({
    name: "delete_trips",
    description: "Delete some trips",
    parameters: [
      {
        name: "trip_ids",
        type: "string[]",
        description: "The ids of the trips to delete",
        required: true,
      },
    ],
    renderAndWait: (props) => DeleteTrips({ ...props, trips: state.trips }),
  });

  // ...
```

With that, our front-end is now ready to render the tool calls and take the user's decision. One thing we glossed over
are all of the imported `humanInTheLoop` components. They're provided for the convenience of this tutorial, but we should
note one very important thing - how they send the user's decision back to the agent.

## (optional) Understanding the `humanInTheLoop` components

Let's look at the `DeleteTrips` component as an example, but the same logic applies to the `AddTrips` and `EditTrips` components.

```tsx title="ui/lib/components/humanInTheLoop/DeleteTrips.tsx"
import { Trip } from "@/lib/types";
import { PlaceCard } from "@/components/PlaceCard";
import { X, Trash } from "lucide-react";
import { ActionButtons } from "./ActionButtons"; // [!code highlight]
import { RenderFunctionStatus } from "@copilotkit/react-core/v2";

export type DeleteTripsProps = {
  args: any;
  status: RenderFunctionStatus;
  handler: any;
  trips: Trip[];
};

export const DeleteTrips = ({ args, status, handler, trips }: DeleteTripsProps) => {
  const tripsToDelete = trips.filter((trip: Trip) => args?.trip_ids?.includes(trip.id));

  return (
    <div className="space-y-4 w-full bg-secondary p-6 rounded-lg">
    <h1 className="text-sm">The following trips will be deleted:</h1>
      {status !== "complete" && tripsToDelete?.map((trip: Trip) => (
        <div key={trip.id} className="flex flex-col gap-4">
          <>
            <hr className="my-2" />
            <div className="flex flex-col gap-4">
            <h2 className="text-lg font-bold">{trip.name}</h2>
            {trip.places?.map((place) => (
              <PlaceCard key={place.id} place={place} />
            ))}
            </div>
          </>
        </div>
      ))}
      { status !== "complete" && (
        // [!code highlight:6]
        <ActionButtons
          status={status} 
          handler={handler} 
          approve={<><Trash className="w-4 h-4 mr-2" /> Delete</>} 
          reject={<><X className="w-4 h-4 mr-2" /> Cancel</>} 
        />
      )}
    </div>
  );
};
```

As you can see, this is a fairly standard component that renders the trips that will be deleted. The important part is the `ActionButtons`
component. Let's take a look at it.

```tsx title="ui/lib/components/humanInTheLoop/ActionButtons.tsx"
import { RenderFunctionStatus } from "@copilotkit/react-core/v2";
import { Button } from "../ui/button";

export type ActionButtonsProps = {
    status: RenderFunctionStatus;
    handler: any;
    approve: React.ReactNode;
    reject: React.ReactNode;
}

export const ActionButtons = ({ status, handler, approve, reject }: ActionButtonsProps) => (
  <div className="flex gap-4 justify-between">
    <Button 
      className="w-full"
      variant="outline"
      disabled={status === "complete" || status === "inProgress"} 
      onClick={() => handler?.("CANCEL")} // [!code highlight]
    >
      {reject}
    </Button>
    <Button 
      className="w-full"
      disabled={status === "complete" || status === "inProgress"} 
      onClick={() => handler?.("SEND")} // [!code highlight]
    >
      {approve}
    </Button>
  </div>
);
```

The important piece here is that the `onClick` handlers emit the user's decision back to the agent. If the user clicks the `Delete` button
then the `handler?.("SEND")` is called. If the user clicks the `Cancel` button then the `handler?.("CANCEL")` is called. This is how the
agent recieves the user's decision.

If you wanted to implement a more complex UI that allows for the human to edit the tool call arguments before sending them back to the agent,
you could do so by adding additional logic to the `onClick` handlers and the agent's handling of the tool call.

With that, we've now completed the human in the loop implementation! Try asking the agent to add, edit, or delete some trips and see it in
action.

### Video: Research Canvas
- Route: `/langgraph/videos/research-canvas`
- Source: `docs/content/docs/integrations/langgraph/videos/research-canvas.mdx`

The clip above shows [Tako](https://tako.com) powering an Agent-Native Research canvas—generating interactive visuals from its index of trusted, real-time data spanning finance, sports, politics, and more.

Dive deeper to explore Tako's [documentation](https://docs.tako.com/documentation/integrations-and-examples/langgraph-copilotkit) and their open-source [Research Canvas example](https://github.com/TakoData/tako-copilotkit) built with CopilotKit, LangGraph, Tako, and Tavily.

Explore the step-by-step walkthrough of building an agentic Research Canvas with **CopilotKit and LangGraph**. You can [run the app here](https://examples-coagents-research-canvas-ui.vercel.app/) or browse the [full source code on GitHub](https://github.com/CopilotKit/CopilotKit/blob/main/examples/coagents-research-canvas/readme.md).
