# ADK Integration

CopilotKit implementation guide for ADK.

> For shared CopilotKit concepts (runtime setup, prebuilt components, troubleshooting, etc.), see the topic guides. This file focuses on framework-specific implementation details.

## Guidance
### Frontend Tools
- Route: `/adk/frontend-tools`
- Source: `docs/content/docs/integrations/adk/frontend-tools.mdx`
- Description: Create frontend tools and use them within your ADK agent.

```tsx title="page.tsx"
        import { useFrontendTool } from "@copilotkit/react-core/v2" // [!code highlight]

        export function Page() {
          // ...

          // [!code highlight:15]
          useFrontendTool({
            name: "sayHello",
            description: "Say hello to the user",
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
              return `Said hello to ${name}!`;
            },
          });

          // ...
        }
```

### State Rendering
- Route: `/adk/generative-ui/state-rendering`
- Source: `docs/content/docs/integrations/adk/generative-ui/state-rendering.mdx`
- Description: Render the state of your agent with custom UI components.

```python title="agent.py"
    import json
    from typing import Dict
    from fastapi import FastAPI
    from pydantic import BaseModel
    from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint
    from google.adk.agents import LlmAgent
    from google.adk.tools import ToolContext

    class AgentState(BaseModel):
        """State for the agent."""
        language: str = "english"

    def set_language(tool_context: ToolContext, new_language: str) -> Dict[str, str]:
        """Sets the language preference for the user.

        Args:
            tool_context (ToolContext): The tool context for accessing state.
            new_language (str): The language to save in state.

        Returns:
            Dict[str, str]: A dictionary indicating success status and message.
        """
        tool_context.state["language"] = new_language
        return {"status": "success", "message": f"Language set to {new_language}"}

    agent = LlmAgent(
        name="my_agent",
        model="gemini-2.5-flash",
        instruction="You are a helpful assistant that can change language settings.",
        tools=[set_language],
    )

    adk_agent = ADKAgent(
        adk_agent=agent,
        app_name="demo_app",
        user_id="demo_user",
        session_timeout_seconds=3600,
        use_in_memory_services=True,
    )

    app = FastAPI()
    add_adk_fastapi_endpoint(app, adk_agent, path="/")

    if __name__ == "__main__":
        import uvicorn
        uvicorn.run(app, host="0.0.0.0", port=8000)
```
```tsx title="app/page.tsx"
    // ...
    import { useAgent } from "@copilotkit/react-core/v2";
    // ...

    // Define the state of the agent, should match the state of your ADK Agent.
    type AgentState = {
      language: string;
    };

    function YourMainContent() {
      // ...

      // [!code highlight:13]
      // styles omitted for brevity
      useAgent<AgentState>({
        name: "my_agent", // MUST match the agent name in CopilotRuntime
        render: ({ agentState }) => (
          <div>
            Current language: {agentState.language || 'not set'}
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

    // Define the state of the agent, should match the state of your ADK Agent.
    type AgentState = {
      language: string;
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
            {/* [!code highlight:1] */}
            Current language: {agentState.language || 'not set'}
          </div>
        </div>
      )
    }
```

### Tool Rendering
- Route: `/adk/generative-ui/tool-rendering`
- Source: `docs/content/docs/integrations/adk/generative-ui/tool-rendering.mdx`
- Description: Render your agent's tool calls with custom UI components.

