# Pydantic AI Integration

CopilotKit implementation guide for Pydantic AI.

> For shared CopilotKit concepts (runtime setup, prebuilt components, troubleshooting, etc.), see the topic guides. This file focuses on framework-specific implementation details.

## Guidance
### State Rendering
- Route: `/pydantic-ai/generative-ui/state-rendering`
- Source: `docs/content/docs/integrations/pydantic-ai/generative-ui/state-rendering.mdx`
- Description: Render the state of your agent with custom UI components.

```python title="agent.py"
    import asyncio
    from textwrap import dedent
    from pydantic import BaseModel, Field
    from pydantic_ai import Agent, RunContext
    from pydantic_ai.ag_ui import StateDeps
    from ag_ui.core import StateSnapshotEvent, EventType

    class Search(BaseModel):
        query: str
        done: bool

    class AgentState(BaseModel):
        searches: list[Search] = Field(default_factory=list)

    agent = Agent("openai:gpt-5.2-mini", deps_type=StateDeps[AgentState])

    @agent.tool
    async def add_search(
        ctx: RunContext[StateDeps[AgentState]], new_query: str
    ) -> StateSnapshotEvent:
        """Add a search to the agent's list of searches."""
        new_search = Search(query=new_query, done=False)
        searches = ctx.deps.state.searches
        searches.append(new_search)
        agent_state = AgentState(searches=searches)
        ctx.deps.state = agent_state

        return StateSnapshotEvent(type=EventType.STATE_SNAPSHOT, snapshot=agent_state)

    @agent.tool
    async def run_searches(ctx: RunContext[StateDeps[AgentState]]) -> StateSnapshotEvent:
        """Run the searches in the agent's state."""
        searches = ctx.deps.state.searches

        for search in searches:
            await asyncio.sleep(1)
            search.done = True

        agent_state = AgentState(searches=searches)
        ctx.deps.state = agent_state

        return StateSnapshotEvent(type=EventType.STATE_SNAPSHOT, snapshot=agent_state)

    @agent.instructions()
    async def search_instructions(ctx: RunContext[StateDeps[AgentState]]) -> str:
        """Instructions for the search agent."""
        return dedent(
            f"""
            You are a helpful assistant for storing searches.

            IMPORTANT:
            - Use the `add_search` tool to add a search to the agent's state
            - After using the `add_search` tool, YOU MUST ALWAYS use the `run_searches` tool to run the searches
            - ONLY USE THE `add_search` TOOL ONCE FOR A GIVEN QUERY

            Current searches:
            {ctx.deps.state.model_dump_json(indent=2)}
            """
        )

    app = agent.to_ag_ui(deps=StateDeps(AgentState()))

    if __name__ == "__main__":
        import uvicorn
        uvicorn.run(app, host="0.0.0.0", port=8000)
```
```tsx title="app/page.tsx"
    // ...
    import { useAgent } from "@copilotkit/react-core/v2";
    // ...

    // Define the state of the agent, should match the state of your Pydantic AI Agent.
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
      useAgent({
        name: "my_agent", // MUST match the agent name in CopilotRuntime
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
```tsx title="app/page.tsx"
    import { useAgent } from "@copilotkit/react-core/v2"; // [!code highlight]
    // ...

    // Define the state of the agent, should match the state of your Pydantic AI Agent.
    type AgentState = {
      searches: {
        query: string;
        done: boolean;
      }[];
    };

    function YourMainContent() {
      // ...

      // [!code highlight:3]
      const { agent } = useAgent({
        name: "my_agent", // MUST match the agent name in CopilotRuntime
      })

      // ...

      return (
        <div>
          {/* ... */}
          <div className="flex flex-col gap-2 mt-4">
            {/* [!code highlight:5] */}
            {agent.state?.searches?.map((search, index) => (
              <div key={index} className="flex flex-row">
                {search.done ? "✅" : "❌"} {search.query}
              </div>
            ))}
          </div>
        </div>
      )
    }
