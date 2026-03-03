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
                model="openai/gpt-4o",
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
                    model="openai/gpt-4o",
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
                            model="openai/gpt-4o",
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

### Chat with an Agent
- Route: `/crewai-flows/agentic-chat-ui`
- Source: `docs/content/docs/integrations/crewai-flows/agentic-chat-ui.mdx`
- Description: Chat with an agent using CopilotKit's UI components.

This video shows the result of `npx copilotkit@latest init` with the [implementation](#implementation) section applied to it!

## What is this?

Agentic chat UIs are ways for your users to interact with your agent. CopilotKit provides a variety of different components to choose from, each
with their own unique use cases.

If you've gone through the [getting started guide](/crewai-flows/quickstart) **you already have a agentic chat UI setup**! Nothing else is needed
to get started.

## When should I use this?

CopilotKit provides a variety of different batteries-included components to choose from to create agent native applications. They scale
from simple chat UIs to completely custom applications.

    `CopilotPopup` is a convenience wrapper for `CopilotChat` that lives at the same level as your main content in the view hierarchy. It provides **a floating chat interface** that can be toggled on and off.

```tsx
    // [!code word:CopilotPopup]
    import { CopilotPopup } from "@copilotkit/react-ui";

    export function YourApp() {
      return (
        <>
          <YourMainContent />
          <CopilotPopup
            instructions={"You are assisting the user as best as you can. Answer in the best way possible given the data you have."}
            labels={{
              title: "Popup Assistant",
              initial: "Need any help?",
            }}
          />
        </>
      );
    }
```

    `CopilotSidebar` is a convenience wrapper for `CopilotChat` that wraps your main content in the view hierarchy. It provides a **collapsible and expandable sidebar** chat interface.

```tsx
    // [!code word:CopilotSidebar]
    import { CopilotSidebar } from "@copilotkit/react-ui";

    export function YourApp() {
      return (
        <CopilotSidebar
          defaultOpen={true}
          instructions={"You are assisting the user as best as you can. Answer in the best way possible given the data you have."}
          labels={{
            title: "Sidebar Assistant",
            initial: "How can I help you today?",
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
    import { CopilotChat } from "@copilotkit/react-ui";

    export function YourComponent() {
      return (
        <CopilotChat
          instructions={"You are assisting the user as best as you can. Answer in the best way possible given the data you have."}
          labels={{
            title: "Your Assistant",
            initial: "Hi! 👋 How can I assist you today?",
          }}
        />
      );
    }
```

    The built-in Copilot UI can be customized in many ways -- both through css and by passing in custom sub-components.

    CopilotKit also offers **fully custom headless UI**, through the `useCopilotChat` hook. Everything built with the built-in UI (and more) can be implemented with the headless UI, providing deep customizability.

```tsx
    import { useCopilotChat } from "@copilotkit/react-core";
    import { Role, TextMessage } from "@copilotkit/runtime-client-gql";

    export function CustomChatInterface() {
      const {
        visibleMessages,
        appendMessage,
        setMessages,
        deleteMessage,
        reloadMessages,
        stopGeneration,
        isLoading,
      } = useCopilotChat();

      const sendMessage = (content: string) => {
        appendMessage(new TextMessage({ content, role: Role.User }));
      };

      return (
        <div>
          {/* Implement your custom chat UI here */}
        </div>
      );
    }
```

### Agentic Copilots
- Route: `/crewai-flows/concepts/agentic-copilots`
- Source: `docs/content/docs/integrations/crewai-flows/concepts/agentic-copilots.mdx`
- Description: Agentic copilots provide you with advanced control and orchestration over your agents.

Before we dive into what agentic copilots are, help us help you by telling us your level of experience with CrewAI. We'll explain things in a way that best suits your experience level.

        ### What are Agents?
        AI agents are intelligent systems that interact with their environment to achieve specific goals. Think of them as 'virtual colleagues' that can handle tasks ranging from
        simple queries like "find the cheapest flight to Paris" to complex challenges like "design a new product layout."

        As these AI-driven experiences (or 'Agentic Experiences') become more sophisticated, developers need finer control over how agents make decisions. This is where specialized
        frameworks like CrewAI become essential.

        ### What is CrewAI?
        CrewAI is a framework that gives you precise control over AI agents. CrewAI flows allow developers to combine and coordinate coding tasks and Crews efficiently,
        providing a robust framework for building sophisticated AI automations.

        ### What are Agentic Copilots?
        Agentic copilots are how CopilotKit brings CrewAI agents into your application. If you're familiar with CopilotKit, you know that copilots are AI assistants that
        understand your app's context and can take actions within it. While CopilotKit's standard copilots use a simplified [ReAct pattern](https://www.perplexity.ai/search/what-s-a-react-agent-5hu7ZOaKSAuY7YdFjQLCNQ)
        for quick implementation, Agentic copilots give you CrewAI's full orchestration capabilities when you need more control over your agent's behavior.

        ### What are CoAgents?
        CoAgents are what we call CopilotKit's approach to building agentic experiences! They're interchangeable with agentic copilots being a more descriptive term for the overall concept.

        ### When should I use CopilotKit's CoAgents?
        You should use CoAgents when you require tight control over the Agentic runloop, as facilitated by an Agentic Orchestration framework like [CrewAI](https://crewai.com/).
        With CoAgents, you can carry all of your existing CopilotKit-enabled Copilot capabilities into a customized agentic runloop.

        We suggest beginning with a basic Copilot and gradually transitioning specific components to CoAgents.

        The need for CoAgents spans a broad spectrum across different applications. At one end, their advanced capabilities might not be required at all, or only for a minimal 10% of the application's
        functionality. Progressing further, there are scenarios where they become increasingly vital, managing 60-70% of operations. Ultimately, in some cases, CoAgents are indispensable, orchestrating
        up to 100% of the Copilot's tasks (see [agent-lock mode](/crewai-flows/multi-agent-flows) for the 100% case).

        ### Examples
        An excellent example of the type of experiences you can accomplish with CoAgents applications can be found in our [Research Canvas](https://github.com/CopilotKit/CopilotKit/tree/main/examples/coagents-research-canvas).

        More specifically, it demonstrates how CoAgents allow for AI driven experiences with:
        - Precise state management across agent interactions
        - Sophisticated multi-step reasoning capabilities
        - Seamless orchestration of multiple AI tools
        - Interactive human-AI collaboration features
        - Real-time state updates and progress streaming

        ## Next Steps

        Want to get started? You have some options!

        CrewAI is a framework for building deeply customizable AI agents.

        CopilotKit's Agentic Copilots is infrastructure for in-app agent-user interaction, i.e. for transforming agents from autonomous processes to user-interactive 'virtual colleagues' that live inside applications.

        Any CrewAI-based agent can be transformed into an Agentic Copilot with a minimal amount
        of effort to get industry leading agentic UX such as:
        - Shared state between the agent and the application.
        - Intermediate result and state progress streaming
        - Human-in-the-loop collaboration
        - Agentic generative UI
        - And more!

        All of these features are essential to delight instead of frustrate your users with AI features.

        ### What are CoAgents?
        CoAgents are what we call CopilotKit's approach to building agentic experiences! They're interchangeable with agentic copilots being a more descriptive term for the overall concept.

        ## Next Steps
        Want to get started? You have some options!

### Streaming and Tool Calls
- Route: `/crewai-flows/concepts/copilotkit-stream`
- Source: `docs/content/docs/integrations/crewai-flows/concepts/copilotkit-stream.mdx`
- Description: CoAgents support streaming your messages and tool calls to the frontend.

If you'd like to stream messages from your CrewAI agents you can utilize our Copilotkit SDK which provides a collection
of functions and utilities for interacting with the agent's state or behavior. This allows you to choose how messages and
tool calls are emitted and streamed to the frontend.

## Message Streaming

If you just call the LiteLLM `completion` function from your CrewAI agent, messages will not be streamed by default.
To stream messages, wrap the `completion` function with the `copilotkit_stream` function. This will enable streaming
of both the messages and tool calls to the frontend.

```python
response = copilotkit_stream(
    completion(
        model="openai/gpt-4o",
        messages=[
            {"role": "system", "content": my_prompt},
            *self.state["messages"]
        ],
        stream=True
    )
)
```

For more information on how tool calls are utilized check out our [frontend actions](/crewai-flows/frontend-actions)
documentation.

### CrewAI
- Route: `/crewai-flows/concepts/crewai`
- Source: `docs/content/docs/integrations/crewai-flows/concepts/crewai.mdx`
- Description: An agentic framework for building LLM applications that can be used with Copilotkit.

CrewAI is an agentic framework for building LLM applications that can be used with Copilotkit. CrewAi Flows allow developers
to combine and coordinate coding tasks and Crews efficiently, providing a robust framework for building sophisticated AI automations.

## CoAgents and CrewAI

How do CoAgents extend CrewAI? Let's read the first sentence of their [page on Flows](https://docs.crewai.com/concepts/flows) to understand.

> Flows allow you to create structured, event-driven workflows. They provide a seamless way to connect multiple tasks, manage state, and control the flow of execution in your AI applications.

Let's break down some key terms and understand how they relate to and are implemented by CoAgents.

- ** manage state**: CoAgents have bi-directional state sharing with the agent and UI. This allows for the agent to remember
  information from previous messages and the UI to update the agent with new information. Read more about how state sharing works
  [here](/crewai-flows/shared-state).
- **Multi-actor**: CoAgents allow for multiple agents to interact with each other. Copilotkit acts as the "ground-truth"
  when transitioning between agents. Read more about how multi-actor workflows work [here](/crewai-flows/multi-agent-flows)
  and how messages are managed [here](/crewai-flows/concepts/message-management).
- **LLMs**: CoAgents use large language models to generate responses. This is useful for building applications that need to
  generate natural language responses.

Some additional functionality not mentioned here is:

- **Human in the loop**: CoAgents enabled human review and approval of generated responses. Read more about how this works
  [here](/crewai-flows/human-in-the-loop).
- **Tool calling**: Tool calling is a fundamental building block for agentic workflows. They allow for greater control over what
  the agent can do and can be used to interact with external systems. CoAgents allow you to easily render in-progress
  tool calls in the UI so your users know what's happening. Read more about streaming tool calls [here](/crewai-flows/shared-state/predictive-state-updates).

## Building with Python

You can build CrewAI applications using Python. Check out the [CrewAI docs](https://docs.crewai.com/introduction) for more information.

## CrewAI Enterprise

Turn any crew into an API within seconds
Connect to your apps using hooks, REST, gRPC and more
Get access to templates, custom tools and early UI
Get business support, SLA, private VPC

CrewAI enterprise is a platform for deploying and monitoring CrewAI applications. Read more about it on the
[CrewAI website](https://www.crewai.com/enterprise).

If you want to take the next step to deploy your CrewAI application as an CoAgent, check out our [quickstart guide](/crewai-flows/quickstart).

### Message flow
- Route: `/crewai-flows/concepts/message-management`
- Source: `docs/content/docs/integrations/crewai-flows/concepts/message-management.mdx`

Message management in CoAgents operates with CopilotKit as the "ground truth" for the full chat session.
When an CoAgent session begins, it receives the existing CopilotKit chat history to maintain conversational
continuity across different agents.

  While all of this information is great to know, in most cases you won't need
  to worry about these details to build rich agentic applications. Use the
  information here as a reference when getting really deep into the CoAgent
  internals.

### Can I modify the message history?

You can modify the message history from CrewAI Flows by using the `"messages"` key in the state. For example to remove all messages from the chat history:

```python

def a_flow_function():
    # ...
    self.state["messages"] = []
```

### Can I persist chat history?

Yes! There are a few ways to persist various portions of a chat's history:

- [Threads](/crewai-flows/persistence/loading-message-history)
- [Message Persistence](/crewai-flows/persistence/message-persistence)
- [Agent State](/crewai-flows/persistence/loading-agent-state)

## Types of LLM Messages

Modern LLM interactions produce two distinct types of messages:

1. **Communication Messages**: Direct responses and interactions with users
2. **Internal Messages**: Agent "thoughts" and reasoning processes

A well known example of this pattern is OpenAI's o1 model, which has sophisticated reasoning capabilities and thoughts. Its internal
thought processes are presented distinctly from 'communication messages' which are clearly visible to the end-user.

CrewAI agents can operate similarly. An LLM call's output can be considered either a communication message, or an internal message.

### Emitting Messages for long running tasks

Sometimes you'll have a task that is running for a long time, and you want the user to be aware of what's happening.
CopilotKit allows you to accomplish this by using the `copilotkit_emit_message` function.

```python
@listen("route_to_ask_name")
async def ask_name():
    """
    Ask the user for their name.
    """

    content = "Hey, what is your name? 🙂"

    await copilotkit_emit_message(content)

    # something long running here...

    self.state["messages"].append({"role": "assistant", "content": content, "id": str(uuid.uuid4())})

```

Want some more help managing messages in your CoAgent application? Check out our guide on [emitting messages](/crewai-flows/advanced/emit-messages).

## Message Flow

Messages flow between CopilotKit and CrewAI in a specific way:

- All messages from CrewAI are forwarded to CopilotKit
- On a fresh agent invocation, the full CopilotKit chat history is provided to the CrewAI agent as its pre-existing chat history.

When a CoAgent completes its execution, its relevant messages become part of CopilotKit's persistent chat history. This allows for all future agent invocations to get context from the full chat history.

### Shared State
- Route: `/crewai-flows/concepts/state`
- Source: `docs/content/docs/integrations/crewai-flows/concepts/state.mdx`
- Description: CoAgents maintain a shared state across your UI and agent execution.

CoAgents maintain a shared state that seamlessly connects your UI with the agent's execution. This shared state system allows you to:

- Display the agent's current progress and intermediate results
- Update the agent's state through UI interactions
- React to state changes in real-time across your application

The foundation of this system is built on CrewAI's stateful architecture. CrewAI Flow agents maintain their
internal state throughout execution, which you can access via the `useCoAgentState` hook.

### Understanding Predicted State

While your agent runs, you can emit state updates using CopilotKit's `emit_intermediate_state` function, ensuring your UI stays synchronized
with the agent's progress. The emitted state is called the **predicted state** and is used to provide immediate feedback about ongoing
operations.

While the core shared state reflects the agent's current function in the flow, the predicted state provides immediate
feedback about ongoing operations. Accordingly, this creates a more fluid user experience by showing real-time progress before the agent
completes its current task.

When the state is updated (when a function finishes executing), the predicted state is updated with the new state.

For example, when your agent is processing a request, the predicted state might show a loading indicator or partial results, while the actual
shared state updates once the operation is complete.

Want help implementing this into your CoAgent application? Check out our [intermediate state streaming](/crewai-flows/shared-state/predictive-state-updates)
documentation.

### Terminology
- Route: `/crewai-flows/concepts/terminology`
- Source: `docs/content/docs/integrations/crewai-flows/concepts/terminology.mdx`

Here are the key terms and concepts used throughout CoAgents:

| Term                         | Definition                                                                                                                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agentic Copilot              | An AI agent designed to collaborate with users in Agent-Native applications, rather than operate autonomously.                                                                                     |
| CoAgent                      | Terminology referring to CopilotKit's suite of tools for building agentic applications. Typically interchangeable with agentic copilot.                                                            |
| Agent State                  | The current data and context maintained by a CrewAI agent during its execution, including both internal state and data that can be synchronized with the frontend UI.                              |
| Agentic Generative UI        | UI components that are dynamically generated and updated based on the agent's current state, providing users with visibility into what the agent is doing and building trust through transparency. |
| Ground Truth                 | In CoAgents, CopilotKit serves as the "ground truth" for the full chat session, maintaining the persistent chat history and ensuring conversational continuity across different agents.            |
| Human-in-the-Loop (HITL)     | A workflow pattern where human input or validation is required during agent execution, enabling quality control and oversight at critical decision points.                                         |
| Intermediate State           | The updates to agent state that occur during function execution, rather than only at flow transitions, enabling real-time feedback about the agent's progress.                                     |
| [CrewAI](https://crewai.com) | The agent framework integrated with CopilotKit that provides the orchestration layer for CoAgents, enabling sophisticated multi-step reasoning and state management.                               |
| Agent Lock Mode              | A mode where CopilotKit is configured to work exclusively with a specific agent, ensuring all requests stay within a single workflow graph for precise control.                                    |
| Router Mode                  | A mode where CopilotKit dynamically routes requests between different agents and tools based on context and user input, enabling flexible multi-agent workflows.                                   |
| State Streaming              | The real-time synchronization of agent state between the backend and frontend, enabling immediate updates to the UI as the agent performs tasks.                                                   |

These terms are referenced throughout the documentation and are essential for understanding how CoAgents work and how to implement them effectively in your applications.

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

### Custom Sub-Components
- Route: `/crewai-flows/custom-look-and-feel/bring-your-own-components`
- Source: `docs/content/docs/integrations/crewai-flows/custom-look-and-feel/bring-your-own-components.mdx`

```tsx
import { type UserMessageProps } from "@copilotkit/react-ui";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";

const CustomUserMessage = (props: UserMessageProps) => {
  const wrapperStyles = "flex items-center gap-2 justify-end mb-4";
  const messageStyles = "bg-blue-500 text-white py-2 px-4 rounded-xl break-words flex-shrink-0 max-w-[80%]";
  const avatarStyles = "bg-blue-500 shadow-sm min-h-10 min-w-10 rounded-full text-white flex items-center justify-center";

  return (
    <div className={wrapperStyles}>
      <div className={messageStyles}>{props.message?.content}</div>
      <div className={avatarStyles}>TS</div>
    </div>
  );
};

<CopilotKit>
  <CopilotSidebar UserMessage={CustomUserMessage} />
</CopilotKit>
```
```tsx
import { type AssistantMessageProps } from "@copilotkit/react-ui";
import { useChatContext } from "@copilotkit/react-ui";
import { Markdown } from "@copilotkit/react-ui";
import { SparklesIcon } from "@heroicons/react/24/outline";

import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";

const CustomAssistantMessage = (props: AssistantMessageProps) => {
  const { icons } = useChatContext();
  const { message, isLoading, subComponent } = props;

  const avatarStyles = "bg-zinc-400 border-zinc-500 shadow-lg min-h-10 min-w-10 rounded-full text-white flex items-center justify-center";
  const messageStyles = "px-4 rounded-xl pt-2";

  const avatar = <div className={avatarStyles}><SparklesIcon className="h-6 w-6" /></div>

  // [!code highlight:12]
  return (
    <div className="py-2">
      <div className="flex items-start">
        {!subComponent && avatar}
        <div className={messageStyles}>
          {message && <Markdown content={message.content || ""} /> }
          {isLoading && icons.spinnerIcon}
        </div>
      </div>
      <div className="my-2">{subComponent}</div>
    </div>
  );
};

<CopilotKit>
  <CopilotSidebar AssistantMessage={CustomAssistantMessage} />
</CopilotKit>
```
```tsx
import { type WindowProps, useChatContext, CopilotSidebar } from "@copilotkit/react-ui";
import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";
function Window({ children }: WindowProps) {
  const { open, setOpen } = useChatContext();

  if (!open) return null;

  // [!code highlight:15]
  return (
    <div 
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
      onClick={() => setOpen(false)}
    >
      <div 
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full h-[80vh] overflow-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex flex-col h-full">
          {children}
        </div>
      </div>
    </div>
  );
};

<CopilotKit>
  <CopilotSidebar Window={Window} />
</CopilotKit>
```
```tsx
import { type ButtonProps, useChatContext, CopilotSidebar } from "@copilotkit/react-ui";
import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";
function Button({}: ButtonProps) {
  const { open, setOpen } = useChatContext();

  const wrapperStyles = "w-24 bg-blue-500 text-white p-4 rounded-lg text-center cursor-pointer";

  // [!code highlight:10]
  return (
    <div onClick={() => setOpen(!open)} className={wrapperStyles}>
      <button
        className={`${open ? "open" : ""}`}
        aria-label={open ? "Close Chat" : "Open Chat"}
      >
        Ask AI
      </button>
    </div>
  );
};

<CopilotKit>
  <CopilotSidebar Button={Button} />
</CopilotKit>
```
```tsx
import { type HeaderProps, useChatContext, CopilotSidebar } from "@copilotkit/react-ui";
import { BookOpenIcon } from "@heroicons/react/24/outline";
import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";
function Header({}: HeaderProps) {
  const { setOpen, icons, labels } = useChatContext();

  // [!code highlight:15]
  return (
    <div className="flex justify-between items-center p-4 bg-blue-500 text-white">
      <div className="w-24">
        <a href="/">
          <BookOpenIcon className="w-6 h-6" />
        </a>
      </div>
      <div className="text-lg">{labels.title}</div>
      <div className="w-24 flex justify-end">
        <button onClick={() => setOpen(false)} aria-label="Close">
          {icons.headerCloseIcon}
        </button>
      </div>
    </div>
  );
};

<CopilotKit>
  <CopilotSidebar Header={Header} />
</CopilotKit>
```
```tsx
import { type MessagesProps, CopilotSidebar } from "@copilotkit/react-ui";
import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";

export default function CustomMessages({
  messages,
  inProgress,
  RenderMessage,
}: MessagesProps) {
  const wrapperStyles = "p-4 flex flex-col gap-2 h-full overflow-y-auto bg-indigo-300";

  // [!code highlight:14]
  return (
    <div className={wrapperStyles}>
      {messages.map((message, index) => {
        const isCurrentMessage = index === messages.length - 1;
        return <RenderMessage
          key={index}
          message={message}
          inProgress={inProgress}
          index={index}
          isCurrentMessage={isCurrentMessage}
        />
      })}
    </div>
  );
}

<CopilotKit>
  <CopilotSidebar Messages={CustomMessages} />
</CopilotKit>
```
```tsx
        import { CopilotKit } from "@copilotkit/react-core";
        import {
            CopilotSidebar,
            type CopilotChatSuggestion,
            RenderSuggestion,
            type RenderSuggestionsListProps
        } from "@copilotkit/react-ui";
        import "@copilotkit/react-ui/styles.css";

        const CustomSuggestionsList = ({ suggestions, onSuggestionClick }: RenderSuggestionsListProps) => {
            return (
                <div className="suggestions flex flex-col gap-2 p-4">
                    <h1>Try asking:</h1>
                    <div className="flex gap-2">
                        {suggestions.map((suggestion: CopilotChatSuggestion, index) => (
                            <RenderSuggestion
                            key={index}
                                      title={suggestion.title}
                                      message={suggestion.message}
                                      partial={suggestion.partial}
                                      className="rounded-md border border-gray-500 bg-white px-2 py-1 shadow-md"
                                      onClick={() => onSuggestionClick(suggestion.message)}
                            />
                        ))}
                    </div>
                </div>
            );
        };

        <CopilotKit>
            <CopilotSidebar RenderSuggestionsList={CustomSuggestionsList} />
        </CopilotKit>
```
```tsx
import { type InputProps, CopilotSidebar } from "@copilotkit/react-ui";
import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";
function CustomInput({ inProgress, onSend, isVisible }: InputProps) {
  const handleSubmit = (value: string) => {
    if (value.trim()) onSend(value);
  };

  const wrapperStyle = "flex gap-2 p-4 border-t";
  const inputStyle = "flex-1 p-2 rounded-md border border-gray-300 focus:outline-none focus:border-blue-500 disabled:bg-gray-100";
  const buttonStyle = "px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed";

  // [!code highlight:27]
  return (
    <div className={wrapperStyle}>
      <input 
        disabled={inProgress}
        type="text" 
        placeholder="Ask your question here..." 
        className={inputStyle}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            handleSubmit(e.currentTarget.value);
            e.currentTarget.value = '';
          }
        }}
      />
      <button 
        disabled={inProgress}
        className={buttonStyle}
        onClick={(e) => {
          const input = e.currentTarget.previousElementSibling as HTMLInputElement;
          handleSubmit(input.value);
          input.value = '';
        }}
      >
        Ask
      </button>
    </div>
  );
}

<CopilotKit>
  <CopilotSidebar Input={CustomInput} />
</CopilotKit>
```
```tsx
"use client" // only necessary if you are using Next.js with the App Router.
import { useCopilotAction } from "@copilotkit/react-core"; 

// Your custom components (examples - implement these in your app)
import { LoadingView } from "./loading-view"; // Your loading component
import { CalendarMeetingCardComponent, type CalendarMeetingCardProps } from "./calendar-meeting-card"; // Your meeting card component

export function YourComponent() {
  useCopilotAction({ 
    name: "showCalendarMeeting",
    description: "Displays calendar meeting information",
    parameters: [
      {
        name: "date",
        type: "string",
        description: "Meeting date (YYYY-MM-DD)",
        required: true
      },
      {
        name: "time",
        type: "string",
        description: "Meeting time (HH:mm)",
        required: true
      },
      {
        name: "meetingName",
        type: "string",
        description: "Name of the meeting",
        required: false
      }
    ],
    render: ({ status, args }) => {
      const { date, time, meetingName } = args;

      if (status === 'inProgress') {
        return <LoadingView />; // Your own component for loading state
      } else {
        const meetingProps: CalendarMeetingCardProps = {
          date: date,
          time,
          meetingName
        };
        return <CalendarMeetingCardComponent {...meetingProps} />;
      }
    },
  });

  return (
    <>...</>
  );
}
```
```tsx
"use client"; // only necessary if you are using Next.js with the App Router.

import { useCoAgentStateRender } from "@copilotkit/react-core";
import { Progress } from "./progress";

type AgentState = {
  logs: string[];
}

useCoAgentStateRender<AgentState>({
  name: "basic_agent",
  render: ({ state, nodeName, status }) => {
    if (!state.logs || state.logs.length === 0) {
      return null;
    }

    // Progress is a component we are omitting from this example for brevity.
    return <Progress logs={state.logs} />; 
  },
});
```
```tsx
import {
  type CopilotChatReasoningMessageProps,
} from "@copilotkit/react-ui";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";

function CustomReasoningMessage({
  message,
  messages,
  isRunning,
}: CopilotChatReasoningMessageProps) {
  const isLatest = messages?.[messages.length - 1]?.id === message.id;
  const isStreaming = !!(isRunning && isLatest);

  if (!message.content && !isStreaming) return null;

  // [!code highlight:8]
  return (
    <details open={isStreaming} className="my-2 rounded border p-3">
      <summary className="cursor-pointer font-medium text-sm">
        {isStreaming ? "🧠 Thinking…" : "💡 View reasoning"}
      </summary>
      <p className="mt-2 text-sm text-gray-600 whitespace-pre-wrap">
        {message.content}
      </p>
    </details>
  );
}

<CopilotKit>
  <CopilotSidebar
    messageView={{
      reasoningMessage: CustomReasoningMessage,
    }}
  />
</CopilotKit>
```

### Styling Copilot UI
- Route: `/crewai-flows/custom-look-and-feel/customize-built-in-ui-components`
- Source: `docs/content/docs/integrations/crewai-flows/custom-look-and-feel/customize-built-in-ui-components.mdx`

CopilotKit has a variety of ways to customize colors and structures of the Copilot UI components.
- [CSS Variables](#css-variables-easiest)
- [Custom CSS](#custom-css)
- [Custom Icons](#custom-icons)
- [Custom Labels](#custom-labels)

If you want to customize the style as well as the functionality of the Copilot UI, you can also try the following:
- [Custom Sub-Components](/custom-look-and-feel/bring-your-own-components)
- [Fully Headless UI](/custom-look-and-feel/headless-ui)

## CSS Variables (Easiest)
The easiest way to change the colors using in the Copilot UI components is to override CopilotKit CSS variables.

  Hover over the interactive UI elements below to see the available CSS variables.

Once you've found the right variable, you can import `CopilotKitCSSProperties` and simply wrap CopilotKit in a div and override the CSS variables.

```tsx
import { CopilotKitCSSProperties } from "@copilotkit/react-ui";

<div
  // [!code highlight:5]
  style={
    {
      "--copilot-kit-primary-color": "#222222",
    } as CopilotKitCSSProperties
  }
>
  <CopilotSidebar .../>
</div>
```

### Reference

| CSS Variable | Description |
|-------------|-------------|
| `--copilot-kit-primary-color` | Main brand/action color - used for buttons, interactive elements |
| `--copilot-kit-contrast-color` | Color that contrasts with primary - used for text on primary elements |
| `--copilot-kit-background-color` | Main page/container background color |
| `--copilot-kit-secondary-color` | Secondary background - used for cards, panels, elevated surfaces |
| `--copilot-kit-secondary-contrast-color` | Primary text color for main content |
| `--copilot-kit-separator-color` | Border color for dividers and containers |
| `--copilot-kit-muted-color` | Muted color for disabled/inactive states |

## Custom CSS

In addition to customizing the colors, the CopilotKit CSS is structured to easily allow customization via CSS classes.

```css title="globals.css"
.copilotKitButton {
  border-radius: 0;
}

.copilotKitMessages {
  padding: 2rem;
}

.copilotKitUserMessage {
  background: #007AFF;
}
```

### Reference

For a full list of styles and classes used in CopilotKit, click [here](https://github.com/CopilotKit/CopilotKit/blob/main/src/v1.x/packages/react-ui/src/css/).

| CSS Class | Description |
|-----------|-------------|
| `.copilotKitMessages` | Main container for all chat messages with scroll behavior and spacing |
| `.copilotKitInput` | Text input container with typing area and send button |
| `.copilotKitUserMessage` | Styling for user messages including background, text color and bubble shape |
| `.copilotKitAssistantMessage` | Styling for AI responses including background, text color and bubble shape |
| `.copilotKitHeader` | Top bar of chat window containing title and controls |
| `.copilotKitButton` | Primary chat toggle button with hover and active states |
| `.copilotKitWindow` | Root container defining overall chat window dimensions and position |
| `.copilotKitMarkdown` | Styles for rendered markdown content including lists, links and quotes |
| `.copilotKitCodeBlock` | Code snippet container with syntax highlighting and copy button |
| `.copilotKitChat` | Base chat layout container handling positioning and dimensions |
| `.copilotKitSidebar` | Styles for sidebar chat mode including width and animations |
| `.copilotKitPopup` | Styles for popup chat mode including position and animations |
| `.copilotKitButtonIcon` | Icon styling within the main chat toggle button |
| `.copilotKitButtonIconOpen` `.copilotKitButtonIconClose` | Icon states for when chat is open/closed |
| `.copilotKitCodeBlockToolbar` | Top bar of code blocks with language and copy controls |
| `.copilotKitCodeBlockToolbarLanguage` | Language label styling in code block toolbar |
| `.copilotKitCodeBlockToolbarButtons` | Container for code block action buttons |
| `.copilotKitCodeBlockToolbarButton` | Individual button styling in code block toolbar |
| `.copilotKitSidebarContentWrapper` | Inner container for sidebar mode content |
| `.copilotKitInputControls` | Container for input area buttons and controls |
| `.copilotKitActivityDot1` `.copilotKitActivityDot2` `.copilotKitActivityDot3` | Animated typing indicator dots |
| `.copilotKitDevConsole` | Development debugging console container |
| `.copilotKitDevConsoleWarnOutdated` | Warning styles for outdated dev console |
| `.copilotKitVersionInfo` | Version information display styles |
| `.copilotKitDebugMenuButton` | Debug menu toggle button styling |
| `.copilotKitDebugMenu` | Debug options menu container |
| `.copilotKitDebugMenuItem` | Individual debug menu option styling |

## Custom Fonts
You can customize the fonts by updating the `fontFamily` property in the various CSS classes that are used in the CopilotKit.

```css title="globals.css"
.copilotKitMessages {
  font-family: "Arial, sans-serif";
}

.copilotKitInput {
  font-family: "Arial, sans-serif";
}
```

### Reference
You can update the main content classes to change the font family for the various components.

| CSS Class | Description |
|-----------|-------------|
| `.copilotKitMessages` | Main container for all messages |
| `.copilotKitInput` | The input field |
| `.copilotKitMessage` | Base styling for all chat messages |
| `.copilotKitUserMessage` | User messages |
| `.copilotKitAssistantMessage` | AI responses |

## Custom Icons

You can customize the icons by passing the `icons` property to the `CopilotSidebar`, `CopilotPopup` or `CopilotChat` component.

```tsx
<CopilotChat
  icons={{
    // Use your own icons here – any React nodes
    openIcon: <YourOpenIconComponent />,
    closeIcon: <YourCloseIconComponent />,
  }}
/>
```

### Reference

| Icon | Description |
|--------------|-------------|
| `openIcon` | The icon to use for the open chat button |
| `closeIcon` | The icon to use for the close chat button |
| `headerCloseIcon` | The icon to use for the close chat button in the header |
| `sendIcon` | The icon to use for the send button |
| `activityIcon` | The icon to use for the activity indicator |
| `spinnerIcon` | The icon to use for the spinner |
| `stopIcon` | The icon to use for the stop button |
| `regenerateIcon` | The icon to use for the regenerate button |
| `pushToTalkIcon` | The icon to use for push to talk |

## Custom Labels

To customize labels, pass the `labels` property to the `CopilotSidebar`, `CopilotPopup` or `CopilotChat` component.

```tsx
<CopilotChat
  labels={{
    initial: "Hello! How can I help you today?",
    title: "My Copilot",
    placeholder: "Ask me anything!",
    stopGenerating: "Stop",
    regenerateResponse: "Regenerate",
  }} 
/>
```

### Reference

| Label | Description |
|---------------|-------------|
| `initial` | The initial message(s) to display in the chat window |
| `title` | The title to display in the header |
| `placeholder` | The placeholder to display in the input |
| `stopGenerating` | The label to display on the stop button |
| `regenerateResponse` | The label to display on the regenerate button |

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
    import { useCopilotChatHeadless_c } from "@copilotkit/react-core"; // [!code highlight]

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
import { useCopilotAction } from "@copilotkit/react-core";

export const Chat = () => {
  // ...

  // Define an action that will show a custom component
  useCopilotAction({
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
import { useCopilotChatHeadless_c, useCopilotChatSuggestions } from "@copilotkit/react-core"; // [!code highlight]

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
import { useCopilotChatHeadless_c } from "@copilotkit/react-core";

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
import { useCopilotAction, useCopilotChatHeadless_c } from "@copilotkit/react-core";

export const Chat = () => {
  const { messages, sendMessage } = useCopilotChatHeadless_c();

  // Define an action that will wait for the user to enter their name
  useCopilotAction({
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

### Markdown rendering
- Route: `/crewai-flows/custom-look-and-feel/markdown-rendering-crewai-flows_custom-look-and-feel`
- Source: `docs/content/docs/integrations/crewai-flows/custom-look-and-feel/markdown-rendering-crewai-flows_custom-look-and-feel.mdx`

```tsx
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar, ComponentsMap } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
// We will include the styles in a separate css file, for convenience
import "./styles.css";

function YourComponent() {
    const customMarkdownTagRenderers: ComponentsMap<{ "reference-chip": { href: string } }> = {
        // You can make up your own tags, or use existing, valid HTML ones!
        "reference-chip": ({ children, href }) => {
            return (
                <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="w-fit border rounded-xl py-1 px-2 text-xs" // Classes list trimmed for brevity
                >
                    {children}
                    <LinkIcon className="w-3.5 h-3.5" />
                </a>
            );
        },
    };

    return (
        <CopilotKit>
          <CopilotSidebar
            // For demonstration, we'll force the LLM to return our reference chip in every message
            instructions={`
                You are a helpful assistant.
                End each message with a reference chip,
                like so: <reference-chip href={href}>{title}</reference-chip>
            `}
            markdownTagRenderers={customMarkdownTagRenderers}
          />
        </CopilotKit>
    )
}
```
```css
.reference-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background-color: #f0f1f2;
    color: #444;
    border-radius: 12px;
    padding: 2px 8px;
    font-size: 0.8rem;
    font-weight: 500;
    text-decoration: none;
    margin: 0 2px;
    border: 1px solid #e0e0e0;
    cursor: pointer;
    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
}
```

### Markdown rendering
- Route: `/crewai-flows/custom-look-and-feel/markdown-rendering`
- Source: `docs/content/docs/integrations/crewai-flows/custom-look-and-feel/markdown-rendering.mdx`

```tsx
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar, ComponentsMap } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
// We will include the styles in a separate css file, for convenience
import "./styles.css";

function YourComponent() {
    const customMarkdownTagRenderers: ComponentsMap<{ "reference-chip": { href: string } }> = {
        // You can make up your own tags, or use existing, valid HTML ones!
        "reference-chip": ({ children, href }) => {
            return (
                <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="w-fit border rounded-xl py-1 px-2 text-xs" // Classes list trimmed for brevity
                >
                    {children}
                    <LinkIcon className="w-3.5 h-3.5" />
                </a>
            );
        },
    };

    return (
        <CopilotKit>
          <CopilotSidebar
            // For demonstration, we'll force the LLM to return our reference chip in every message
            instructions={`
                You are a helpful assistant.
                End each message with a reference chip,
                like so: <reference-chip href={href}>{title}</reference-chip>
            `}
            markdownTagRenderers={customMarkdownTagRenderers}
          />
        </CopilotKit>
    )
}
```
```css
.reference-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background-color: #f0f1f2;
    color: #444;
    border-radius: 12px;
    padding: 2px 8px;
    font-size: 0.8rem;
    font-weight: 500;
    text-decoration: none;
    margin: 0 2px;
    border: 1px solid #e0e0e0;
    cursor: pointer;
    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
}
```

### Frontend Actions
- Route: `/crewai-flows/frontend-actions`
- Source: `docs/content/docs/integrations/crewai-flows/frontend-actions.mdx`
- Description: Create frontend actions and use them within your CrewAI Flows agent.

## Implementation

Check out the [Frontend Actions overview](/frontend-actions) to understand what they are and when to use them.

        ### Setup CopilotKit

        To use frontend actions, you'll need to setup CopilotKit first. For the sake of brevity, we won't cover it here.

        Check out our [getting started guide](/crewai-flows/quickstart) and come back here when you're setup!

        ### Create a frontend action

        First, you'll need to create a frontend action using the [useCopilotAction](/reference/v1/hooks/useCopilotAction) hook. Here's a simple one to get you started
        that says hello to the user.

```tsx title="page.tsx"
        import { useCopilotAction } from "@copilotkit/react-core" // [!code highlight]

        export function Page() {
          // ...

          // [!code highlight:16]
          useCopilotAction({
            name: "sayHello",
            description: "Say hello to the user",
            available: "remote", // optional, makes it so the action is *only* available to the agent
            parameters: [
              {
                name: "name",
                type: "string",
                description: "The name of the user to say hello to",
                required: true,
              },
            ],
            handler: async ({ name }) => {
              alert(`Hello, ${name}!`);
            },
          });

          // ...
        }
```
        ### Install the CopilotKit SDK

        Now, we'll need to modify the agent to access these frontend tools. In your terminal, navigate to your agent's folder and continue from there!

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

        ### Inheriting from CopilotKitState

        To access the frontend actions provided by CopilotKit, you can inherit from CopilotKitState in your agent's state definition:

```python title="agent.py"
                from copilotkit import CopilotKitState # [!code highlight]

                class YourAgentState(CopilotKitState): # [!code highlight]
                    your_additional_properties: str
```

        By doing this, your agent's state will include the `copilotkit` property, which contains the frontend actions that can be accessed and invoked.
        ### Accessing Frontend Actions

        Once your agent's state includes the `copilotkit` property, you can access the frontend actions and utilize them within your agent's logic.

        Here's how you can call a frontend action from your agent:

```python title="agent.py"
                async def agent(self):
                    response = await copilotkit_stream(
                        completion(
                            model="openai/gpt-4o",
                            messages=[
                                {"role": "system", "content": prompt},
                                *self.state.get("messages", [])
                            ],
                            # Access the actions from the copilotkit property
                            tools=self.state["copilotkit"]["actions"], # [!code highlight]
                            tool_choice="required",
                            stream=True
                        )
                    )

                    # ...
```

        These actions are automatically populated by CopilotKit and are compatible with LiteLLM's tool call definitions, making it straightforward to integrate them into your agent's workflow.
        ### Give it a try!
        You've now given your agent the ability to directly call any CopilotActions you've defined. These actions will be available as tools to the agent where they can be used as needed.

### Agentic Generative UI
- Route: `/crewai-flows/generative-ui/agentic`
- Source: `docs/content/docs/integrations/crewai-flows/generative-ui/agentic.mdx`
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
                    model="openai/gpt-4o",
                    messages=[
                        {"role": "system", "content": "You are a helpful assistant."},
                        *self.state.get("messages", [])
                    ],
                    stream=True
                )
            )
```

    ### Render state of the agent in the chat
    Now we can utilize `useCoAgentStateRender` to render the state of our agent **in the chat**.

```tsx title="app/page.tsx"
    // ...
    import { useCoAgentStateRender } from "@copilotkit/react-core";
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
      useCoAgentStateRender<AgentState>({
        name: "sample_agent", // the name the agent is served as
        render: ({ state }) => (
          <div>
            {state.searches?.map((search, index) => (
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
    import { useCoAgent } from "@copilotkit/react-core"; // [!code highlight]
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
      const { state } = useCoAgent<AgentState>({
        name: "sample_agent", // the name the agent is served as
      })

      // ...

      return (
        <div>
          {/* ... */}
          <div className="flex flex-col gap-2 mt-4">
            {/* [!code highlight:5] */}
            {state.searches?.map((search, index) => (
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

### Generative UI
- Route: `/crewai-flows/generative-ui`
- Source: `docs/content/docs/integrations/crewai-flows/generative-ui/index.mdx`
- Description: Render your agent's behavior with custom UI components.

This example shows our Research Canvas
  making use of Generative UI!

## What is Generative UI?

Generative UI lets you render your agent's state, progress, outputs, and tool calls with custom UI components in real-time. It bridges the gap between AI
agents and user interfaces. As your agent processes information and makes decisions, you can render custom UI components that:

- Show loading states and progress indicators
- Display structured data in tables, cards, or charts
- Create interactive elements for user input
- Animate transitions between different states

## How can I use this?

There are two main variants of Generative UI.

      description:
        "Render your agent's state, progress, and outputs with custom UI components.",

### Tool-based Generative UI
- Route: `/crewai-flows/generative-ui/tool-based`
- Source: `docs/content/docs/integrations/crewai-flows/generative-ui/tool-based.mdx`
- Description: Render your agent's tool calls with custom UI components.

This video demonstrates the [implementation](#implementation) section applied
  to our [coagents starter
  project](https://github.com/CopilotKit/CopilotKit/tree/main/examples/coagents-starter-crewai-flows).

## What is this?

Tools are a way for the LLM to call predefined, typically, deterministic functions. CopilotKit allows you to render these tools in the UI
as a custom component, which we call **Generative UI**.

## When should I use this?

Rendering tools in the UI is useful when you want to provide the user with feedback about what your agent is doing, specifically
when your agent is calling tools. CopilotKit allows you to fully customize how these tools are rendered in the chat.

## Implementation

### Run and connect your agent

You'll need to run your agent and connect it to CopilotKit before proceeding. If you haven't done so already,
you can follow the instructions in the [Getting Started](/crewai-flows/quickstart) guide.

If you don't already have an agent, you can use the [coagent starter](https://github.com/CopilotKit/CopilotKit/tree/main/examples/coagents-starter-crewai-flows) as a starting point
as this guide uses it as a starting point.

### Give your agent a tool to call

```python title="agent.py"
        from crewai.flow.flow import start
        from litellm import completion
        # ...

        # [!code highlight:17]
        WEATHER_TOOL = {
            "type": "function",
            "function": {
                "name": "get_weather",
                "description": "Get the weather for a given location.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "location": {
                            "type": "string",
                            "description": "The location to get weather for"
                        }
                    },
                    "required": ["location"]
                }
            }
        }

        # ...

        @start
        async def chat(self):

            response = await copilotkit_stream(
                completion(
                    model="openai/gpt-4o",
                    messages=[
                        {"role": "system", "content": prompt},
                        *self.state.get("messages", [])
                    ],
                    tools=[WEATHER_TOOL],
                    stream=True
                )
            )

            # ...
```

### Render the tool call in your frontend
At this point, your agent will be able to call the `get_weather` tool. Now
we just need to add a `useCopilotAction` hook to render the tool call in
the UI.

  In order to render a tool call in the UI, the name of the action must match
  the name of the tool.

```tsx title="app/page.tsx"
import { useCopilotAction } from "@copilotkit/react-core"; // [!code highlight]
// ...

const YourMainContent = () => {
  // ...
  // [!code highlight:13]
  useCopilotAction({
    name: "get_weather",
    available: "disabled", // Don't allow the agent or UI to call this tool as its only for rendering
    render: ({ status, args }) => {
      return (
        <p className="text-gray-500 mt-2">
          {status !== "complete" && "Calling weather API..."}
          {status === "complete" &&
            `Called the weather API for ${args.location}.`}
        </p>
      );
    },
  });
  // ...
};
```

### Give it a try!

Try asking the agent to get the weather for a location. You should see the custom UI component that we added
render the tool call and display the arguments that were passed to the tool.

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

        ### Add a `useCopilotAction` to your Frontend
        First, we'll create a component that renders the agent's essay draft and waits for user approval.

```tsx title="ui/app/page.tsx"
        import { useCopilotAction } from "@copilotkit/react-core"
        import { Markdown } from "@copilotkit/react-ui"

        function YourMainContent() {
          // ...

          useCopilotAction({
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
                        model="openai/gpt-4o",
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
const { state } = useCoAgent({ name: "research_agent" });

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
import { CopilotKit } from "@copilotkit/react-core";

<CopilotKit threadId="37aa68d0-d15b-45ae-afc1-0ba6c3e11353">
  <YourApp />
</CopilotKit>;
```

### Dynamically Switching Threads

You can make the `threadId` dynamic. Once set, CopilotKit will load previous messages for that thread.

```tsx
import { useState } from "react";
import { CopilotKit } from "@copilotkit/react-core";

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
import { useCopilotContext } from "@copilotkit/react-core";

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
    import { useCopilotChatHeadless_c } from "@copilotkit/react-core"; // [!code highlight]

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
import { useCopilotAction } from "@copilotkit/react-core";

export const Chat = () => {
  // ...

  // Define an action that will show a custom component
  useCopilotAction({
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
import { useCopilotChatHeadless_c, useCopilotChatSuggestions } from "@copilotkit/react-core"; // [!code highlight]

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
import { useCopilotChatHeadless_c } from "@copilotkit/react-core";

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
import { useCopilotAction, useCopilotChatHeadless_c } from "@copilotkit/react-core";

export const Chat = () => {
  const { messages, sendMessage } = useCopilotChatHeadless_c();

  // Define an action that will wait for the user to enter their name
  useCopilotAction({
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

### Inspector
- Route: `/crewai-flows/premium/inspector`
- Source: `docs/content/docs/integrations/crewai-flows/premium/inspector.mdx`
- Description: Inspector for debugging actions, readables, agent status, messages, and context.

The Copilot Inspector is a debugging aid, accessible from a copilotkit button overlaid on your app, which allows you to see the information, state and conversation between them and you (the user).

  The Inspector is available to CopilotKit Premium users. Get a free public
  license key on [Copilot Cloud](https://cloud.copilotkit.ai) or read more about{" "}

## What it shows

- Actions: Registered actions and parameter schemas
- Readables: Context/readables available to the agent
- Agent Status: Coagent states and running/completion info
- Messages: Conversation history
- Context: Document context fed into the model

## Requirements

- Provide `publicLicenseKey` to `` to enable premium features:

```tsx
<CopilotKit publicLicenseKey={process.env.NEXT_PUBLIC_COPILOTKIT_LICENSE_KEY}>
  {children}
</CopilotKit>
```

## How to open

A draggable circular trigger is rendered in-app. Click to open the Inspector.
If no license key is configured, you’ll see a "Get License Key" prompt.

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
import { CopilotChat } from "@copilotkit/react-ui";
import { CopilotKit } from "@copilotkit/react-core";

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
import { CopilotKit } from "@copilotkit/react-core";

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
import { CopilotChat } from "@copilotkit/react-ui";

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
import "@copilotkit/react-ui/styles.css";
```

  Copilot UI ships with a number of built-in UI patterns, choose whichever one you like.

    `CopilotPopup` is a convenience wrapper for `CopilotChat` that lives at the same level as your main content in the view hierarchy. It provides **a floating chat interface** that can be toggled on and off.

```tsx
    // [!code word:CopilotPopup]
    import { CopilotPopup } from "@copilotkit/react-ui";

    export function YourApp() {
      return (
        <>
          <YourMainContent />
          <CopilotPopup
            instructions={"You are assisting the user as best as you can. Answer in the best way possible given the data you have."}
            labels={{
              title: "Popup Assistant",
              initial: "Need any help?",
            }}
          />
        </>
      );
    }
```

    `CopilotSidebar` is a convenience wrapper for `CopilotChat` that wraps your main content in the view hierarchy. It provides a **collapsible and expandable sidebar** chat interface.

```tsx
    // [!code word:CopilotSidebar]
    import { CopilotSidebar } from "@copilotkit/react-ui";

    export function YourApp() {
      return (
        <CopilotSidebar
          defaultOpen={true}
          instructions={"You are assisting the user as best as you can. Answer in the best way possible given the data you have."}
          labels={{
            title: "Sidebar Assistant",
            initial: "How can I help you today?",
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
    import { CopilotChat } from "@copilotkit/react-ui";

    export function YourComponent() {
      return (
        <CopilotChat
          instructions={"You are assisting the user as best as you can. Answer in the best way possible given the data you have."}
          labels={{
            title: "Your Assistant",
            initial: "Hi! 👋 How can I assist you today?",
          }}
        />
      );
    }
```

    The built-in Copilot UI can be customized in many ways -- both through css and by passing in custom sub-components.

    CopilotKit also offers **fully custom headless UI**, through the `useCopilotChat` hook. Everything built with the built-in UI (and more) can be implemented with the headless UI, providing deep customizability.

```tsx
    import { useCopilotChat } from "@copilotkit/react-core";
    import { Role, TextMessage } from "@copilotkit/runtime-client-gql";

    export function CustomChatInterface() {
      const {
        visibleMessages,
        appendMessage,
        setMessages,
        deleteMessage,
        reloadMessages,
        stopGeneration,
        isLoading,
      } = useCopilotChat();

      const sendMessage = (content: string) => {
        appendMessage(new TextMessage({ content, role: Role.User }));
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
            import "@copilotkit/react-ui/styles.css";
            import { CopilotKit, useCopilotAction } from "@copilotkit/react-core";
            import { CopilotChat } from "@copilotkit/react-ui";
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
              useCopilotAction({
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
                          initial: "Hi, I'm an agent. Want to chat?",
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

    ### Use the `useCoAgent` Hook
    With your agent connected and running all that is left is to call the [useCoAgent](/reference/v1/hooks/useCoAgent) hook, pass the agent's name, and
    optionally provide an initial state.

```tsx title="ui/app/page.tsx"
    import { useCoAgent } from "@copilotkit/react-core"; // [!code highlight]

    // Define the agent state type, should match the actual state of your agent
    type AgentState = {
      language: "english" | "spanish";
    }

    function YourMainContent() {
      // [!code highlight:4]
      const { state } = useCoAgent<AgentState>({
        name: "sample_agent",
        initialState: { language: "english" }  // optionally provide an initial state
      });

      // ...

      return (
        // style excluded for brevity
        <div>
          <h1>Your main content</h1>
          {/* [!code highlight:1] */}
          <p>Language: {state.language}</p>
        </div>
      );
    }
```
      The `state` in `useCoAgent` is reactive and will automatically update when the agent's state changes.

    ### Give it a try!
    As the agent state updates, your `state` variable will automatically update with it! In this case, you'll see the
    language set to "english" as that's the initial state we set.

## Rendering agent state in the chat

You can also render the agent's state in the chat UI. This is useful for informing the user about the agent's state in a
more in-context way. To do this, you can use the [useCoAgentStateRender](/reference/v1/hooks/useCoAgentStateRender) hook.

```tsx title="ui/app/page.tsx"
import { useCoAgentStateRender } from "@copilotkit/react-core"; // [!code highlight]

// Define the agent state type, should match the actual state of your agent
type AgentState = {
  language: "english" | "spanish";
};

function YourMainContent() {
  // ...
  // [!code highlight:7]
  useCoAgentStateRender({
    name: "sample_agent",
    render: ({ state }) => {
      if (!state.language) return null;
      return <div>Language: {state.language}</div>;
    },
  });
  // ...
}
```

  The `state` in `useCoAgentStateRender` is reactive and will automatically
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

    ### Call `setState` function from the `useCoAgent` hook
    `useCoAgent` returns a `setState` function that you can use to update the agent state. Calling this
    will update the agent state and trigger a rerender of anything that depends on the agent state.

```tsx title="ui/app/page.tsx"
    import { useCoAgent } from "@copilotkit/react-core"; // [!code highlight]

    // Define the agent state type, should match the actual state of your agent
    type AgentState = {
      language: "english" | "spanish";
    }

    // Example usage in a pseudo React component
    function YourMainContent() {
      const { state, setState } = useCoAgent<AgentState>({ // [!code highlight]
        name: "sample_agent",
        initialState: { language: "english" }  // optionally provide an initial state
      });

      // ...

      const toggleLanguage = () => {
        setState({ language: state.language === "english" ? "spanish" : "english" }); // [!code highlight]
      };

      // ...

      return (
        // style excluded for brevity
        <div>
          <h1>Your main content</h1>
          {/* [!code highlight:2] */}
          <p>Language: {state.language}</p>
          <button onClick={toggleLanguage}>Toggle Language</button>
        </div>
      );
    }
```

    ### Give it a try!
    You can now use the `setState` function to update the agent state and `state` to read it. Try toggling the language button
    and talking to your agent. You'll see the language change to match the agent's state.

## Advanced Usage

### Re-run the agent with a hint about what's changed

The new agent state will be used next time the agent runs.
If you want to re-run it manually, use the `run` argument on the `useCoAgent` hook.

The agent will be re-run, and it will get not only the latest updated state, but also a **hint** that can depend on the data delta between the previous and the current state.

```tsx title="ui/app/page.tsx"
import { useCoAgent } from "@copilotkit/react-core";
import { TextMessage, MessageRole } from "@copilotkit/runtime-client-gql";  // [!code highlight]

// ...

function YourMainContent() {
  // [!code word:run:1]
  const { state, setState, run } = useCoAgent<AgentState>({
    name: "sample_agent",
    initialState: { language: "english" }  // optionally provide an initial state
  });

  // setup to be called when some event in the app occurs
  const toggleLanguage = () => {
    const newLanguage = state.language === "english" ? "spanish" : "english";
    setState({ language: newLanguage });

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
                                        model="openai/gpt-4o",
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
        import { useCoAgent, useCoAgentStateRender } from '@copilotkit/react-core';

        // ...

        const YourMainContent = () => {
            // Get access to both predicted and final states
            const { state } = useCoAgent({ name: "sample_agent" });

            // Add a state renderer to observe predictions
            useCoAgentStateRender({
                name: "sample_agent",
                render: ({ state }) => {
                    if (!state.observed_steps?.length) return null;
                    return (
                        <div>
                            <h3>Current Progress:</h3>
                            <ul>
                                {state.observed_steps.map((step, i) => (
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
                    {state.observed_steps?.length > 0 && (
                        <div>
                            <h3>Final Steps:</h3>
                            <ul>
                                {state.observed_steps.map((step, i) => (
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
import { AssistantMessageProps } from "@copilotkit/react-ui";

export const AssistantMessage = (props: AssistantMessageProps) => {
  const { message, subComponent } = props;

  return (
    <div style={{ marginBottom: "0.5rem" }}>{subComponent}</div>
  );
};
```

#### After

```tsx
import { AssistantMessageProps } from "@copilotkit/react-ui";

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

### useAgent Hook
- Route: `/crewai-flows/use-agent-hook`
- Source: `docs/content/docs/integrations/crewai-flows/use-agent-hook.mdx`
- Description: Access and interact with your CrewAI Flows agent directly from React components

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

## See Also

- [useAgent API Reference](/reference/v1/hooks/useAgent) - Complete API documentation