```python title="agent.py"
        from fastapi import FastAPI
        from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint
        from google.adk.agents import LlmAgent

        def get_weather(location: str = "the entire world") -> str:
            """Retrieves the current weather report for a specified location.

            Args:
                location (str): The name of the location to get the weather for.

            Returns:
                str: The weather report for the specified location.
            """
            return f"The weather in {location} is sunny."

        agent = LlmAgent(
            model="gemini-2.5-flash",
            name="my_agent",
            instruction="You are a helpful weather assistant.",
            tools=[get_weather],
        )

        adk_agent = ADKAgent(
            adk_agent=agent,
            app_name="weather_demo",
            user_id="demo_user"
        )

        app = FastAPI()
        add_adk_fastapi_endpoint(app, adk_agent, path="/")

        if __name__ == "__main__":
            import uvicorn
            uvicorn.run(app, host="0.0.0.0", port=8000)
```
```tsx title="app/page.tsx"
import { useRenderToolCall } from "@copilotkit/react-core/v2"; // [!code highlight]
// ...

const YourMainContent = () => {
  // ...
  // [!code highlight:12]
  useRenderToolCall({
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
- Route: `/adk/human-in-the-loop`
- Source: `docs/content/docs/integrations/adk/human-in-the-loop.mdx`
- Description: Create frontend tools and use them within your ADK agent for human-in-the-loop interactions.

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

### Quickstart
- Route: `/adk/quickstart`
- Source: `docs/content/docs/integrations/adk/quickstart.mdx`
- Description: Turn your ADK Agents into an agent-native application in 10 minutes.

## Prerequisites

Before you begin, you'll need the following:

- A Google Gemini API key
- Node.js 20+
- Python 3.9+
- Your favorite package manager

## Getting started

                    You can either start fresh with our starter template or integrate CopilotKit into your existing ADK agent.
                ### Run our CLI

```bash
                npx copilotkit@latest create -f adk
```
                ### Install dependencies

```npm
                npm install
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
                Set the theme to orange
```

```
                Write a proverb about AI
```

```
                Get the weather in SF
```

                        - If you're having connection issues, try using `0.0.0.0` or `127.0.0.1` instead of `localhost`
                        - Make sure your agent is running on port 8000
                        - Check that your Google API key is correctly set

                ### Initialize your agent project

                If you don't already have a Python project set up, create one using `uv`:

```bash
                uv init my-agent
                cd my-agent
```
                ### Install ADK with AG-UI

                Add ADK with AG-UI support and uvicorn to your project:

```bash
                uv add ag-ui-adk google-adk uvicorn fastapi
```

                  AG-UI is an open protocol for frontend-agent communication. The `ag-ui-adk` package provides ADK integration that CopilotKit can connect to.
                ### Configure your environment

                Set your Google API key as an environment variable:

```bash
                export GOOGLE_API_KEY=your_google_api_key
```

                  This example uses Gemini 2.5 Flash, but you can modify it to use any language model supported by ADK.
                ### Expose your agent via AG-UI

                Update your agent file to expose it as an AG-UI ASGI application:

```python title="main.py"
                from fastapi import FastAPI
                from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint
                from google.adk.agents import LlmAgent

                agent = LlmAgent(
                    name="assistant",
                    model="gemini-2.5-flash",
                    instruction="Be helpful and fun!"
                )

                adk_agent = ADKAgent(
                    adk_agent=agent,
                    app_name="demo_app",
                    user_id="demo_user",
                    session_timeout_seconds=3600,
                    use_in_memory_services=True
                )

                app = FastAPI()
                add_adk_fastapi_endpoint(app, adk_agent, path="/")

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
                npm install @copilotkit/react-ui @copilotkit/react-core @copilotkit/runtime @ag-ui/client