```

### Tool Rendering
- Route: `/pydantic-ai/generative-ui/tool-rendering`
- Source: `docs/content/docs/integrations/pydantic-ai/generative-ui/tool-rendering.mdx`
- Description: Render your agent's tool calls with custom UI components.

```python title="agent.py"
        from pydantic_ai import Agent

        agent = Agent("openai:gpt-5.2-mini")

        @agent.tool_plain
        async def get_weather(location: str = "Everywhere ever") -> str:
            """Get the weather for a given location. Ensure location is fully spelled out."""
            return f"The weather in {location} is sunny."

        app = agent.to_ag_ui()

        if __name__ == "__main__":
            import uvicorn

            uvicorn.run(app, host="0.0.0.0", port=8000)
```
```tsx title="app/page.tsx"
import { useRenderTool } from "@copilotkit/react-core/v2"; // [!code highlight]
// ...

const YourMainContent = () => {
  // ...
  // [!code highlight:12]
  useRenderTool({
    name: "get_weather",
    render: ({status, args}) => {
      return (
        <p className="text-gray-500 mt-2">
          {status !== "complete" && "Calling weather API..."}
          {status === "complete" && `Called the weather API for ${args.location}.`}
        </p>
      );
    },
  });
  // ...
}
```

### Human-in-the-Loop
- Route: `/pydantic-ai/human-in-the-loop`
- Source: `docs/content/docs/integrations/pydantic-ai/human-in-the-loop.mdx`
- Description: Create frontend tools and use them within your Pydantic AI agent for human-in-the-loop interactions.

```tsx title="page.tsx"
        import { useHumanInTheLoop } from "@copilotkit/react-core/v2" // [!code highlight]

        export function Page() {
          // ...

          useHumanInTheLoop({
            name: "offerOptions",
            description: "Give the user a choice between two options and have them select one.",
            parameters: [
              {
                name: "option_1",
                type: "string",
                description: "The first option",
                required: true,
              },
              {
                name: "option_2",
                type: "string",
                description: "The second option",
                required: true,
              },
            ],
            render: ({ args, respond }) => {
              if (!respond) return <></>;
              return (
                <div>
                  {/* [!code highlight:2] */}
                  <button onClick={() => respond(`${args.option_1} was selected`)}>{args.option_1}</button>
                  <button onClick={() => respond(`${args.option_2} was selected`)}>{args.option_2}</button>
                </div>
              );
            },
          });

          // ...
        }
```
```python title="agent.py"
        from pydantic_ai import Agent

        agent = Agent('openai:gpt-5.2-mini')
        app = agent.to_ag_ui()
```
```
        Can you show me two good options for a restaurant name?
````

### Pydantic AI Agents
- Route: `/pydantic-ai/human-in-the-loop/agent`
- Source: `docs/content/docs/integrations/pydantic-ai/human-in-the-loop/agent.mdx`
- Description: Learn how to implement Human-in-the-Loop (HITL) using Pydantic AI Agents.

## What is this?

