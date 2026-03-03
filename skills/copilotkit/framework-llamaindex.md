# LlamaIndex Integration

CopilotKit implementation guide for LlamaIndex.

> For shared CopilotKit concepts (runtime setup, prebuilt components, troubleshooting, etc.), see the topic guides. This file focuses on framework-specific implementation details.

## Guidance
### State Rendering
- Route: `/llamaindex/generative-ui/state-rendering`
- Source: `docs/content/docs/integrations/llamaindex/generative-ui/state-rendering.mdx`
- Description: Render the state of your agent with custom UI components.

```python title="agent.py"
    import asyncio
    from typing import Annotated
    from fastapi import FastAPI
    from llama_index.llms.openai import OpenAI
    from llama_index.core.workflow import Context
    from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router
    from llama_index.protocols.ag_ui.events import StateSnapshotWorkflowEvent

    async def addSearch(
        ctx: Context,
        query: Annotated[str, "The search query to add."]
    ) -> str:
        """Add a search to the agent's list of searches."""
        async with ctx.store.edit_state() as global_state:
            state = global_state.get("state", {})
            if state is None:
                state = {}

            if "searches" not in state:
                state["searches"] = []

            # Add new search
            new_search = {"query": query, "done": False}
            state["searches"].append(new_search)

            # Emit state snapshot to frontend
            ctx.write_event_to_stream(
                StateSnapshotWorkflowEvent(
                    snapshot=state
                )
            )

            global_state["state"] = state

        return f"Added search: {query}"

    async def runSearches(ctx: Context) -> str:
        """Run all the searches that have been added."""
        async with ctx.store.edit_state() as global_state:
            state = global_state.get("state", {})
            if state is None:
                state = {}

            if "searches" not in state:
                state["searches"] = []

            # Update each search to done
            for search in state["searches"]:
                if not search.get("done", False):
                    await asyncio.sleep(1)  # Simulate search execution
                    search["done"] = True

                    # Emit state update as each search completes
                    ctx.write_event_to_stream(
                        StateSnapshotWorkflowEvent(
                            snapshot=state
                        )
                    )

            global_state["state"] = state

        return "All searches completed!"

    # Initialize the LLM
    llm = OpenAI(model="gpt-5.2")

    # Create the AG-UI workflow router
    agentic_chat_router = get_ag_ui_workflow_router(
        llm=llm,
        system_prompt="""
        You are a helpful assistant for storing searches.

        IMPORTANT:
        - Use the addSearch tool to add a search to the agent's state
        - After using the addSearch tool, YOU MUST ALWAYS use the runSearches tool to run the searches
        - ONLY USE THE addSearch TOOL ONCE FOR A GIVEN QUERY

        When adding searches, update the state to track:
        - query: the search query
        - done: whether the search is complete (false initially, true after running)
        """,
        backend_tools=[addSearch, runSearches],
        initial_state={
            "searches": []
        },
    )

    # Create FastAPI app
    app = FastAPI(
        title="LlamaIndex Agent",
        description="A LlamaIndex agent integrated with CopilotKit",
        version="1.0.0"
    )

    # Include the router
    app.include_router(agentic_chat_router)

    # Health check endpoint
    @app.get("/health")
    async def health_check():
        return {"status": "healthy", "agent": "llamaindex"}

    if __name__ == "__main__":
        import uvicorn
        uvicorn.run(app, host="localhost", port=8000)
```
```tsx title="app/page.tsx"
    // ...
    import { useAgent } from "@copilotkit/react-core/v2";
    // ...

    // Define the state of the agent, should match the state of your LlamaIndex Agent.
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
        name: "my_agent", // MUST match the agent name in CopilotRuntime
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
```tsx title="app/page.tsx"
    import { useAgent } from "@copilotkit/react-core/v2"; // [!code highlight]
    // ...

    // Define the state of the agent, should match the state of your LlamaIndex Agent.
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
        name: "my_agent", // MUST match the agent name in CopilotRuntime
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

### Tool Rendering
- Route: `/llamaindex/generative-ui/tool-rendering`
- Source: `docs/content/docs/integrations/llamaindex/generative-ui/tool-rendering.mdx`
- Description: Render your agent's tool calls with custom UI components.