```
                ### Setup Copilot Runtime

                Create an API route to connect CopilotKit to your ADK agent:

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
                        - Check that your Google API key is correctly set
                        - Verify that the `@ag-ui/client` package is installed in your frontend

## What's next?

Now that you have your basic agent setup, explore these advanced features:

### Reading agent state
- Route: `/adk/shared-state/in-app-agent-read`
- Source: `docs/content/docs/integrations/adk/shared-state/in-app-agent-read.mdx`
- Description: Read the realtime agent state in your native application.

```python title="agent.py"
    from typing import Dict
    from fastapi import FastAPI
    from pydantic import BaseModel
    from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint
    from google.adk.agents import LlmAgent
    from google.adk.tools import ToolContext

    class AgentState(BaseModel):
        """State for the agent."""
        language: str = "english"

    def set_language(tool_context: ToolContext, new_language: str) -> Dict[str, str]:
        """Sets the language preference for the user.

        Args:
            tool_context (ToolContext): The tool context for accessing state.
            new_language (str): The language to save in state.

        Returns:
            Dict[str, str]: A dictionary indicating success status and message.
        """
        tool_context.state["language"] = new_language
        return {"status": "success", "message": f"Language set to {new_language}"}

    agent = LlmAgent(
        name="my_agent",
        model="gemini-2.5-flash",
        instruction="""
        You are a helpful assistant. Help users by answering their questions.
        Please use the language specified in state when responding to the user.
        You can set the language in state by using the set_language tool.
        """,
        tools=[set_language],
    )

    adk_agent = ADKAgent(
        adk_agent=agent,
        app_name="demo_app",
        user_id="demo_user",
        session_timeout_seconds=3600,
        use_in_memory_services=True,
    )

    app = FastAPI()
    add_adk_fastapi_endpoint(app, adk_agent, path="/")

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
- Route: `/adk/shared-state/in-app-agent-write`
- Source: `docs/content/docs/integrations/adk/shared-state/in-app-agent-write.mdx`
- Description: Write to agent's state from your application.

```python title="agent.py"
    from typing import Dict
    from fastapi import FastAPI
    from pydantic import BaseModel
    from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint
    from google.adk.agents import LlmAgent
    from google.adk.tools import ToolContext

    class AgentState(BaseModel):
        """State for the agent."""
        language: str = "english"

    def set_language(tool_context: ToolContext, new_language: str) -> Dict[str, str]:
        """Sets the language preference for the user.

        Args:
            tool_context (ToolContext): The tool context for accessing state.
            new_language (str): The language to save in state.

        Returns:
            Dict[str, str]: A dictionary indicating success status and message.
        """
        tool_context.state["language"] = new_language
        return {"status": "success", "message": f"Language set to {new_language}"}

    agent = LlmAgent(
        name="my_agent",
        model="gemini-2.5-flash",
        instruction="""
        You are a helpful assistant. Help users by answering their questions.
        Please use the language specified in state when responding to the user.
        You can set the language in state by using the set_language tool.
        """,
        tools=[set_language],
    )

    adk_agent = ADKAgent(
        adk_agent=agent,
        app_name="demo_app",
        user_id="demo_user",
        session_timeout_seconds=3600,
        use_in_memory_services=True,
    )

    app = FastAPI()
    add_adk_fastapi_endpoint(app, adk_agent, path="/")

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
- Route: `/adk/shared-state`
- Source: `docs/content/docs/integrations/adk/shared-state/index.mdx`
- Description: Create a two-way connection between your UI and agent state.

## What is shared state?

CoAgents maintain a shared state that seamlessly connects your UI with the agent's execution. This shared state system allows you to:

- Display the agent's current progress and intermediate results
- Update the agent's state through UI interactions
- React to state changes in real-time across your application

The foundation of this system is built on ADK's stateful architecture.

## When should I use this?

State streaming is perfect when you want to facilitate collaboration between your agent and the user. Any state that your ADK Agent
persists will be automatically shared by the UI. Similarly, any state that the user updates in the UI will be automatically reflected

This allows for a consistent experience where both the agent and the user are on the same page.

### Predictive state updates
- Route: `/adk/shared-state/predictive-state-updates`
- Source: `docs/content/docs/integrations/adk/shared-state/predictive-state-updates.mdx`
- Description: Stream in-progress agent state updates to the frontend.

{/* <IframeSwitcher

  This example demonstrates predictive state updates in the [CopilotKit Feature Viewer](https://feature-viewer.copilotkit.ai/adk-middleware/feature/predictive_state_updates).

## What is this?

An ADK agent's state updates discontinuously; only when state changes are explicitly made.
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
    from typing import Dict, List
    from fastapi import FastAPI
    from pydantic import BaseModel
    from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint
    from google.adk.agents import LlmAgent
    from google.adk.tools import ToolContext

    class AgentState(BaseModel):
        """State for the agent."""
        observed_steps: List[str] = []
```
    ### Emit the intermediate state

                    You can either manually emit state updates or configure specific tool calls to emit updates.
            For long-running tasks, you can create a tool that updates state and emits it to the frontend. In this example, we'll create a step progress tool that the LLM calls to report its progress.

