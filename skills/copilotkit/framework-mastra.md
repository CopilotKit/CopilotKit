# Mastra Integration

CopilotKit implementation guide for Mastra.

> For shared CopilotKit concepts (runtime setup, prebuilt components, troubleshooting, etc.), see the topic guides. This file focuses on framework-specific implementation details.

## Guidance
### Readables
- Route: `/mastra/agent-app-context`
- Source: `docs/content/docs/integrations/mastra/agent-app-context.mdx`
- Description: Share app specific context with your agent.

## What is this?

One of the most common use cases for CopilotKit is to register app state and context using `useCopilotReadble`.
This way, you can notify your agent of what is going in your app in real time.

## When should I use this?

You can use this when you want to provide the user with feedback about what your working memory. As your agent's
state updates, you can reflect these updates natively in your application.

Some examples might be: the current user, the current page, etc. This be shared with your agent in real time.

## Implementation
        ### Wrap your data in a readable

        The [`useCopilotReadable` hook](/reference/v1/hooks/useCopilotReadable) is used to add data as context to the Copilot.

```tsx title="YourComponent.tsx" showLineNumbers {1, 7-10}
        "use client" // only necessary if you are using Next.js with the App Router. // [!code highlight]
        import { useCopilotReadable } from "@copilotkit/react-core/v2"; // [!code highlight]
        import { useState } from 'react';

        export function YourComponent() {
            // Create colleagues state with some sample data
            const [colleagues, setColleagues] = useState([
                { id: 1, name: "John Doe", role: "Developer" },
                { id: 2, name: "Jane Smith", role: "Designer" },
                { id: 3, name: "Bob Wilson", role: "Product Manager" }
            ]);

            // Define Copilot readable state
            // [!code highlight:4]
            useCopilotReadable({
                description: "The current user's colleagues",
                value: colleagues,
            });
            return (
                // Your custom UI component
                <>...</>
            );
        }
```

        ### Consume the data in your Mastra agent

        Mastra has `RuntimeContext` class that can be used to set and access the extra context at run time.
        The context from CopilotKit is automatically injected there, and can be used immediately.
        You can read more about it [here](https://mastra.ai/en/docs/agents/runtime-context)

```tsx title="agent.ts"
        export const colleaguesContactorAgent = new Agent({
            name: "Colleagues contact Agent",
            model: openai("gpt-5.2"),
            // Use the injected runtime context
            // [!code highlight:9]
            instructions: ({ runtimeContext }) => {
              // AG-UI context is an array of items, the specific context can be grabbed by filtering
              const aguiContext = runtimeContext.get('ag-ui')?.context
              const colleaguesContextItem = aguiContext.find(contextItem => contextItem.description === 'The current user\'s colleagues"')
              return `
                You are a helpful assistant that can help emailing colleagues.
                The user's colleagues are: ${colleaguesContextItem.value}
              `
            },
            // ... Everything else used to configure your agent
        });
```
        ### Give it a try!
        Ask your agent a question about the context. It should be able to answer!

### Frontend Tools
- Route: `/mastra/frontend-tools`
- Source: `docs/content/docs/integrations/mastra/frontend-tools.mdx`
- Description: Create frontend tools and use them within your Mastra agent.

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
- Route: `/mastra/generative-ui/state-rendering`
- Source: `docs/content/docs/integrations/mastra/generative-ui/state-rendering.mdx`
- Description: Render the state of your agent with custom UI components.

```ts title="src/mastra/agents/index.ts"
    import { openai } from "@ai-sdk/openai";
    import { Agent } from "@mastra/core/agent";
    import { LibSQLStore } from "@mastra/libsql";
    import { z } from "zod";
    import { Memory } from "@mastra/memory";
    import { createTool } from "@mastra/core/tools";

    // Define the agent state schema
    const AgentStateSchema = z.object({
      searches: z.array(
        z.object({
          query: z.string(),
          done: z.boolean(),
        })
      ).default([]),
    });

    export type AgentState = z.infer<typeof AgentStateSchema>;

    // Create tools that update working memory
    const addSearch = createTool({
      id: "addSearch",
      inputSchema: z.object({
        query: z.string(),
      }),
      description: "Add a search to the agent's list of searches",
      execute: async ({ context: { query } }) => {
        // Tool implementation - working memory is automatically updated
        return { success: true, query };
      },
    });

    export const searchAgent = new Agent({
      name: "Search Agent",
      model: openai("gpt-5.2"),
      instructions: `
        You are a helpful assistant for storing searches.

        IMPORTANT:
        - Use the addSearch tool to add a search to the agent's state
        - ONLY USE THE addSearch TOOL ONCE FOR A GIVEN QUERY
      `,
      tools: {
        addSearch,
      },
      memory: new Memory({
        storage: new LibSQLStore({ url: "file::memory:" }),
        options: {
          workingMemory: {
            enabled: true,
            schema: AgentStateSchema,
          },
        },
      }),
    });
```
```tsx title="app/page.tsx"
    // ...
    import { useAgent } from "@copilotkit/react-core/v2";
    // ...

    // Define the state of the agent, should match the working memory of your Mastra Agent.
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
        name: "searchAgent", // MUST match the agent name in your Mastra instance
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

    // Define the state of the agent, should match the working memory of your Mastra Agent.
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
        name: "searchAgent", // MUST match the agent name in your Mastra instance
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
- Route: `/mastra/generative-ui/tool-rendering`
- Source: `docs/content/docs/integrations/mastra/generative-ui/tool-rendering.mdx`
- Description: Render your agent's tool calls with custom UI components.

```ts title="src/mastra/tools/weatherInfo.ts"
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const weatherInfo = createTool({
  id: "weatherInfo",
  inputSchema: z.object({
    location: z.string(),
  }),
  description: `Fetches the current weather information for a given location`,
  execute: async ({ context: { location } }) => {
    // Tool logic here (e.g., API call)
    console.log("Using tool to fetch weather information for", location);
    return { temperature: 20, conditions: "Sunny" }; // Example return
  },
});
```
```ts title="src/mastra/agents/weatherAgent.ts"
import { Agent } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";
import { weatherInfo } from "../tools/weatherInfo";

export const weatherAgent = new Agent({
  name: "Weather Agent",
  instructions:
    "You are a helpful assistant that provides current weather information. When asked about the weather, use the weather information tool to fetch the data.",
  model: openai("gpt-5.2-mini"),
  tools: {
    weatherInfo,
  },
});
```
```tsx title="app/page.tsx"
import { useRenderToolCall } from "@copilotkit/react-core/v2"; // [!code highlight]
// ...

const YourMainContent = () => {
  // ...
  // [!code highlight:12]
  useRenderToolCall({
    name: "weatherInfo",
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

### Human-in-the-Loop
- Route: `/mastra/human-in-the-loop`
- Source: `docs/content/docs/integrations/mastra/human-in-the-loop.mdx`
- Description: Learn how to implement Human-in-the-Loop (HITL) using Mastra Agents.

```tsx title="ui/app/page.tsx"
    import { useHumanInTheLoop } from "@copilotkit/react-core/v2" // [!code highlight]

    function YourMainContent() {
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
    Can you show me two good options for a restaurant name?"
```

### Quickstart
- Route: `/mastra/quickstart`
- Source: `docs/content/docs/integrations/mastra/quickstart.mdx`
- Description: Turn your Mastra Agents into an agent-native application in 10 minutes.

## Prerequisites

Before you begin, you'll need the following:

- An OpenAI API key
- Node.js 20+
- Your favorite package manager

## Getting started

                    You can either start fresh with our starter template or integrate CopilotKit into your existing Mastra Agent.
                ### Run our CLI

                First, we'll use our CLI to create a new project for us.

```bash
                npx copilotkit@latest create -f mastra
```
                ### Install dependencies

```npm
                npm install
```
                ### Configure your environment

                Create a `.env` file and add your OpenAI API key:

```plaintext title=".env"
                OPENAI_API_KEY=your_openai_api_key
```

                  The starter template is configured to use OpenAI's GPT-4o by default, but you can modify it to use any language model supported by Mastra.
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
                ### Initialize your Mastra project

                If you don't already have a Mastra project set up, create one:

```bash
                npx create-mastra@latest my-agent
                cd my-agent
```
                ### Create your Mastra agent

                Create a new agent file in your Mastra project:

```ts title="src/mastra/agents/index.ts"
                import { openai } from "@ai-sdk/openai";
                import { Agent } from "@mastra/core/agent";

                export const myAgent = new Agent({
                  name: "My Agent",
                  instructions: "You are a helpful assistant!",
                  model: openai("gpt-5.2"),
                });
```

                Then export it from your Mastra instance:

```ts title="src/mastra/index.ts"
                import { Mastra } from "@mastra/core";
                import { myAgent } from "./agents";

                export const mastra = new Mastra({
                  agents: { myAgent },
                });
```

                  This example uses OpenAI's GPT-4o, but you can modify it to use any language model supported by Mastra.
                ### Configure your environment

                Set your OpenAI API key as an environment variable:

```bash
                export OPENAI_API_KEY=your_openai_api_key
```
                ### Create your frontend

                CopilotKit works with any React-based frontend. We'll use Next.js for this example.

```bash
                npx create-next-app@latest my-copilot-app
                cd my-copilot-app
```
                ### Install CopilotKit packages

```npm
                npm install @copilotkit/react-ui @copilotkit/react-core @copilotkit/runtime @ag-ui/mastra @ag-ui/core @ag-ui/client @mastra/client-js
```
                ### Setup Copilot Runtime

                Create an API route to connect CopilotKit to your Mastra agent:

```ts title="app/api/copilotkit/route.ts"
                import {
                  CopilotRuntime,
                  ExperimentalEmptyAdapter,
                  copilotRuntimeNextJSAppRouterEndpoint,
                } from "@copilotkit/runtime";
                import { NextRequest } from "next/server";
                import { MastraAgent } from "@ag-ui/mastra"
                import { mastra } from "@/mastra"; // the path to your Mastra instance

                const serviceAdapter = new ExperimentalEmptyAdapter();

                const runtime = new CopilotRuntime({
                  agents: MastraAgent.getLocalAgents({ mastra }),
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
                        <CopilotKit runtimeUrl="/api/copilotkit" agent="myAgent">
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
                ### Start your UI

                Start the development server:

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
        ### 🎉 Start chatting!

        Your AI agent is now ready to use! Try asking it some questions:

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
                - Make sure your Mastra agent is running on port 4111
                - Check that your OpenAI API key is correctly set in the `.env` file

## What's next?

Now that you have your basic agent setup, explore these advanced features:

### Reading agent state
- Route: `/mastra/shared-state/in-app-agent-read`
- Source: `docs/content/docs/integrations/mastra/shared-state/in-app-agent-read.mdx`
- Description: Read the realtime agent state in your native application.

```ts
  const runtime = new CopilotRuntime({
    agents: MastraAgent.getLocalAgents({ mastra }),
  });
```
```ts title="mastra/agents/language-agent.ts"
    import { openai } from "@ai-sdk/openai";
    import { Agent } from "@mastra/core/agent";
    import { LibSQLStore } from "@mastra/libsql";
    import { z } from "zod";
    import { Memory } from "@mastra/memory";

    // [!code highlight:4]
    // 1. Define the agent state schema
    export const AgentStateSchema = z.object({
      language: z.enum(["english", "spanish"]),
    });

    // 2. Infer the agent state type from the schema
    export const AgentState = z.infer<typeof AgentStateSchema>;

    // 3. Create the agent
    export const languageAgent = new Agent({
      name: "Language Agent",
      model: openai("gpt-5.2"),
      instructions: "Always communicate in the preferred language of the user as defined in your working memory. Do not communicate in any other language.",
      memory: new Memory({
        storage: new LibSQLStore({ url: "file::memory:" }),
        options: {
          // [!code highlight:4]
          workingMemory: {
            enabled: true,
            schema: AgentStateSchema,
          },
        },
      }),
    });
```
```tsx title="ui/app/page.tsx"
    import { useAgent } from "@copilotkit/react-core/v2"; // [!code highlight]
    import { AgentState } from "@/mastra/agents/language-agent";

    function YourMainContent() {
      // [!code highlight:5]
      const { agentState } = useAgent<AgentState>({
        name: "your-mastra-agent-name",
        // optionally provide a type-safe initial state
        initialState: { language: "english" }
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
}

function YourMainContent() {
  // ...
  // [!code highlight:7]
  useAgent<AgentState>({
    name: "your-mastra-agent-name",
    render: ({ agentState }) => {
      if (!agentState.language) return null;
      return <div>Language: {agentState.language}</div>;
    },
  });
  // ...
}
```

### Writing agent state
- Route: `/mastra/shared-state/in-app-agent-write`
- Source: `docs/content/docs/integrations/mastra/shared-state/in-app-agent-write.mdx`
- Description: Write to agent's state from your application.

```ts
  const runtime = new CopilotRuntime({
    agents: MastraAgent.getLocalAgents({ mastra }),
  });
```
```ts title="mastra/agents/language-agent.ts"
    import { openai } from "@ai-sdk/openai";
    import { Agent } from "@mastra/core/agent";
    import { LibSQLStore } from "@mastra/libsql";
    import { z } from "zod";
    import { Memory } from "@mastra/memory";

    // [!code highlight:4]
    // 1. Define the agent state schema
    export const AgentStateSchema = z.object({
      language: z.enum(["english", "spanish"]),
    });

    // 2. Infer the agent state type from the schema
    export const AgentState = z.infer<typeof AgentStateSchema>;

    // 3. Create the agent
    export const languageAgent = new Agent({
      name: "Language Agent",
      model: openai("gpt-5.2"),
      instructions: "Always communicate in the preferred language of the user as defined in your working memory. Do not communicate in any other language.",
      memory: new Memory({
        storage: new LibSQLStore({ url: "file::memory:" }),
        options: {
          // [!code highlight:4]
          workingMemory: {
            enabled: true,
            schema: AgentStateSchema,
          },
        },
      }),
    });
```
```tsx title="ui/app/page.tsx"
    import { useAgent } from "@copilotkit/react-core/v2"; // [!code highlight]
    import { AgentState } from "@/mastra/agents/language-agent";

    function YourMainContent() {
      // [!code highlight:5]
      const { agentState, setAgentState } = useAgent<AgentState>({
        name: "your-mastra-agent-name",
        // optionally provide a type-safe initial state
        initialState: { language: "english" }
      });

      const toggleLanguage = () => {
        setAgentState({ language: agentState.language === "english" ? "spanish" : "english" }); // [!code highlight]
      };

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

### Shared State
- Route: `/mastra/shared-state`
- Source: `docs/content/docs/integrations/mastra/shared-state/index.mdx`
- Description: Create a two-way connection between your UI and Mastra agent state.

The foundation of this system is built on Mastra's stateful architecture via AG-UI. Mastra agents can maintain their
internal state throughout execution, which you can access via the `useCoAgentState` hook.

## When should I use this?
State streaming is perfect when you want to faciliate collaboration between your agent and the user. Any state that your Mastra agent
persists will be automatically shared by the UI. Similarly, any state that the user updates in the UI will be automatically reflected.

This allows for a consistent experience where both the agent and the user are on the same page.