```python title="agent.py"
from fastapi import FastAPI
from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router

def getWeather(location: str) -> str:
    """Get the weather for a given location."""
    return f"The weather in {location} is sunny and 70 degrees."

# Initialize the LLM
llm = OpenAI(model="gpt-5.2")

# Create the AG-UI workflow router
agentic_chat_router = get_ag_ui_workflow_router(
    llm=llm,
    # These are the tools that only have a render function in the frontend
    backend_tools=[getWeather],
    system_prompt="You are a helpful AI assistant with access to various tools and capabilities.",
)

# Create FastAPI app
app = FastAPI(
    title="LlamaIndex Agent",
    description="A LlamaIndex agent integrated with CopilotKit",
    version="1.0.0"
)

# Include the router
app.include_router(agentic_chat_router)

# Health check endpoint
@app.get("/health")
async def health_check():
    return {"status": "healthy", "agent": "llamaindex"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="localhost", port=8000)
```
```tsx title="app/page.tsx"
import { useRenderToolCall } from "@copilotkit/react-core/v2"; // [!code highlight]
// ...

const YourMainContent = () => {
  // ...
  // [!code highlight:12]
  useRenderToolCall({
    name: "getWeather",
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
};
```

### Human-in-the-Loop
- Route: `/llamaindex/human-in-the-loop`
- Source: `docs/content/docs/integrations/llamaindex/human-in-the-loop.mdx`
- Description: Create frontend tools and use them within your LlamaIndex agent for human-in-the-loop interactions.

```python title="agent.py"
        from fastapi import FastAPI
        from llama_index.llms.openai import OpenAI
        from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router

        def offerOptions(option_1: str, option_2: str) -> str:
            """Give the user a choice between two options and have them select one."""
            return f"Presenting options: {option_1} or {option_2}"

        # Initialize the LLM
        llm = OpenAI(model="gpt-5.2")

        # Create the AG-UI workflow router
        agentic_chat_router = get_ag_ui_workflow_router(
            llm=llm,
            frontend_tools=[offerOptions],
            system_prompt="You are a helpful AI assistant that can write essays. When the user asks you to choose between two options or when you need to present them with a choice, you MUST use the offerOptions tool to let them select between the options.",
        )

        # Create FastAPI app
        app = FastAPI(
            title="LlamaIndex Agent",
            description="A LlamaIndex agent integrated with CopilotKit",
            version="1.0.0"
        )

        # Include the router
        app.include_router(agentic_chat_router)

        # Health check endpoint
        @app.get("/health")
        async def health_check():
            return {"status": "healthy", "agent": "llamaindex"}

        if __name__ == "__main__":
            import uvicorn
            uvicorn.run(app, host="localhost", port=8000)
```
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
```
        Can you show me two good options for a restaurant name?
```

### Introduction
- Route: `/llamaindex`
- Source: `docs/content/docs/integrations/llamaindex/index.mdx`
- Description: Bring your LlamaIndex agents to your users with CopilotKit via AG-UI.

// TODO: Re-add once the dojo example is updated and works
    /*{
    },*/

### Multi-Agent Flows
- Route: `/llamaindex/multi-agent-flows`
- Source: `docs/content/docs/integrations/llamaindex/multi-agent-flows.mdx`
- Description: Use multiple LlamaIndex agents to orchestrate complex flows.

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
- Route: `/llamaindex/quickstart`
- Source: `docs/content/docs/integrations/llamaindex/quickstart.mdx`
- Description: Turn your LlamaIndex Agents into an agent-native application in 10 minutes.

## Prerequisites

Before you begin, you'll need the following:

- An OpenAI API key
- Node.js 20+
- Python 3.10+
- Your favorite package manager

## Getting started

                    You can either start fresh with our starter template or integrate CopilotKit into your existing LlamaIndex agent.
                ### Run our CLI

```bash
                npx copilotkit@latest create -f llamaindex
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

                  The starter template is configured to use OpenAI's GPT-4o by default, but you can modify it to use any language model supported by LlamaIndex.
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
                What tools do you have access to?
```

```
                What do you think about React?
```

```
                Show me some cool things you can do!
```

                        - If you're having connection issues, try using `0.0.0.0` or `127.0.0.1` instead of `localhost`
                        - Make sure your agent is running on port 8000
                        - Check that your OpenAI API key is correctly set

                ### Initialize your agent project

                If you don't already have a Python project set up, create one using `uv`:

```bash
                uv init my-agent
                cd my-agent
```
                ### Install LlamaIndex with AG-UI

                Add LlamaIndex with AG-UI support and uvicorn to your project:

```bash
                uv add llama-index llama-index-llms-openai llama-index-protocols-ag-ui fastapi uvicorn
```

                  AG-UI is an open protocol for frontend-agent communication. The `llama-index-protocols-ag-ui` package provides LlamaIndex integration that CopilotKit can connect to.
                ### Configure your environment

                Set your OpenAI API key as an environment variable:

```bash
                export OPENAI_API_KEY=your_openai_api_key
```

                  This example uses OpenAI's GPT-4o, but you can modify it to use any language model supported by LlamaIndex.
                ### Expose your agent via AG-UI

                Update your agent file to expose it as an AG-UI ASGI application:

```python title="main.py"
                from fastapi import FastAPI
                from llama_index.llms.openai import OpenAI
                from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router

                # Initialize the LLM
                llm = OpenAI(model="gpt-5.2")

                # Create the AG-UI workflow router
                agentic_chat_router = get_ag_ui_workflow_router(
                    llm=llm,
                    system_prompt="You are a helpful AI assistant with access to various tools and capabilities.",
                )

                # Create FastAPI app
                app = FastAPI(
                    title="LlamaIndex Agent",
                    description="A LlamaIndex agent integrated with CopilotKit",
                    version="1.0.0"
                )

                # Include the router
                app.include_router(agentic_chat_router)

                # Health check endpoint
                @app.get("/health")
                async def health_check():
                    return {"status": "healthy", "agent": "llamaindex"}

                if __name__ == "__main__":
                    import uvicorn
                    uvicorn.run(app, host="localhost", port=8000)
```
                ### Create your frontend

                CopilotKit works with any React-based frontend. We'll use Next.js for this example.

```bash
                npx create-next-app@latest my-copilot-app
                cd my-copilot-app
```
                ### Install CopilotKit packages

```npm
                npm install @copilotkit/react-ui @copilotkit/react-core @copilotkit/runtime @ag-ui/llamaindex
```
                ### Setup Copilot Runtime

                Create an API route to connect CopilotKit to your LlamaIndex agent:

```tsx title="app/api/copilotkit/route.ts"
                import {
                  CopilotRuntime,
                  ExperimentalEmptyAdapter,
                  copilotRuntimeNextJSAppRouterEndpoint,
                } from "@copilotkit/runtime";
                import { LlamaIndexAgent } from "@ag-ui/llamaindex";
                import { NextRequest } from "next/server";

                const serviceAdapter = new ExperimentalEmptyAdapter();

                const runtime = new CopilotRuntime({
                  agents: {
                    my_agent: new LlamaIndexAgent({ url: "http://localhost:8000/run" }),
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
                import { CopilotKit } from "@copilotkit/react-core/v2"; // [!code highlight]
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
                        - Verify that the `@ag-ui/llamaindex` package is installed in your frontend

## What's next?

Now that you have your basic agent setup, explore these advanced features:

### Reading agent state
- Route: `/llamaindex/shared-state/in-app-agent-read`
- Source: `docs/content/docs/integrations/llamaindex/shared-state/in-app-agent-read.mdx`
- Description: Read the realtime agent state in your native application.

```python title="agent.py"
    from fastapi import FastAPI
    from llama_index.llms.openai import OpenAI
    from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router

    # Initialize the LLM
    llm = OpenAI(model="gpt-5.2")

    # Create the AG-UI workflow router
    agentic_chat_router = get_ag_ui_workflow_router(
        llm=llm,
        system_prompt="""
        You are a helpful assistant for tracking the language.

        IMPORTANT:
        - ALWAYS use the lower case for the language
        - ALWAYS respond in the current language from the state
        """,
        initial_state={
            "language": "english"
        },
    )

    # Create FastAPI app
    app = FastAPI(
        title="LlamaIndex Agent",
        description="A LlamaIndex agent integrated with CopilotKit",
        version="1.0.0"
    )

    # Include the router
    app.include_router(agentic_chat_router)

    # Health check endpoint
    @app.get("/health")
    async def health_check():
        return {"status": "healthy", "agent": "llamaindex"}

    if __name__ == "__main__":
        import uvicorn
        uvicorn.run(app, host="localhost", port=8000)
```
```tsx title="ui/app/page.tsx"
    "use client";

    import { useAgent } from "@copilotkit/react-core/v2"; // [!code highlight]

    // Define the agent state type, should match the actual state of your agent
    type AgentState = {
      language: "english" | "spanish";
    }

    function YourMainContent() {
      // [!code highlight:4]
      const { agentState } = useAgent<AgentState>({
        name: "my_agent", // MUST match the agent name in CopilotRuntime
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
    name: "my_agent", // MUST match the agent name in CopilotRuntime
    render: ({ agentState }) => {
      if (!agentState.language) return null;
      return <div>Language: {agentState.language}</div>;
    },
  });
  // ...
}
```

### Writing agent state
- Route: `/llamaindex/shared-state/in-app-agent-write`
- Source: `docs/content/docs/integrations/llamaindex/shared-state/in-app-agent-write.mdx`
- Description: Write to agent's state from your application.

```python title="agent.py"
    from fastapi import FastAPI
    from llama_index.llms.openai import OpenAI
    from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router

    # Initialize the LLM
    llm = OpenAI(model="gpt-5.2")

    # Create the AG-UI workflow router
    agentic_chat_router = get_ag_ui_workflow_router(
        llm=llm,
        system_prompt="""
        You are a helpful assistant for tracking the language.

        IMPORTANT:
        - ALWAYS use the lower case for the language
        - ALWAYS respond in the current language from the state
        """,
        initial_state={
            "language": "english"
        },
    )

    # Create FastAPI app
    app = FastAPI(
        title="LlamaIndex Agent",
        description="A LlamaIndex agent integrated with CopilotKit",
        version="1.0.0"
    )

    # Include the router
    app.include_router(agentic_chat_router)

    # Health check endpoint
    @app.get("/health")
    async def health_check():
        return {"status": "healthy", "agent": "llamaindex"}

    if __name__ == "__main__":
        import uvicorn
        uvicorn.run(app, host="localhost", port=8000)