```python title="agent.py"
            from typing import Dict, List
            from fastapi import FastAPI
            from pydantic import BaseModel
            from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint
            from google.adk.agents import LlmAgent
            from google.adk.tools import ToolContext

            class AgentState(BaseModel):
                """State for the agent."""
                observed_steps: List[str] = []

            def step_progress(tool_context: ToolContext, steps: List[str]) -> Dict[str, str]:
                """Reports the current progress steps.

                Args:
                    tool_context (ToolContext): The tool context for accessing state.
                    steps (List[str]): The list of steps completed so far.

                Returns:
                    Dict[str, str]: A dictionary indicating the progress was received.
                """
                tool_context.state["observed_steps"] = steps
                return {"status": "success", "message": "Progress received."}

            agent = LlmAgent(
                name="my_agent",
                model="gemini-2.5-flash",
                instruction="""
                You are a task performer. When given a task, break it down into steps
                and report your progress using the step_progress tool after completing each step.
                """,
                tools=[step_progress],
            )

            adk_agent = ADKAgent(
                adk_agent=agent,
                app_name="demo_app",
                user_id="demo_user",
                session_timeout_seconds=3600,
                use_in_memory_services=True,
            )

            app = FastAPI()
            add_adk_fastapi_endpoint(app, adk_agent, path="/")

            if __name__ == "__main__":
                import uvicorn
                uvicorn.run(app, host="0.0.0.0", port=8000)
```

              With this configuration, the agent emits state updates each time it calls the `step_progress` tool, giving the frontend real-time visibility into progress.
    ### Observe the predictions
    These predictions will be emitted as the agent runs, allowing you to track its progress before the final state is determined.

```tsx title="ui/app/page.tsx"
    "use client";

    import { useAgent } from "@copilotkit/react-core/v2";

    // ...
    type AgentState = {
        observed_steps: string[];
    };

    const YourMainContent = () => {
        // Get access to both predicted and final states
        const { agentState } = useAgent<AgentState>({ name: "my_agent" });

        // Add a state renderer to observe predictions
        useAgent<AgentState>({
            name: "my_agent",
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

      The `name` parameter must exactly match the agent name you defined in your CopilotRuntime configuration (e.g., `my_agent` from the quickstart).
    ### Give it a try!
    Now you'll notice that the state predictions are emitted as the agent makes progress, giving you insight into its work before the final state is determined.
    You can apply this pattern to any long-running task in your agent.

### Workflow Execution
- Route: `/adk/shared-state/state-inputs-outputs`
- Source: `docs/content/docs/integrations/adk/shared-state/state-inputs-outputs.mdx`
- Description: Decide which state properties are received and returned to the frontend.

## What is this?

Not all state properties are relevant for frontend-backend sharing.
This guide shows how to ensure only the right portion of state is communicated back and forth.

## When should I use this?

Depending on your implementation, some properties are meant to be processed internally, while some others are the way for the UI to communicate user input.
In addition, some state properties contain a lot of information. Syncing them back and forth between the agent and UI can be costly, while it might not have any practical benefit.

## Implementation

    ### Examine your state structure
    ADK agents are stateful. As you execute tools and callbacks, that state is updated and available throughout the session. For this example,
    let's assume that the state our agent should be using can be described like this:

```python title="agent.py"
    from typing import Dict, List
    from pydantic import BaseModel

    class AgentState(BaseModel):
        """Full state for the agent."""
        question: str = ""       # Input from user
        answer: str = ""         # Output to user
        resources: List[str] = []  # Internal use only
