# CrewAI Flows Integration

CopilotKit implementation guide for CrewAI Flows.

> For shared CopilotKit concepts (runtime setup, prebuilt components, troubleshooting, etc.), see the topic guides. This file focuses on framework-specific implementation details.

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