```
```tsx title="ui/app/page.tsx"
    "use client";

    import { useAgent } from "@copilotkit/react-core/v2"; // [!code highlight]

    // Define the agent state type, should match the actual state of your agent
    type AgentState = {
      language: "english" | "spanish";
    }

    // Example usage in a pseudo React component
    function YourMainContent() {
      const { agentState, setAgentState } = useAgent<AgentState>({ // [!code highlight]
        name: "my_agent", // MUST match the agent name in CopilotRuntime
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
```tsx title="ui/app/page.tsx"
import { useAgent } from "@copilotkit/react-core/v2";
import { TextMessage, MessageRole } from "@copilotkit/runtime-client-gql";  // [!code highlight]

// ...

function YourMainContent() {
  // [!code word:run:1]
  const { agentState, setAgentState, run } = useAgent<AgentState>({
    name: "my_agent", // MUST match the agent name in CopilotRuntime
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

### Shared State
- Route: `/llamaindex/shared-state`
- Source: `docs/content/docs/integrations/llamaindex/shared-state/index.mdx`
- Description: Create a two-way connection between your UI and agent state.

## What is shared state?

CoAgents maintain a shared state that seamlessly connects your UI with the agent's execution. This shared state system allows you to:

- Display the agent's current progress and intermediate results
- Update the agent's state through UI interactions
- React to state changes in real-time across your application

The foundation of this system is built on LlamaIndex's AG-UI protocol integration, which provides `initial_state` support in the workflow router.

## When should I use this?

State streaming is perfect when you want to facilitate collaboration between your agent and the user. Any state that your LlamaIndex Agent
persists will be automatically shared by the UI. Similarly, any state that the user updates in the UI will be automatically reflected.

This allows for a consistent experience where both the agent and the user are on the same page.

### Predictive state updates
- Route: `/llamaindex/shared-state/predictive-state-updates`
- Source: `docs/content/docs/integrations/llamaindex/shared-state/predictive-state-updates.mdx`
- Description: Stream in-progress agent state updates to the frontend.

{/* <IframeSwitcher

  This example demonstrates predictive state updates in the [CopilotKit Feature Viewer](https://feature-viewer.copilotkit.ai/llama-index/feature/predictive_state_updates).

## What is this?

A LlamaIndex agent's state updates discontinuously; only when state changes are explicitly made.
But even a _single operation_ often takes many seconds to run and contains sub-steps of interest to the user.

**Agent-native applications** reflect to the end-user what the agent is doing **as continuously as possible.**

CopilotKit enables this through its concept of **_predictive state updates_**.

## When should I use this?

Use predictive state updates when you want to:
- **Keep users engaged** by avoiding long loading indicators
- **Build trust** by demonstrating what the agent is working on
- Enable **agent steering** - allowing users to course-correct the agent if needed

## Important Note

When your agent finishes executing, **its final state becomes the single source of truth**. While intermediate state updates are great for real-time feedback, any changes you want to persist must be explicitly included in the final state. Otherwise, they will be overwritten when the operation completes.

## Implementation

    ### Define the state
    We'll be defining an `observed_steps` field in the state, which will be updated as the agent performs different steps of a task.

```python title="agent.py"
    from typing import List
    from llama_index.llms.openai import OpenAI
    from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router
    from fastapi import FastAPI

    # Define initial state with observed_steps
    initial_state = {
        "observed_steps": []
    }
```
    ### Emit the intermediate state

                    You can either manually emit state updates or configure specific tool calls to emit updates.
            For long-running tasks, you can create a tool that updates state and emits it to the frontend. In this example, we'll create a step progress tool that the LLM calls to report its progress.

```python title="agent.py"
            import asyncio
            from typing import Annotated, List
            from pydantic import BaseModel
            from fastapi import FastAPI
            from llama_index.core.workflow import Context
            from llama_index.llms.openai import OpenAI
            from llama_index.protocols.ag_ui.events import StateSnapshotWorkflowEvent
            from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router

            class Step(BaseModel):
                """A single step in a task."""
                description: str

            class Task(BaseModel):
                """A task with a list of steps to execute."""
                steps: List[Step]

            async def execute_task(ctx: Context, task: Task) -> str:
                """Execute a list of steps for any task. Use this for any task the user wants to accomplish.

                Args:
                    ctx: The workflow context for accessing and updating state.
                    task: The task containing the list of steps to execute.

                Returns:
                    str: Confirmation that the task was completed.
                """
                task = Task.model_validate(task)

                async with ctx.store.edit_state() as global_state:
                    state = global_state.get("state", {})
                    if state is None:
                        state = {}

                    # Initialize all steps as pending
                    state["observed_steps"] = [
                        {"description": step.description, "status": "pending"}
                        for step in task.steps
                    ]

                    # Send initial state snapshot
                    ctx.write_event_to_stream(
                        StateSnapshotWorkflowEvent(snapshot=state)
                    )

                    # Simulate step execution with delays
                    await asyncio.sleep(0.5)

                    # Update each step to completed one by one
                    for i in range(len(state["observed_steps"])):
                        state["observed_steps"][i]["status"] = "completed"

                        # Emit updated state after each step
                        ctx.write_event_to_stream(
                            StateSnapshotWorkflowEvent(snapshot=state)
                        )

                        # Small delay between steps for visual effect
                        await asyncio.sleep(0.5)

                    global_state["state"] = state

                return "Task completed successfully!"

            # Initialize the LLM
            llm = OpenAI(model="gpt-5.2")

            # Create the AG-UI workflow router
            agentic_chat_router = get_ag_ui_workflow_router(
                llm=llm,
                system_prompt=(
                    "You are a helpful assistant that can help the user with their task. "
                    "When the user asks you to do any task (like creating a recipe, planning something, etc.), "
                    "use the execute_task tool with a list of steps. Use your best judgment to describe the steps. "
                    "Always use the tool for any actionable request."
                ),
                backend_tools=[execute_task],
                initial_state={
                    "observed_steps": [],
                },
            )

            # Create FastAPI app
            app = FastAPI(
                title="LlamaIndex Agent",
                description="A LlamaIndex agent integrated with CopilotKit",
                version="1.0.0"
            )

            # Include the router
            app.include_router(agentic_chat_router)

            # Health check endpoint
            @app.get("/health")
            async def health_check():
                return {"status": "healthy", "agent": "llamaindex"}

            if __name__ == "__main__":
                import uvicorn
                uvicorn.run(app, host="localhost", port=8000)
```

              With this configuration, the agent emits state updates each time it calls the `stepProgress` tool, giving the frontend real-time visibility into progress.
    ### Observe the predictions
    These predictions will be emitted as the agent runs, allowing you to track its progress before the final state is determined.

```tsx title="ui/app/page.tsx"
    "use client";

    import { useAgent } from "@copilotkit/react-core/v2";
    import { CopilotSidebar } from '@copilotkit/react-ui';
    import '@copilotkit/react-ui/v2/styles.css';

    interface Step {
        description: string;
        status: 'pending' | 'completed';
    }

    interface AgentState {
        observed_steps: Step[];
    }

    export default function Page() {
        // Get access to both predicted and final states
        const { agentState } = useAgent<AgentState>({ name: "my_agent" });

        // Add a state renderer to show progress in the chat
        useAgent<AgentState>({
            name: "my_agent",
            render: ({ agentState, status }) => {
                if (!agentState?.observed_steps?.length) return null;
                return (
                    <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 my-2">
                        <h3 className="font-semibold text-gray-700 mb-2">
                            {status === 'inProgress' ? '⏳ Progress:' : '✅ Completed:'}
                        </h3>
                        <ul className="space-y-1">
                            {agentState.observed_steps.map((step, i) => (
                                <li key={i} className="flex items-center gap-2">
                                    <span>
                                        {step.status === 'completed' ? '✅' : '⏳'}
                                    </span>
                                    <span className={step.status === 'completed' ? 'text-green-700' : 'text-gray-600'}>
                                        {step.description}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                );
            },
        });

        return (
            <div>
                <header>
                    <h1>Agent Progress Demo</h1>
                </header>

                <main>
                    {/* Side panel showing final state */}
                    <aside>
                        <h2>Agent State</h2>
                        {agentState?.observed_steps?.length > 0 ? (
                            <ul>
                                {agentState.observed_steps.map((step, i) => (
                                    <li key={i}>
                                        <span>{step.status === 'completed' ? '✅' : '⏳'}</span>
                                        <span>{step.description}</span>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p>
                                {"No steps yet. Try asking to build a plan like \"create a recipe for ___\" or \"teach me how to fix a tire.\""}
                            </p>
                        )}
                    </aside>

                    {/* Chat area */}
                    <CopilotSidebar
                        labels={{
                            welcomeMessageText: "Hi! Ask me to do a task like \"teach me how to fix a tire.\""
                        }}
                    />
                </main>
            </div>
        );
    }
```

      The `name` parameter must exactly match the agent name you defined in your CopilotRuntime configuration (e.g., `my_agent` from the quickstart).
    ### Give it a try!
    Now you'll notice that the state predictions are emitted as the agent makes progress, giving you insight into its work before the final state is determined.
    You can apply this pattern to any long-running task in your agent.

### Workflow Execution
- Route: `/llamaindex/shared-state/state-inputs-outputs`
- Source: `docs/content/docs/integrations/llamaindex/shared-state/state-inputs-outputs.mdx`
- Description: Decide which state properties are received and returned to the frontend.

## What is this?

Not all state properties are relevant for frontend-backend sharing.
This guide shows how to ensure only the right portion of state is communicated back and forth.

## When should I use this?

Depending on your implementation, some properties are meant to be processed internally, while some others are the way for the UI to communicate user input.
In addition, some state properties contain a lot of information. Syncing them back and forth between the agent and UI can be costly, while it might not have any practical benefit.

## Implementation

    ### Examine your state structure
    LlamaIndex agents using the AG-UI workflow router are stateful. As you execute tools and process messages, that state is updated and available throughout the session. For this example,
    let's assume that the state our agent should be using can be described like this:

```python title="agent.py"
    # Full state structure for the agent
    initial_state = {
        "question": "",         # Input from user
        "answer": "",           # Output to user
        "resources": []         # Internal use only
    }
```
    ### Organize state by purpose
    Our example case lists several state properties, each with its own purpose:
      - The **question** is being asked by the user, expecting the LLM to answer
      - The **answer** is what the LLM returns
      - The **resources** list will be used by the LLM to answer the question, and should not be communicated to the user, or set by them

    Here's a complete example showing how to structure your agent with these considerations:

```python title="agent.py"
    from typing import Annotated, List
    from fastapi import FastAPI
    from llama_index.llms.openai import OpenAI
    from llama_index.core.workflow import Context
    from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router
    from llama_index.protocols.ag_ui.events import StateSnapshotWorkflowEvent

    async def answerQuestion(
        ctx: Context,
        answer: Annotated[str, "The answer to store in state."]
    ) -> str:
        """Stores the answer to the user's question in shared state.

        Args:
            ctx: The workflow context for state management.
            answer: The answer to store in state.

        Returns:
            str: A message indicating the answer was stored.
        """
        async with ctx.store.edit_state() as global_state:
            state = global_state.get("state", {})
            if state is None:
                state = {}

            state["answer"] = answer

            # Emit state update to frontend
            ctx.write_event_to_stream(
                StateSnapshotWorkflowEvent(snapshot=state)
            )

            global_state["state"] = state

        return f"Answer stored: {answer}"

    async def addResource(
        ctx: Context,
        resource: Annotated[str, "The resource URL or reference to add."]
    ) -> str:
        """Adds a resource to the internal resources list in shared state.

        Args:
            ctx: The workflow context for state management.
            resource: The resource URL or reference to add.

        Returns:
            str: A message indicating the resource was added.
        """
        async with ctx.store.edit_state() as global_state:
            state = global_state.get("state", {})
            if state is None:
                state = {}

            resources = state.get("resources", [])
            resources.append(resource)
            state["resources"] = resources

            global_state["state"] = state

        return f"Resource added: {resource}"

    # Initialize the LLM
    llm = OpenAI(model="gpt-5.2")

    # Create the AG-UI workflow router
    agentic_chat_router = get_ag_ui_workflow_router(
        llm=llm,
        system_prompt="""
        You are a helpful assistant. When the user asks a question:
        1. Think through your answer
        2. Optionally use addResource to track any sources you reference
        3. Use answerQuestion to provide your final answer - this stores it in state for the user to see

        Always use the answerQuestion tool to provide your response so it appears in the UI.
        """,
        backend_tools=[answerQuestion, addResource],
        initial_state={
            "question": "",       # Input: received from frontend
            "answer": "",         # Output: sent to frontend
            "resources": []       # Internal: tracking resources
        },
    )

    # Create FastAPI app
    app = FastAPI(
        title="LlamaIndex Agent",
        description="A LlamaIndex agent integrated with CopilotKit",
        version="1.0.0"
    )

    # Include the router
    app.include_router(agentic_chat_router)

    # Health check endpoint
    @app.get("/health")
    async def health_check():
        return {"status": "healthy", "agent": "llamaindex"}

    if __name__ == "__main__":
        import uvicorn
        uvicorn.run(app, host="localhost", port=8000)
```
    ### Use the state in your frontend
    Now that we know which state properties our agent uses, we can work with them in the UI:
    - **question**: Set by the UI to ask the agent something
    - **answer**: Read from the agent's response
    - **resources**: Not accessible to the UI (internal agent use only)

```tsx title="ui/app/page.tsx"
    "use client";

    import { useState } from "react";
    import { useAgent } from "@copilotkit/react-core/v2";

    // Define the agent state type, should match the actual state of your agent
    type AgentState = {
      question: string;
      answer: string;
    }

    /* Example usage in a pseudo React component */
    function YourMainContent() { // [!code highlight]
      const [inputQuestion, setInputQuestion] = useState("What's the capital of France?");
      const [isLoading, setIsLoading] = useState(false);

      const { agentState, setAgentState, run } = useAgent<AgentState>({
        name: "my_agent",
        initialState: {
          question: "",
          answer: "",
        }
      });

      const askQuestion = async (newQuestion: string) => {
        setIsLoading(true);

        // Update the state with the new question
        setAgentState({ ...agentState, question: newQuestion, answer: "" });

        try {
          // Trigger the agent to run with a hint message that includes the question
          await run(() => ({
            id: crypto.randomUUID(),
            role: "user" as const,
            content: newQuestion,
          }));
        } catch (error) {
          console.error("Error running agent:", error);
        } finally {
          setIsLoading(false);
        }
      };

      return (
        <div style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
          <h1>Q&A Assistant</h1>

          <div style={{ marginBottom: "1rem" }}>
            <input
              type="text"
              value={inputQuestion}
              onChange={(e) => setInputQuestion(e.target.value)}
              placeholder="Enter your question..."
              style={{ 
                padding: "0.5rem", 
                width: "300px", 
                marginRight: "0.5rem",
                borderRadius: "4px",
                border: "1px solid #ccc"
              }}
            />
            <button 
              onClick={() => askQuestion(inputQuestion)}
              disabled={isLoading || !inputQuestion.trim()}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "4px",
                border: "none",
                backgroundColor: isLoading ? "#ccc" : "#0070f3",
                color: "white",
                cursor: isLoading ? "not-allowed" : "pointer"
              }}
            >
              {isLoading ? "Thinking..." : "Ask Question"}
            </button>
          </div>

          <div style={{ marginTop: "1.5rem" }}>
            <p><strong>Question:</strong> {agentState.question || "(none yet)"}</p>
            <p><strong>Answer:</strong> {agentState.answer || (isLoading ? "Thinking..." : "Waiting for question...")}</p>
          </div>
        </div>
      );
    }
```

      The `name` parameter must exactly match the agent name you defined in your CopilotRuntime configuration (e.g., `my_agent` from the quickstart).
    ### Give it a try!
    Now that we've organized state by purpose:
    - The UI can set `question` and read `answer`
    - The agent uses `resources` internally without exposing it to the frontend
    - State updates flow efficiently between frontend and backend

### Workflow Execution
- Route: `/llamaindex/shared-state/workflow-execution`
- Source: `docs/content/docs/integrations/llamaindex/shared-state/workflow-execution.mdx`
- Description: Decide which state properties are received and returned to the frontend.

## What is this?

Not all state properties are relevant for frontend-backend sharing.
This guide shows how to ensure only the right portion of state is communicated back and forth.

## When should I use this?

Depending on your implementation, some properties are meant to be processed internally, while some others are the way for the UI to communicate user input.
In addition, some state properties contain a lot of information. Syncing them back and forth between the agent and UI can be costly, while it might not have any practical benefit.

## Implementation

    ### Examine your state structure
    LlamaIndex agents using the AG-UI workflow router are stateful. As you execute tools and process messages, that state is updated and available throughout the session. For this example,
    let's assume that the state our agent should be using can be described like this:

```python title="agent.py"
    # Full state structure for the agent
    initial_state = {
        "question": "",         # Input from user
        "answer": "",           # Output to user
        "resources": []         # Internal use only
    }
```
    ### Organize state by purpose
    Our example case lists several state properties, each with its own purpose:
      - The **question** is being asked by the user, expecting the LLM to answer
      - The **answer** is what the LLM returns
      - The **resources** list will be used by the LLM to answer the question, and should not be communicated to the user, or set by them

    Here's a complete example showing how to structure your agent with these considerations:

```python title="agent.py"
    from typing import Annotated, List
    from fastapi import FastAPI
    from llama_index.llms.openai import OpenAI
    from llama_index.core.workflow import Context
    from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router
    from llama_index.protocols.ag_ui.events import StateSnapshotWorkflowEvent

    async def answerQuestion(
        ctx: Context,
        answer: Annotated[str, "The answer to store in state."]
    ) -> str:
        """Stores the answer to the user's question in shared state.

        Args:
            ctx: The workflow context for state management.
            answer: The answer to store in state.

        Returns:
            str: A message indicating the answer was stored.
        """
        async with ctx.store.edit_state() as global_state:
            state = global_state.get("state", {})
            if state is None:
                state = {}

            state["answer"] = answer

            # Emit state update to frontend
            ctx.write_event_to_stream(
                StateSnapshotWorkflowEvent(snapshot=state)
            )

            global_state["state"] = state

        return f"Answer stored: {answer}"

    async def addResource(
        ctx: Context,
        resource: Annotated[str, "The resource URL or reference to add."]
    ) -> str:
        """Adds a resource to the internal resources list in shared state.

        Args:
            ctx: The workflow context for state management.
            resource: The resource URL or reference to add.

        Returns:
            str: A message indicating the resource was added.
        """
        async with ctx.store.edit_state() as global_state:
            state = global_state.get("state", {})
            if state is None:
                state = {}

            resources = state.get("resources", [])
            resources.append(resource)
            state["resources"] = resources

            global_state["state"] = state

        return f"Resource added: {resource}"

    # Initialize the LLM
    llm = OpenAI(model="gpt-5.2")

    # Create the AG-UI workflow router
    agentic_chat_router = get_ag_ui_workflow_router(
        llm=llm,
        system_prompt="""
        You are a helpful assistant. When the user asks a question:
        1. Think through your answer
        2. Optionally use addResource to track any sources you reference
        3. Use answerQuestion to provide your final answer - this stores it in state for the user to see

        Always use the answerQuestion tool to provide your response so it appears in the UI.
        """,
        backend_tools=[answerQuestion, addResource],
        initial_state={
            "question": "",       # Input: received from frontend
            "answer": "",         # Output: sent to frontend
            "resources": []       # Internal: tracking resources
        },
    )

    # Create FastAPI app
    app = FastAPI(
        title="LlamaIndex Agent",
        description="A LlamaIndex agent integrated with CopilotKit",
        version="1.0.0"
    )

    # Include the router
    app.include_router(agentic_chat_router)

    # Health check endpoint
    @app.get("/health")
    async def health_check():
        return {"status": "healthy", "agent": "llamaindex"}

    if __name__ == "__main__":
        import uvicorn
        uvicorn.run(app, host="localhost", port=8000)
```
    ### Use the state in your frontend
    Now that we know which state properties our agent uses, we can work with them in the UI:
    - **question**: Set by the UI to ask the agent something
    - **answer**: Read from the agent's response
    - **resources**: Not accessible to the UI (internal agent use only)

```tsx title="ui/app/page.tsx"
    "use client";

    import { useState } from "react";
    import { useAgent } from "@copilotkit/react-core/v2";

    // Define the agent state type, should match the actual state of your agent
    type AgentState = {
      question: string;
      answer: string;
    }

    /* Example usage in a pseudo React component */
    function YourMainContent() { // [!code highlight]
      const [inputQuestion, setInputQuestion] = useState("What's the capital of France?");
      const [isLoading, setIsLoading] = useState(false);

      const { agentState, setAgentState, run } = useAgent<AgentState>({
        name: "my_agent",
        initialState: {
          question: "",
          answer: "",
        }
      });

      const askQuestion = async (newQuestion: string) => {
        setIsLoading(true);

        // Update the state with the new question
        setAgentState({ ...agentState, question: newQuestion, answer: "" });

        try {
          // Trigger the agent to run with a hint message that includes the question
          await run(() => ({
            id: crypto.randomUUID(),
            role: "user" as const,
            content: newQuestion,
          }));
        } catch (error) {
          console.error("Error running agent:", error);
        } finally {
          setIsLoading(false);
        }
      };

      return (
        <div style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
          <h1>Q&A Assistant</h1>

          <div style={{ marginBottom: "1rem" }}>
            <input
              type="text"
              value={inputQuestion}
              onChange={(e) => setInputQuestion(e.target.value)}
              placeholder="Enter your question..."
              style={{ 
                padding: "0.5rem", 
                width: "300px", 
                marginRight: "0.5rem",
                borderRadius: "4px",
                border: "1px solid #ccc"
              }}
            />
            <button 
              onClick={() => askQuestion(inputQuestion)}
              disabled={isLoading || !inputQuestion.trim()}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "4px",
                border: "none",
                backgroundColor: isLoading ? "#ccc" : "#0070f3",
                color: "white",
                cursor: isLoading ? "not-allowed" : "pointer"
              }}
            >
              {isLoading ? "Thinking..." : "Ask Question"}
            </button>
          </div>

          <div style={{ marginTop: "1.5rem" }}>
            <p><strong>Question:</strong> {agentState.question || "(none yet)"}</p>
            <p><strong>Answer:</strong> {agentState.answer || (isLoading ? "Thinking..." : "Waiting for question...")}</p>
          </div>
        </div>
      );
    }
```

      The `name` parameter must exactly match the agent name you defined in your CopilotRuntime configuration (e.g., `my_agent` from the quickstart).
    ### Give it a try!
    Now that we've organized state by purpose:
    - The UI can set `question` and read `answer`
    - The agent uses `resources` internally without exposing it to the frontend
    - State updates flow efficiently between frontend and backend