```
    ### Organize state by purpose
    Our example case lists several state properties, each with its own purpose:
      - The **question** is being asked by the user, expecting the LLM to answer
      - The **answer** is what the LLM returns
      - The **resources** list will be used by the LLM to answer the question, and should not be communicated to the user, or set by them

    Here's a complete example showing how to structure your agent with these considerations:

```python title="agent.py"
    from typing import Dict, List
    from fastapi import FastAPI
    from pydantic import BaseModel
    from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint
    from google.adk.agents import LlmAgent
    from google.adk.tools import ToolContext

    class AgentState(BaseModel):
        """State for the agent."""
        question: str = ""       # Input: received from frontend
        answer: str = ""         # Output: sent to frontend
        resources: List[str] = []  # Internal: not shared with frontend

    def answer_question(tool_context: ToolContext, answer: str) -> Dict[str, str]:
        """Stores the answer to the user's question.

        Args:
            tool_context (ToolContext): The tool context for accessing state.
            answer (str): The answer to store in state.

        Returns:
            Dict[str, str]: A dictionary indicating success status.
        """
        tool_context.state["answer"] = answer
        return {"status": "success", "message": "Answer stored."}

    def add_resource(tool_context: ToolContext, resource: str) -> Dict[str, str]:
        """Adds a resource to the internal resources list.

        Args:
            tool_context (ToolContext): The tool context for accessing state.
            resource (str): The resource URL or reference to add.

        Returns:
            Dict[str, str]: A dictionary indicating success status.
        """
        resources = tool_context.state.get("resources", [])
        resources.append(resource)
        tool_context.state["resources"] = resources
        return {"status": "success", "message": "Resource added."}

    agent = LlmAgent(
        name="my_agent",
        model="gemini-2.5-flash",
        instruction="""
        You are a helpful assistant. When answering questions:
        1. Use add_resource to track any sources you reference (internal use)
        2. Use answer_question to provide your final answer to the user

        The question from the user is available in state as 'question'.
        """,
        tools=[answer_question, add_resource],
    )

    adk_agent = ADKAgent(
        adk_agent=agent,
        app_name="demo_app",
        user_id="demo_user",
        session_timeout_seconds=3600,
        use_in_memory_services=True,
    )

    app = FastAPI()
    add_adk_fastapi_endpoint(app, adk_agent, path="/")

    if __name__ == "__main__":
        import uvicorn
        uvicorn.run(app, host="0.0.0.0", port=8000)
