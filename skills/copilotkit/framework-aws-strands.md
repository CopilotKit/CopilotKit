# AWS Strands Integration

CopilotKit implementation guide for AWS Strands.

> For shared CopilotKit concepts (runtime setup, prebuilt components, troubleshooting, etc.), see the topic guides. This file focuses on framework-specific implementation details.

## Guidance
### Frontend Tools
- Route: `/aws-strands/frontend-tools`
- Source: `docs/content/docs/integrations/aws-strands/frontend-tools.mdx`
- Description: Create frontend tools and use them within your Strands agent.

```python title="main.py"
        import os
        from strands import Agent, tool
        from strands.models.openai import OpenAIModel
        from ag_ui_strands import StrandsAgent, create_strands_app

        @tool
        def change_background(background: str):
            """
            Change the background color of the chat. Can be anything that CSS accepts.

            Args:
                background: The background color or gradient. Prefer gradients.

            Returns:
                None - execution happens on the frontend
            """
            # Return None - frontend will handle execution
            return None  # [!code highlight]

        api_key = os.getenv("OPENAI_API_KEY", "")
        model = OpenAIModel(
            client_args={"api_key": api_key},
            model_id="gpt-5.2",
        )

        agent = Agent(
            model=model,
            tools=[change_background],  # [!code highlight]
            system_prompt="You are a helpful assistant.",
        )

        agui_agent = StrandsAgent(
            agent=agent,
            name="my_agent",
            description="A helpful assistant",
        )

        app = create_strands_app(agui_agent, "/")
```
```tsx title="app/page.tsx"
        "use client";

        import { z } from "zod";
        import { useFrontendTool } from "@copilotkit/react-core/v2"; // [!code highlight]
        import { CopilotSidebar, CopilotKitCSSProperties } from "@copilotkit/react-core/v2";
        import { useState } from "react";

        export default function Page() {
          const [background, setBackground] = useState("#6366f1");

          // [!code highlight:12]
          useFrontendTool({
            name: "change_background",
            description: "Change the background color of the chat.",
            parameters: z.object({
              background: z.string().describe("The background color or gradient. Prefer gradients."),
            }),
            handler: async ({ background }) => {
              setBackground(background);
              return `Background changed to ${background}`;
            },
          });

          return (
            <main
              style={{
                background,
                transition: "background 0.3s ease",
              }}
              className="h-screen"
            >
              <CopilotSidebar />
            </main>
          );
        }
```
```
        Change the background to a sunset gradient
```
```
        Make the background dark purple
```
```tsx
"use client";

import { z } from "zod";
import { useFrontendTool } from "@copilotkit/react-core/v2";
import { useState } from "react";

export default function Page() {
  const [tasks, setTasks] = useState<string[]>([]);

  useFrontendTool({
    name: "add_task",
    description: "Add a task to the todo list",
    parameters: z.object({
      task: z.string().describe("The task to add"),
    }),
    handler: async ({ task }) => {
      setTasks((prev) => [...prev, task]);
      return `Added task: ${task}`;
    },
  });

  return (
    <div>
      <h1>Todo List</h1>
      <ul>
        {tasks.map((task, i) => (
          <li key={i}>{task}</li>
        ))}
      </ul>
    </div>
  );
}
```

### State Rendering
- Route: `/aws-strands/generative-ui/state-rendering`
- Source: `docs/content/docs/integrations/aws-strands/generative-ui/state-rendering.mdx`
- Description: Render the state of your agent with custom UI components.

```python title="agent/my_agent.py"
    from strands import Agent, Tool
    from typing import TypedDict, List

    # Define the agent state schema
    class SearchItem(TypedDict):
        query: str
        done: bool

    class AgentState(TypedDict):
        searches: List[SearchItem]

    # Create tool that updates state
    @Tool
    def add_search(query: str) -> dict:
        """
        Add a search to the agent's list of searches.

        Args:
            query: The search query to add

        Returns:
            Success status and query
        """
        # Tool implementation - state is automatically updated
        return {"success": True, "query": query}

    # Create agent with state management
    agent = Agent(
        name="searchAgent",
        description="A helpful assistant for storing searches",
        tools=[add_search],
        state_schema=AgentState,
        initial_state={"searches": []},
        instructions="""
        You are a helpful assistant for storing searches.

        IMPORTANT:
        - Use the add_search tool to add a search to the agent's state
        - ONLY USE THE add_search TOOL ONCE FOR A GIVEN QUERY
        """
    )
```
```tsx title="app/page.tsx"
    // ...
    import { useAgent } from "@copilotkit/react-core/v2";
    // ...

    // Define the state of the agent, should match the state schema of your Strands Agent.
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
        name: "searchAgent", // MUST match the agent name in your Strands configuration
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

    // Define the state of the agent, should match the state schema of your Strands Agent.
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
        name: "searchAgent", // MUST match the agent name in your Strands configuration
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
- Route: `/aws-strands/generative-ui/tool-rendering`
- Source: `docs/content/docs/integrations/aws-strands/generative-ui/tool-rendering.mdx`
- Description: Render your agent's tool calls with custom UI components.

```python title="main.py"
import os
from strands import Agent, tool
from strands.models.openai import OpenAIModel
from ag_ui_strands import StrandsAgent, create_strands_app

