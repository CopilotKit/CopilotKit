# Agno Integration

CopilotKit implementation guide for Agno.

> For shared CopilotKit concepts (runtime setup, prebuilt components, troubleshooting, etc.), see the topic guides. This file focuses on framework-specific implementation details.

## Guidance
### Frontend Tools
- Route: `/agno/frontend-tools`
- Source: `docs/content/docs/integrations/agno/frontend-tools.mdx`
- Description: Create frontend tools and use them within your Agno agent.

```tsx title="page.tsx"
        import { z } from "zod";
        import { useFrontendTool } from "@copilotkit/react-core/v2" // [!code highlight]

        export function Page() {
          // ...

          {/* [!code highlight:12] */}
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
```python title="tools/frontend.py"
        from agno.tools import tool

        @tool(external_execution=True)
        def sayHello(name: str):
            """
            Say hello to the user.

            Args:
                name: The name of the user to say hello to
            """
```
```python title="agent.py"
        from agno.agent import Agent
        from agno.models.openai import OpenAIChat
        from agno.os import AgentOS
        from agno.os.interfaces.agui import AGUI
        from tools.frontend import sayHello

        agent = Agent(
            model=OpenAIChat(id="gpt-5.2"),
            tools=[sayHello],
            description="A helpful assistant that can answer questions and provide information.",
            instructions="Be helpful and friendly. Format your responses using markdown where appropriate.",
        )

        agent_os = AgentOS(agents=[agent], interfaces=[AGUI(agent=agent)])
        app = agent_os.get_app()
```

### Tool Rendering
- Route: `/agno/generative-ui/tool-rendering`
- Source: `docs/content/docs/integrations/agno/generative-ui/tool-rendering.mdx`
- Description: Render your agent's tool calls with custom UI components.

```python title="agent.py"
        from agno.agent import Agent
        from agno.models.openai import OpenAIChat
        from agno.tools import tool
        # ...

        # [!code highlight:6]
        @tool
        def get_weather(location: str):
            """
            Get the weather for a given location.
            """
            return f"The weather for {location} is 70 degrees."

        # ...

        agent = Agent(
            model=OpenAIChat(id="gpt-5.2"),
            tools=[get_weather], # [!code highlight]
            description="A helpful assistant that can answer questions and provide information.",
            instructions="Be helpful and friendly. Format your responses using markdown where appropriate.",
        )
```
```tsx title="app/page.tsx"
import { useRenderTool } from "@copilotkit/react-core/v2"; // [!code highlight]
// ...

const YourMainContent = () => {
  // ...
  {/* [!code highlight:12] */}
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
- Route: `/agno/human-in-the-loop`
- Source: `docs/content/docs/integrations/agno/human-in-the-loop.mdx`
- Description: Create frontend tools and use them within your Agno agent for human-in-the-loop interactions.

```python title="tools/frontend.py"
        from agno.tools import tool

        @tool(external_execution=True)
        def offerOptions(option_1: str, option_2: str):
            """
            Give the user a choice between two options and have them select one.

            Args:
                option_1: str: The first option
                option_2: str: The second option
            """
```
```python title="agent.py"
        from agno.agent import Agent
        from agno.models.openai import OpenAIChat
        from agno.os import AgentOS
        from agno.os.interfaces.agui import AGUI
        from tools.frontend import offerOptions

        agent = Agent(
            model=OpenAIChat(id="gpt-5.2"),
            tools=[offerOptions],
            description="A helpful assistant that can answer questions and provide information.",
            instructions="Be helpful and friendly. Format your responses using markdown where appropriate.",
        )

        agent_os = AgentOS(agents=[agent], interfaces=[AGUI(agent=agent)])
        app = agent_os.get_app()

        if __name__ == "__main__":
            agent_os.serve(app="main:app", port=8000, reload=True)
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
````

### Quickstart
- Route: `/agno/quickstart`
- Source: `docs/content/docs/integrations/agno/quickstart.mdx`
- Description: Turn your Agno agent into an agent-native application in 10 minutes.

## Prerequisites

Before you begin, you'll need the following:

- An OpenAI API key
- Node.js 20+
- Python 3.9+
- Your favorite package manager

## Getting started

                    You can either start fresh with our starter template or integrate CopilotKit into your existing Agno agent.
                ### Run our CLI

```bash
                npx copilotkit@latest create -f agno
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

                  The starter template is configured to use OpenAI's GPT-4o by default, but you can modify it to use any language model supported by Agno.
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
                ### Install Agno with AG-UI

                Add Agno and uvicorn to your project:

```bash
                uv add agno fastapi uvicorn openai ag-ui-protocol
```
                ### Configure your environment

                Set your OpenAI API key as an environment variable:

```bash
                export OPENAI_API_KEY=your_openai_api_key
```

                  This example uses OpenAI's GPT-4o, but you can modify it to use any language model supported by Agno.
                ### Expose your agent via AG-UI

                Update your agent file to expose it as an AG-UI ASGI application:

```python title="main.py"
                from agno.agent import Agent
                from agno.models.openai import OpenAIChat
                from agno.os import AgentOS
                from agno.os.interfaces.agui import AGUI

                agent = Agent(
                    model=OpenAIChat(id="gpt-5.2"),
                    description="A helpful assistant that can answer questions and provide information.",
                    instructions="Be helpful and friendly. Format your responses using markdown where appropriate.",
                )

                agent_os = AgentOS(agents=[agent], interfaces=[AGUI(agent=agent)])
                app = agent_os.get_app()

                if __name__ == "__main__":
                    agent_os.serve(app="main:app", port=8000, reload=True)
```

                  AG-UI is an open protocol for frontend-agent communication. AgentOS with the AGUI interface creates an ASGI app that CopilotKit can connect to.
                ### Create your frontend

                CopilotKit works with any React-based frontend. We'll use Next.js for this example.

```bash
                npx create-next-app@latest my-copilot-app
                cd my-copilot-app
```
                ### Install CopilotKit packages

```npm
                npm install @copilotkit/react-ui @copilotkit/react-core @copilotkit/runtime @ag-ui/agno
```
                ### Setup Copilot Runtime

                Create an API route to connect CopilotKit to your Agno agent:

```tsx title="app/api/copilotkit/route.ts"
                import {
                  CopilotRuntime,
                  ExperimentalEmptyAdapter,
                  copilotRuntimeNextJSAppRouterEndpoint,
                } from "@copilotkit/runtime";
                import { AgnoAgent } from "@ag-ui/agno";
                import { NextRequest } from "next/server";

                const serviceAdapter = new ExperimentalEmptyAdapter();

                const runtime = new CopilotRuntime({
                  agents: {
                    my_agent: new AgnoAgent({ url: "http://localhost:8000/agui" }),
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

                Your agent will be available at `http://localhost:8000/agui`.
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