```
    ### Use the state in your frontend
    Now that we know which state properties our agent uses, we can work with them in the UI:
    - **question**: Set by the UI to ask the agent something
    - **answer**: Read from the agent's response
    - **resources**: Not accessible to the UI (internal agent use only)

```tsx title="ui/app/page.tsx"
    "use client";

    import { useAgent } from "@copilotkit/react-core/v2";

    // Only define the types for state you'll interact with
    type AgentState = {
      question: string;
      answer: string;
      // Note: 'resources' is intentionally omitted - it's internal to the agent
    }

    function YourMainContent() {
      const { agentState, setAgentState } = useAgent<AgentState>({
        name: "my_agent",
        initialState: {
          question: "How's the weather in SF?",
          answer: "",
        }
      });

      const askQuestion = (newQuestion: string) => {
        setAgentState({ ...agentState, question: newQuestion });
      };

      return (
        <div>
          <h1>Q&A Assistant</h1>
          <p><strong>Question:</strong> {agentState.question}</p>
          <p><strong>Answer:</strong> {agentState.answer || "Waiting for response..."}</p>
          <button onClick={() => askQuestion("What's the capital of France?")}>
            Ask New Question
          </button>
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
- Route: `/adk/shared-state/workflow-execution`
- Source: `docs/content/docs/integrations/adk/shared-state/workflow-execution.mdx`
- Description: Decide which state properties are received and returned to the frontend.

## What is this?

Not all state properties are relevant for frontend-backend sharing.
This guide shows how to ensure only the right portion of state is communicated back and forth.

## When should I use this?

Depending on your implementation, some properties are meant to be processed internally, while some others are the way for the UI to communicate user input.
In addition, some state properties contain a lot of information. Syncing them back and forth between the agent and UI can be costly, while it might not have any practical benefit.

## Implementation

    ### Examine your state structure
    ADK agents are stateful. As you execute tools and callbacks, that state is updated and available throughout the session. For this example,
    let's assume that the state our agent should be using can be described like this:

```python title="agent.py"
    from typing import Dict, List
    from pydantic import BaseModel

    class AgentState(BaseModel):
        """Full state for the agent."""
        question: str = ""       # Input from user
        answer: str = ""         # Output to user
        resources: List[str] = []  # Internal use only
```
    ### Organize state by purpose
    Our example case lists several state properties, each with its own purpose:
      - The **question** is being asked by the user, expecting the LLM to answer
      - The **answer** is what the LLM returns
      - The **resources** list will be used by the LLM to answer the question, and should not be communicated to the user, or set by them

    Here's a complete example showing how to structure your agent with these considerations:

```python title="agent.py"
    from typing import Dict, List
    from fastapi import FastAPI
    from pydantic import BaseModel
    from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint
    from google.adk.agents import LlmAgent
    from google.adk.tools import ToolContext

    class AgentState(BaseModel):
        """State for the agent."""
        question: str = ""       # Input: received from frontend
        answer: str = ""         # Output: sent to frontend
        resources: List[str] = []  # Internal: not shared with frontend

    def answer_question(tool_context: ToolContext, answer: str) -> Dict[str, str]:
        """Stores the answer to the user's question.

        Args:
            tool_context (ToolContext): The tool context for accessing state.
            answer (str): The answer to store in state.

        Returns:
            Dict[str, str]: A dictionary indicating success status.
        """
        tool_context.state["answer"] = answer
        return {"status": "success", "message": "Answer stored."}

    def add_resource(tool_context: ToolContext, resource: str) -> Dict[str, str]:
        """Adds a resource to the internal resources list.

        Args:
            tool_context (ToolContext): The tool context for accessing state.
            resource (str): The resource URL or reference to add.

        Returns:
            Dict[str, str]: A dictionary indicating success status.
        """
        resources = tool_context.state.get("resources", [])
        resources.append(resource)
        tool_context.state["resources"] = resources
        return {"status": "success", "message": "Resource added."}

    agent = LlmAgent(
        name="my_agent",
        model="gemini-2.5-flash",
        instruction="""
        You are a helpful assistant. When answering questions:
        1. Use add_resource to track any sources you reference (internal use)
        2. Use answer_question to provide your final answer to the user

        The question from the user is available in state as 'question'.
        """,
        tools=[answer_question, add_resource],
    )

    adk_agent = ADKAgent(
        adk_agent=agent,
        app_name="demo_app",
        user_id="demo_user",
        session_timeout_seconds=3600,
        use_in_memory_services=True,
    )

    app = FastAPI()
    add_adk_fastapi_endpoint(app, adk_agent, path="/")

    if __name__ == "__main__":
        import uvicorn
        uvicorn.run(app, host="0.0.0.0", port=8000)
```
    ### Use the state in your frontend
    Now that we know which state properties our agent uses, we can work with them in the UI:
    - **question**: Set by the UI to ask the agent something
    - **answer**: Read from the agent's response
    - **resources**: Not accessible to the UI (internal agent use only)

```tsx title="ui/app/page.tsx"
    "use client";

    import { useAgent } from "@copilotkit/react-core/v2";

    // Only define the types for state you'll interact with
    type AgentState = {
      question: string;
      answer: string;
      // Note: 'resources' is intentionally omitted - it's internal to the agent
    }

    function YourMainContent() {
      const { agentState, setAgentState } = useAgent<AgentState>({
        name: "my_agent",
        initialState: {
          question: "How's the weather in SF?",
          answer: "",
        }
      });

      const askQuestion = (newQuestion: string) => {
        setAgentState({ ...agentState, question: newQuestion });
      };

      return (
        <div>
          <h1>Q&A Assistant</h1>
          <p><strong>Question:</strong> {agentState.question}</p>
          <p><strong>Answer:</strong> {agentState.answer || "Waiting for response..."}</p>
          <button onClick={() => askQuestion("What's the capital of France?")}>
            Ask New Question
          </button>
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