[Flow based agents](https://docs.pydantic-ai.com/concepts/flows) are stateful agents that can be interrupted and resumed
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
        you can follow the instructions in the [Getting Started](/pydantic-ai/quickstart/pydantic-ai) guide.

        If you don't already have an agent, you can use the [coagent starter](https://github.com/CopilotKit/CopilotKit/tree/main/examples/coagents-starter-pydantic-ai) as a starting point
        as this guide uses it as a starting point.

        ### Add a `useFrontendTool` to your Frontend
        First, we'll create a component that renders the agent's essay draft and waits for user approval.

```tsx title="ui/app/page.tsx"
        import { z } from "zod";
        import { useFrontendTool } from "@copilotkit/react-core/v2"
        import { Markdown } from "@copilotkit/react-core/v2"

        function YourMainContent() {
          // ...

          useFrontendTool({
            name: "write_essay",
            available: "frontend",
            description: "Writes an essay and takes the draft as an argument.",
            parameters: z.object({
              draft: z.string().describe("The draft of the essay"),
            }),
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

    ### Setup the Pydantic AI Agent
Now we'll setup the Pydantic AI agent. The flow is hard to understand without a complete example, so below
    is the complete implementation of the agent with explanations.

    Some main things to note:
    - The agent's state inherits from `CopilotKitState` to bring in the CopilotKit actions.
    - CopilotKit's actions are bound to the model as tools.
    - If the `writeEssay` action is found in the model's response, the agent will pass control back to the frontend
      to get user feedback.

```python title="agent/sample_agent/agent.py"
        from pydantic_ai import Agent

        agent = Agent('openai:gpt-5.2-mini')

        @agent.tool_plain
        async def write_essay(topic: str) -> str:
            """Write an essay on the given topic."""
            # This would typically generate an essay
            # The agent will wait for user feedback before proceeding
            return f"Essay draft on '{topic}' has been generated. Please review."

        app = agent.to_ag_ui()
```
        ### Give it a try!
        Try asking your agent to write an essay about the benefits of AI. You'll see that it will generate an essay,
        stream the progress and eventually ask you to review it.

### Human in the Loop (HITL)
- Route: `/pydantic-ai/human-in-the-loop`
- Source: `docs/content/docs/integrations/pydantic-ai/human-in-the-loop/index.mdx`
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

Read more about the approach to HITL in Pydantic AI Agents.

      description:
        "Utilize Pydantic AI Agents to create Human-in-the-Loop workflows.",

### Multi-Agent Flows
- Route: `/pydantic-ai/multi-agent-flows`
- Source: `docs/content/docs/integrations/pydantic-ai/multi-agent-flows.mdx`
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

### Quickstart
- Route: `/pydantic-ai/quickstart`
- Source: `docs/content/docs/integrations/pydantic-ai/quickstart.mdx`
- Description: Turn your Pydantic AI agent into an agent-native application in 10 minutes.

## Prerequisites

Before you begin, you'll need the following:

- An OpenAI API key
- Node.js 20+
- Python 3.9+
- Your favorite package manager

## Getting started

                    You can either start fresh with our starter template or integrate CopilotKit into your existing Pydantic AI agent.
                ### Run our CLI

```bash
                npx copilotkit@latest create -f pydantic-ai
```
                ### Install dependencies

```npm
                npm install
```
                ### Configure your environment

                Create a `.env` file in your agent directory and add your OpenAI API key:

```plaintext title="agent/.env"
                OPENAI_API_KEY=your_openai_api_key
```

                  The starter template is configured to use OpenAI's GPT-4o by default, but you can modify it to use any language model supported by Pydantic AI.
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
                ### Install Pydantic AI with AG-UI

                Add Pydantic AI with AG-UI support and uvicorn to your project:

```bash
                uv add 'pydantic-ai-slim[ag-ui]' 'pydantic-ai-slim[openai]' uvicorn
```
                ### Configure your environment

                Set your OpenAI API key as an environment variable:

```bash
                export OPENAI_API_KEY=your_openai_api_key
```

                  This example uses OpenAI's GPT-4.1-mini, but you can modify it to use any language model supported by Pydantic AI.
                ### Expose your agent via AG-UI

                Update your agent file to expose it as an AG-UI ASGI application:

```python title="main.py"
                from pydantic_ai import Agent

                agent = Agent('openai:gpt-4.1-mini', instructions='Be fun!')
                app = agent.to_ag_ui()

                if __name__ == "__main__":
                    import uvicorn
                    uvicorn.run(app, host="localhost", port=8000)
```

                  AG-UI is an open protocol for frontend-agent communication. Pydantic AI's `.to_ag_ui()` method creates an ASGI app that CopilotKit can connect to.
                ### Create your frontend

                CopilotKit works with any React-based frontend. We'll use Next.js for this example.

```bash
                npx create-next-app@latest my-copilot-app
                cd my-copilot-app
```
                ### Install CopilotKit packages

```npm
                npm install @copilotkit/react-ui @copilotkit/react-core @copilotkit/runtime @ag-ui/client
```
                ### Setup Copilot Runtime

                Create an API route to connect CopilotKit to your Pydantic AI agent:

```tsx title="app/api/copilotkit/route.ts"
                import {
                  CopilotRuntime,
                  ExperimentalEmptyAdapter,
                  copilotRuntimeNextJSAppRouterEndpoint,
                } from "@copilotkit/runtime";
                import { HttpAgent } from "@ag-ui/client";
                import { NextRequest } from "next/server";

                const serviceAdapter = new ExperimentalEmptyAdapter();

                const runtime = new CopilotRuntime({
                  agents: {
                    my_agent: new HttpAgent({ url: "http://localhost:8000/" }),
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
                import { CopilotKit } from "@copilotkit/react-core"; // [!code highlight]
                import "@copilotkit/react-ui/v2/styles.css";

                // ...

                export default function RootLayout({ children }: {children: React.ReactNode}) {
                  return (
                    <html lang="en">
                      <body>
                        {/* [!code highlight:3] */}
                        <CopilotKit runtimeUrl="/api/copilotkit" agent="my_agent">
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
                uv run main.py
```

                Your agent will be available at `http://localhost:8000`.
                ### Start your UI

                In a separate terminal, navigate to your frontend directory and start the development server:

```bash
                        cd my-copilot-app
                        npm run dev
```
```bash
                        cd my-copilot-app
                        pnpm dev
```
```bash
                        cd my-copilot-app
                        yarn dev
```
```bash
                        cd my-copilot-app
                        bun dev
```
        ### 🎉 Start chatting!

        Your AI agent is now ready to use! Navigate to `localhost:3000` and try asking it some questions:

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
                - Make sure your agent is running on port 8000
                - Check that your OpenAI API key is correctly set
                - Verify that the `@ag-ui/client` package is installed in your frontend

## What's next?

Now that you have your basic agent setup, explore these advanced features:

### Quickstart
- Route: `/pydantic-ai/quickstart/pydantic-ai`
- Source: `docs/content/docs/integrations/pydantic-ai/quickstart/pydantic-ai.mdx`
- Description: Turn your Pydantic AI Agents into an agent-native application in 10 minutes.

## Prerequisites

Before you begin, you'll need the following:

- [**OpenAI API key**](https://platform.openai.com/api-keys)

## Getting started

                    You can either create a new project quickly or bring your existing agent into CopilotKit.
                ### Run our CLI

```bash
                npx copilotkit@latest create -f pydantic-ai
```
                ### Install dependencies
```package-install
```
                    This will also install your agent's python dependencies! If you have trouble, try running `npm run install:agent` instead.
                ### Mount your OpenAI API key
                Your agent will need an LLM to talk to. This example uses OpenAI, but you can use any LLM provider you want.

```bash
                export OPENAI_API_KEY=your_openai_api_key
```

                Or set it in your agent's `.env` file.

```plaintext title="agent/.env"
                OPENAI_API_KEY=your_openai_api_key
```
                ### Run your agent
                Now you can run your agent and UI together in the same terminal!

```bash
                npm run dev
```
                ### Add necessary dependencies
                Pydantic AI's integration relies on [AG-UI](https://docs.ag-ui.com/), as such
                you'll need to install it into your project.

                Our examples will also use uvicorn to run the agent.

```sh
                pip install 'pydantic-ai-slim[ag-ui]' uvicorn
```
                ### Expose your agent as an AG-UI ASGI application

```python title="agent.py"
                from pydantic_ai import Agent

                agent = Agent('openai:gpt-4.1', instructions='Be fun!')
                app = agent.to_ag_ui()

                # If you want the server to run on invocation, you can do the following:
                if __name__ == "__main__":
                    import uvicorn
                    uvicorn.run(app, host="localhost", port=8000)

```
                ### Create your frontend
                CopilotKit runs anywhere that React runs. As such, you can such Next.js,
                Vite, or any other React environment.

                For this example, we'll create a new Next.js app.

```bash
                npx create-next-app@latest
```
                ### Install CopilotKit
                First, install the latest packages for CopilotKit into your frontend.
```package-install
                npm install @copilotkit/react-ui @copilotkit/react-core @copilotkit/runtime
```
                ### Setup the Copilot Runtime
                CopilotKit's runtime is responsible secure communication between your agent and your frontend. As you progress
                with your applicaiton, this will be where you'll do things like setup threads or authentication.

                For now, let's start with a minimal setup.

```tsx title="app/api/copilotkit/route.ts"
                import {
                  CopilotRuntime,
                  ExperimentalEmptyAdapter,
                  copilotRuntimeNextJSAppRouterEndpoint,
                } from "@copilotkit/runtime";
                import { HttpAgent } from "@ag-ui/client";
                import { NextRequest } from "next/server";

                // 1. You can use any service adapter here for multi-agent support. We use
                //    the empty adapter since we're only using one agent.
                const serviceAdapter = new ExperimentalEmptyAdapter();

                // 2. Create the CopilotRuntime instance and utilize the PydanticAI AG-UI
                //    integration to setup the connection.
                const runtime = new CopilotRuntime({
                  agents: {
                    // Our AG-UI endpoint URL
                    "my_agent": new HttpAgent({ url: "http://localhost:8000/" }),
                  }
                });

                // 3. Build a Next.js API route that handles the CopilotKit runtime requests.
                export const POST = async (req: NextRequest) => {
                  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
                    runtime,
                    serviceAdapter,
                    endpoint: "/api/copilotkit",
                  });

                  return handleRequest(req);
                };
```
                ### Setup the CopilotKit provider
                The CopilotKit provide component is responsible for managing the session with your current agent. Typically,
                users will wrap their entire application in the CopilotKit provider.

```tsx title="app/layout.tsx"
                import "./globals.css";
                import { ReactNode } from "react";
                import { CopilotKit } from "@copilotkit/react-core";

                export default function RootLayout({ children }: { children: ReactNode }) {
                  return (
                    <html lang="en">
                      <body>
                        {/* This points to the runtime we setup in the previous step */}
                        {/* [!code highlight:3] */}
                        <CopilotKit runtimeUrl="/api/copilotkit" agent="my_agent">
                          {children}
                        </CopilotKit>
                      </body>
                    </html>
                  );
                }
```
                ### Setup the Copilot UI
                The last step is to use CopilotKit's UI components to render the chat interaction with your agent. In most situations,
                this is done alongside your core page components, e.g. in your `page.tsx` file.

```tsx title="page.tsx"
                // [!code highlight:2]
                import "@copilotkit/react-ui/v2/styles.css";
                import { CopilotSidebar } from "@copilotkit/react-core/v2";

                export function YourApp() {
                return (
                    <main>
                    <h1>Your main content</h1>
                    {/* [!code highlight:6] */}
                    <CopilotSidebar
                        labels={{
                            modalHeaderTitle: "Popup Assistant",
                            welcomeMessageText: "Hi! I'm connected to an agent. How can I help?",
                        }}
                    />
                    </main>
                );
                }
```

                    Looking for other chat component options? Check out our [Agentic Chat UI](/pydantic-ai/prebuilt-components) guide.
        ### 🎉 Talk to your agent!

        Congrats! You've successfully integrated a Pydantic AI Agent chatbot to your application. To start, try asking a few questions to your agent.

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

You've now got a Pydantic AI Agent running in CopilotKit! Now you can start exploring the various ways that CopilotKit
can help you build power agent native applications.

### Reading agent state
- Route: `/pydantic-ai/shared-state/in-app-agent-read`
- Source: `docs/content/docs/integrations/pydantic-ai/shared-state/in-app-agent-read.mdx`
- Description: Read the realtime agent state in your native application.

```python title="agent.py"
    from textwrap import dedent

    from pydantic import BaseModel
    from pydantic_ai import Agent, RunContext
    from pydantic_ai.ag_ui import StateDeps

    class AgentState(BaseModel):
        """State for the agent."""
        language: str = "english"

    agent = Agent("openai:gpt-5.2-mini", deps_type=StateDeps[AgentState])

    @agent.instructions()
    async def language_instructions(ctx: RunContext[StateDeps[AgentState]]) -> str:
        """Instructions for the language tracking agent.

        Args:
            ctx: The run context containing language state information.

        Returns:
            Instructions string for the language tracking agent.
        """
        return dedent(
            f"""
            You are a helpful assistant for tracking the language.

            IMPORTANT:
            - ALWAYS use the lower case for the language
            - ALWAYS response in the current language: {ctx.deps.state.language}
            """
        )

    app = agent.to_ag_ui(deps=StateDeps(AgentState()))

    if __name__ == "__main__":
        import uvicorn
        uvicorn.run(app, host="0.0.0.0", port=8000)
```
```tsx title="ui/app/page.tsx"
    import { useAgent } from "@copilotkit/react-core/v2"; // [!code highlight]

    // Define the agent state type, should match the actual state of your agent
    type AgentState = {
      language: "english" | "spanish";
    }

    function YourMainContent() {
      // [!code highlight:4]
      const { agent } = useAgent({
        name: "my_agent", // MUST match the agent name in CopilotRuntime
        initialState: { language: "english" }  // optionally provide an initial state
      });

      // ...

      return (
        // style excluded for brevity
        <div>
          <h1>Your main content</h1>
          {/* [!code highlight:1] */}
          <p>Language: {agent.state?.language}</p>
        </div>
      );
    }
```
```tsx title="ui/app/page.tsx"
import { useAgent } from "@copilotkit/react-core/v2"; // [!code highlight]

// Define the agent state type, should match the actual state of your agent
type AgentState = {
  language: "english" | "spanish";
};

function YourMainContent() {
  // ...
  // [!code highlight:7]
  useAgent({
    name: "my_agent", // MUST match the agent name in CopilotRuntime
    render: ({ state }) => {
      if (!state.language) return null;
      return <div>Language: {state.language}</div>;
    },
  });
  // ...
}
```

### Writing agent state
- Route: `/pydantic-ai/shared-state/in-app-agent-write`
- Source: `docs/content/docs/integrations/pydantic-ai/shared-state/in-app-agent-write.mdx`
- Description: Write to agent's state from your application.

```python title="agent.py"
    from textwrap import dedent

    from pydantic import BaseModel
    from pydantic_ai import Agent, RunContext
    from pydantic_ai.ag_ui import StateDeps

    class AgentState(BaseModel):
        """State for the agent."""
        language: str = "english"

    agent = Agent("openai:gpt-5.2-mini", deps_type=StateDeps[AgentState])

    @agent.instructions()
    async def language_instructions(ctx: RunContext[StateDeps[AgentState]]) -> str:
        """Instructions for the language tracking agent.

        Args:
            ctx: The run context containing language state information.

        Returns:
            Instructions string for the language tracking agent.
        """
        return dedent(
            f"""
            You are a helpful assistant for tracking the language.

            IMPORTANT:
            - ALWAYS use the lower case for the language
            - ALWAYS response in the current language: {ctx.deps.state.language}
            """
        )

    app = agent.to_ag_ui(deps=StateDeps(AgentState()))

    if __name__ == "__main__":
        import uvicorn
        uvicorn.run(app, host="0.0.0.0", port=8000)
```
```tsx title="ui/app/page.tsx"
    import { useAgent } from "@copilotkit/react-core/v2"; // [!code highlight]

    // Define the agent state type, should match the actual state of your agent
    type AgentState = {
      language: "english" | "spanish";
    }

    // Example usage in a pseudo React component
    function YourMainContent() {
      const { agent } = useAgent({ // [!code highlight]
        name: "my_agent", // MUST match the agent name in CopilotRuntime
        initialState: { language: "english" }  // optionally provide an initial state
      });

      // ...

      const toggleLanguage = () => {
        agent.setState({ language: agent.state?.language === "english" ? "spanish" : "english" }); // [!code highlight]
      };

      // ...

      return (
        // style excluded for brevity
        <div>
          <h1>Your main content</h1>
          {/* [!code highlight:2] */}
          <p>Language: {agent.state?.language}</p>
          <button onClick={toggleLanguage}>Toggle Language</button>
        </div>
      );
    }
```
```tsx title="ui/app/page.tsx"
import { useAgent } from "@copilotkit/react-core/v2";
import { TextMessage, MessageRole } from "@copilotkit/runtime-client-gql";  // [!code highlight]

// ...

function YourMainContent() {
  // [!code word:run:1]
  const { agent, run } = useAgent({
    name: "my_agent", // MUST match the agent name in CopilotRuntime
    initialState: { language: "english" }  // optionally provide an initial state
  });

  // setup to be called when some event in the app occurs
  const toggleLanguage = () => {
    const newLanguage = agent.state?.language === "english" ? "spanish" : "english";
    agent.setState({ language: newLanguage });

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

### Shared State
- Route: `/pydantic-ai/shared-state`
- Source: `docs/content/docs/integrations/pydantic-ai/shared-state/index.mdx`
- Description: Create a two-way connection between your UI and Pydantic AI agent state.

## What is shared state?

CoAgents maintain a shared state that seamlessly connects your UI with the agent's execution. This shared state system allows you to:

- Display the agent's current progress and intermediate results
- Update the agent's state through UI interactions
- React to state changes in real-time across your application

The foundation of this system is built on Pydantic AI's stateful architecture via AG-UI.

## When should I use this?

State streaming is perfect when you want to facilitate collaboration between your agent and the user. Any state that your Pydantic AI agent
persists will be automatically shared by the UI. Similarly, any state that the user updates in the UI will be automatically reflected.

This allows for a consistent experience where both the agent and the user are on the same page.

### Predictive state updates
- Route: `/pydantic-ai/shared-state/predictive-state-updates`
- Source: `docs/content/docs/integrations/pydantic-ai/shared-state/predictive-state-updates.mdx`
- Description: Stream in-progress agent state updates to the frontend.

```python title="agent.py"
        from pydantic import BaseModel
        from pydantic_ai import Agent
        from pydantic_ai.ag_ui import StateDeps

        class AgentState(BaseModel):
            """State for the agent."""
            observed_steps: list[str] = []

        agent = Agent('openai:gpt-5.2-mini', deps_type=StateDeps[AgentState])
        app = agent.to_ag_ui(deps=StateDeps(AgentState()))

        if __name__ == "__main__":
            import uvicorn
            uvicorn.run(app, host="0.0.0.0", port=8000)
```
```python title="agent.py"
                import asyncio
                from ag_ui.core import StateSnapshotEvent, EventType
                from pydantic_ai import Agent
                from pydantic_ai.ag_ui import StateDeps

                @agent.tool_plain
                async def update_steps(steps: list[str]) -> StateSnapshotEvent:
                    """Update the steps of the agent."""
                    return StateSnapshotEvent(
                        type=EventType.STATE_SNAPSHOT,
                        snapshot={
                            "observed_steps": steps
                        }
                    )
```
```python title="agent.py"
                from ag_ui.core import CustomEvent, EventType

                @agent.tool_plain
                def enable_document_prediction() -> CustomEvent:
                    """Enable document state prediction."""
                    return CustomEvent(
                        type=EventType.CUSTOM,
                        name='PredictState',
                        value=[{
                            'state_key': 'observed_steps',
                            'tool': 'update_steps',
                            'tool_argument': 'steps',
                        }]
                    )
```
```tsx title="ui/app/page.tsx"
        import { useAgent } from "@copilotkit/react-core/v2";

        // ...

        const YourMainContent = () => {
            // Get access to both predicted and final states
            const { agent } = useAgent({ name: "my_agent" }); // MUST match the agent name in CopilotRuntime

            // Add a state renderer to observe predictions
            useAgent({
                name: "my_agent", // MUST match the agent name in CopilotRuntime
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
                    {agent.state?.observed_steps?.length > 0 && (
                        <div>
                            <h3>Final Steps:</h3>
                            <ul>
                                {agent.state.observed_steps.map((step, i) => (
                                    <li key={i}>{step}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )
        }
```