@tool
def get_weather(location: str) -> dict:
    """
    Get weather information for a location.

    Args:
        location: The location to get weather for

    Returns:
        Weather data with temperature and conditions
    """
    # Simulate weather data (in production, call a real weather API)
    return {
        "temperature": 72,
        "conditions": "sunny",
        "humidity": 45,
        "wind_speed": 8
    }

# Setup your Strands agent
api_key = os.getenv("OPENAI_API_KEY", "")
model = OpenAIModel(
    client_args={"api_key": api_key},
    model_id="gpt-5.2",
)

agent = Agent(
    model=model,
    system_prompt="You are a helpful assistant that can get weather information.",
    tools=[get_weather],  # [!code highlight]
)

# Wrap with AG-UI integration
agui_agent = StrandsAgent(
    agent=agent,
    name="weather_agent",
    description="A helpful weather assistant",
)

# Create the FastAPI app
app = create_strands_app(agui_agent, "/")
```
```tsx title="app/page.tsx"
"use client";

import { useRenderTool } from "@copilotkit/react-core/v2"; // [!code highlight]
import { CopilotSidebar } from "@copilotkit/react-core/v2";

export default function Page() {
  // [!code highlight:41]
  useRenderTool({
    name: "get_weather",
    parameters: [
      {
        name: "location",
        description: "The location to get weather for",
        required: true,
      },
    ],
    render: ({ status, args, result }) => {
      if (status === "executing") {
        return (
          <div className="p-4 bg-blue-50 rounded-lg">
            <p className="text-sm text-blue-600">
              Getting weather for {args.location}...
            </p>
          </div>
        );
      }

      if (status === "complete" && result) {
        const weather = result;
        return (
          <div className="p-4 bg-white border rounded-lg shadow-sm">
            <h3 className="font-semibold text-lg mb-2">
              Weather in {args.location}
            </h3>
            <div className="space-y-1 text-sm">
              <p>🌡️ Temperature: {weather.temperature}°F</p>
              <p>☁️ Conditions: {weather.conditions}</p>
              <p>💧 Humidity: {weather.humidity}%</p>
              <p>💨 Wind Speed: {weather.wind_speed} mph</p>
            </div>
          </div>
        );
      }

      return null;
    },
  });

  return (
    <main>
      <CopilotSidebar />
    </main>
  );
}
```
```
What's the weather in San Francisco?
```
```tsx
useRenderTool({
  name: "get_weather",
  parameters: [
    {
      name: "location",
      description: "The location to get weather for",
      required: true,
    },
  ],
  render: ({ status, args, result }) => {
    // args is available immediately, even when status is "executing"
    const location = args.location;

    return (
      <div className="p-4 bg-blue-50 rounded-lg">
        {status === "executing" && (
          <p>Fetching weather for {location}...</p>
        )}
        {status === "complete" && result && (
          <p>Weather in {location}: {result.temperature}°F</p>
        )}
      </div>
    );
  },
});
```

### Quickstart
- Route: `/aws-strands/quickstart`
- Source: `docs/content/docs/integrations/aws-strands/quickstart.mdx`
- Description: Turn your Strands agent into an agent-native application in 10 minutes.

## Prerequisites

Before you begin, you'll need the following:

- An OpenAI API key
- Node.js 20+
- Python 3.12+
- Your favorite package manager

## Getting started

                    You can either start fresh with our starter template or integrate CopilotKit into your existing Strands agent.
                ### Run our CLI

```bash
                npx copilotkit@latest create -f aws-strands-py
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

                  The starter template is configured to use OpenAI's GPT-4o by default, but you can modify it to use any language model supported by Strands.
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
                ### Install Strands with AG-UI

                Add Strands and the required packages to your project:

```bash
                uv add ag-ui-strands "strands-agents[OpenAI]" fastapi uvicorn
```
                ### Configure your environment

                Set your OpenAI API key as an environment variable:

```bash
                export OPENAI_API_KEY=your_openai_api_key
```

                  This example uses OpenAI's GPT-4o, but you can modify it to use any language model supported by Strands.
                ### Expose your agent via AG-UI

                Update your agent file to expose it as an AG-UI ASGI application:

```python title="main.py"
                import os

                from ag_ui_strands import StrandsAgent, create_strands_app
                from strands import Agent
                from strands.models.openai import OpenAIModel

                # Setup your Strands agent
                api_key = os.getenv("OPENAI_API_KEY", "")
                model = OpenAIModel(
                    client_args={"api_key": api_key},
                    model_id="gpt-5.2",
                )

                agent = Agent(
                    model=model,
                    system_prompt="You are a helpful AI assistant.",
                )

                # Wrap with AG-UI integration
                agui_agent = StrandsAgent(
                    agent=agent,
                    name="strands_agent",
                )

                # Create the FastAPI app
                app = create_strands_app(agui_agent, "/")

                if __name__ == "__main__":
                    import uvicorn

                    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

```

                  AG-UI is an open protocol for frontend-agent communication. The `create_strands_app` function creates an ASGI app that CopilotKit can connect to.
                ### Create your frontend

                CopilotKit works with any React-based frontend. We'll use Next.js for this example.

```bash
                npx create-next-app@latest frontend
                cd frontend
```
                ### Install CopilotKit packages

```npm
                npm install @copilotkit/react-ui @copilotkit/react-core @copilotkit/runtime @ag-ui/client
```
                ### Setup Copilot Runtime

                Create an API route to connect CopilotKit to your Strands agent:

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
                    strands_agent: new HttpAgent({ url: "http://localhost:8000" }),
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
                        <CopilotKit runtimeUrl="/api/copilotkit" agent="strands_agent">
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

        Your AI agent is now ready to use! Navigate to `localhost:3000` and try asking it some questions:

```
        What can you do?
```

```
        Please tell me a joke.
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

### Reading agent state
- Route: `/aws-strands/shared-state/in-app-agent-read`
- Source: `docs/content/docs/integrations/aws-strands/shared-state/in-app-agent-read.mdx`
- Description: Read the realtime agent state in your native application.

```python title="agent/my_agent.py"
    from strands import Agent
    from typing import TypedDict

    # 1. Define the agent state schema
    class AgentState(TypedDict):
        language: str  # "english" or "spanish"

    # 2. Create the agent with state
    agent = Agent(
        name="languageAgent",
        description="Always communicate in the preferred language of the user as defined in the state",
        state_schema=AgentState,
        initial_state={"language": "english"},
        instructions="Always communicate in the preferred language of the user as defined in your state. Do not communicate in any other language."
    )
```
```tsx title="ui/app/page.tsx"
    import { useAgent } from "@copilotkit/react-core/v2"; // [!code highlight]

    // Define the agent state type to match your Strands agent
    type AgentState = {
      language: "english" | "spanish";
    };

    function YourMainContent() {
      // [!code highlight:5]
      const { agent } = useAgent({
        name: "languageAgent",
        // optionally provide a type-safe initial state
        initialState: { language: "spanish" }
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
}

function YourMainContent() {
  // ...
  // [!code highlight:7]
  useAgent({
    name: "languageAgent",
    render: ({ state }) => {
      if (!state.language) return null;
      return <div>Language: {state.language}</div>;
    },
  });
  // ...
}
```

### Writing agent state
- Route: `/aws-strands/shared-state/in-app-agent-write`
- Source: `docs/content/docs/integrations/aws-strands/shared-state/in-app-agent-write.mdx`
- Description: Write to agent's state from your application.

```python title="agent/my_agent.py"
    from strands import Agent
    from typing import TypedDict

    # 1. Define the agent state schema
    class AgentState(TypedDict):
        language: str  # "english" or "spanish"

    # 2. Create the agent with state
    agent = Agent(
        name="languageAgent",
        description="Always communicate in the preferred language of the user as defined in the state",
        state_schema=AgentState,
        initial_state={"language": "english"},
        instructions="Always communicate in the preferred language of the user as defined in your state. Do not communicate in any other language."
    )
```
```tsx title="ui/app/page.tsx"
    import { useAgent } from "@copilotkit/react-core/v2"; // [!code highlight]

    // Define the agent state type to match your Strands agent
    type AgentState = {
      language: "english" | "spanish";
    };

    function YourMainContent() {
      // [!code highlight:5]
      const { agent } = useAgent({
        name: "languageAgent",
        // optionally provide a type-safe initial state
        initialState: { language: "spanish" }
      });

      const toggleLanguage = () => {
        agent.setState({ language: agent.state?.language === "english" ? "spanish" : "english" }); // [!code highlight]
      };

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
