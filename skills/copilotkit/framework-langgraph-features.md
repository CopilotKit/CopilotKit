# LangGraph — Features & Capabilities

Features & Capabilities guide for the LangGraph integration.

> For shared CopilotKit concepts (runtime setup, prebuilt components, troubleshooting, etc.), see the topic guides. This file focuses on framework-specific implementation details.

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
        import { CopilotKit } from "@copilotkit/react-core";
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
    import { useDefaultRenderTool } from "@copilotkit/react-core/v2";

    export default function Page() {
        useDefaultRenderTool({
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

### Video: Research Canvas
- Route: `/langgraph/videos/research-canvas`
- Source: `docs/content/docs/integrations/langgraph/videos/research-canvas.mdx`

The clip above shows [Tako](https://tako.com) powering an Agent-Native Research canvas—generating interactive visuals from its index of trusted, real-time data spanning finance, sports, politics, and more.

Dive deeper to explore Tako's [documentation](https://docs.tako.com/documentation/integrations-and-examples/langgraph-copilotkit) and their open-source [Research Canvas example](https://github.com/TakoData/tako-copilotkit) built with CopilotKit, LangGraph, Tako, and Tavily.

Explore the step-by-step walkthrough of building an agentic Research Canvas with **CopilotKit and LangGraph**. You can [run the app here](https://examples-coagents-research-canvas-ui.vercel.app/) or browse the [full source code on GitHub](https://github.com/CopilotKit/CopilotKit/blob/main/examples/coagents-research-canvas/readme.md).
