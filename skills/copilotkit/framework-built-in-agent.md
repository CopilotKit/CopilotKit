# Built In Agent Integration

CopilotKit implementation guide for Built In Agent.

> For shared CopilotKit concepts (runtime setup, prebuilt components, troubleshooting, etc.), see the topic guides. This file focuses on framework-specific implementation details.

## Guidance
### Advanced Configuration
- Route: `/built-in-agent/advanced-configuration`
- Source: `docs/content/docs/integrations/built-in-agent/advanced-configuration.mdx`
- Description: Fine-tune your Built-in Agent's behavior with advanced options.

The `BuiltInAgent` accepts a full set of configuration options to control model behavior, tool calling, and more.

## Multi-step tool calling

By default, the agent performs a single generation step. Set `maxSteps` to allow the agent to call tools and then continue reasoning:

```typescript title="src/copilotkit.ts"
const agent = new BuiltInAgent({
  model: "openai:gpt-5.2",
  maxSteps: 5, // [!code highlight]
  tools: [searchDocs, createTicket],
});
```

With `maxSteps: 5`, the agent can call a tool, process the result, call another tool, and so on — up to 5 iterations. This is essential for workflows where the agent needs to chain multiple tool calls.

## Tool choice

Control how the agent selects tools:

```typescript
const agent = new BuiltInAgent({
  model: "openai:gpt-5.2",
  toolChoice: "auto",       // Let the model decide (default)
  // toolChoice: "required", // Force the model to call a tool
  // toolChoice: "none",     // Disable tool calling
  // toolChoice: { type: "tool", toolName: "searchDocs" }, // Force a specific tool
});
```

## System prompt

Customize the agent's system prompt:

```typescript
const agent = new BuiltInAgent({
  model: "openai:gpt-5.2",
  prompt: "You are a customer support agent for Acme Corp. Be concise and helpful. Always check the knowledge base before answering.", // [!code highlight]
});
```

## Generation parameters

Fine-tune the model's output:

```typescript
const agent = new BuiltInAgent({
  model: "openai:gpt-5.2",
  temperature: 0.7,        // Creativity (0 = deterministic, 1+ = creative)
  topP: 0.9,               // Nucleus sampling
  topK: 40,                // Top-K sampling (provider-dependent)
  maxOutputTokens: 4096,   // Maximum tokens in the response
  presencePenalty: 0.1,    // Penalize repeated topics
  frequencyPenalty: 0.1,   // Penalize repeated tokens
  stopSequences: ["END"],  // Stop generation at these sequences
  seed: 42,                // Deterministic output (provider-dependent)
  maxRetries: 3,           // Retry on transient failures
});
```

Not all parameters are supported by every provider. For example, `topK` is supported by Google but not OpenAI. Unsupported parameters are ignored.

## Provider-specific options

Pass options specific to a model provider using `providerOptions`:

```typescript
// OpenAI reasoning models (o3, o4-mini) with reasoning effort
const agent = new BuiltInAgent({
  model: "openai:o3",
  providerOptions: { // [!code highlight:3]
    openai: { reasoningEffort: "high" },
  },
});
```

```typescript
// Anthropic with extended thinking
const agent = new BuiltInAgent({
  model: "anthropic:claude-sonnet-4.5",
  providerOptions: { // [!code highlight:3]
    anthropic: { thinking: { type: "enabled", budgetTokens: 10000 } },
  },
});
```

## Overridable properties

Allow the frontend to override specific configuration at runtime. This is useful when you want users to switch models or adjust behavior without redeploying:

```typescript
const agent = new BuiltInAgent({
  model: "openai:gpt-5.2",
  temperature: 0.5,
  overridableProperties: ["model", "temperature", "prompt"], // [!code highlight]
});
```

The full list of overridable properties:
`model`, `toolChoice`, `maxOutputTokens`, `temperature`, `topP`, `topK`, `presencePenalty`, `frequencyPenalty`, `stopSequences`, `seed`, `maxRetries`, `prompt`, `providerOptions`

## Message forwarding

Control whether system and developer messages from the conversation are forwarded to the LLM:

```typescript
const agent = new BuiltInAgent({
  model: "openai:gpt-5.2",
  forwardSystemMessages: true,    // Forward system-role messages
  forwardDeveloperMessages: true, // Forward developer-role messages (as system messages)
});
```

## Full configuration reference

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `model` | `string \| LanguageModel` | — | Model specifier or AI SDK instance |
| `apiKey` | `string` | env var | API key for the provider |
| `maxSteps` | `number` | `1` | Max tool-calling iterations |
| `toolChoice` | `"auto" \| "required" \| "none" \| { type: "tool", toolName: string }` | `"auto"` | How tools are selected |
| `maxOutputTokens` | `number` | — | Max tokens in response |
| `temperature` | `number` | — | Sampling temperature |
| `topP` | `number` | — | Nucleus sampling |
| `topK` | `number` | — | Top-K sampling |
| `presencePenalty` | `number` | — | Presence penalty |
| `frequencyPenalty` | `number` | — | Frequency penalty |
| `stopSequences` | `string[]` | — | Stop sequences |
| `seed` | `number` | — | Random seed |
| `maxRetries` | `number` | — | Retry count |
| `prompt` | `string` | — | System prompt |
| `tools` | `ToolDefinition[]` | `[]` | Server-side tools |
| `mcpServers` | `MCPClientConfig[]` | `[]` | MCP server connections |
| `overridableProperties` | `string[]` | `[]` | Properties the frontend can override |
| `providerOptions` | `Record` | — | Provider-specific options |
| `forwardSystemMessages` | `boolean` | `false` | Forward system messages |
| `forwardDeveloperMessages` | `boolean` | `false` | Forward developer messages |

### Agent Context
- Route: `/built-in-agent/agent-app-context`
- Source: `docs/content/docs/integrations/built-in-agent/agent-app-context.mdx`
- Description: Share app-specific context with your Built-in Agent.

Share your application's state and context with the Built-in Agent using the `useAgentContext` hook. The agent automatically receives this context — no backend configuration needed.

## What is this?

The `useAgentContext` hook lets you register app-specific data that gets included in the agent's context. This could be the current user, page content, shopping cart items, or any data that helps the agent provide relevant responses.

## When should I use this?

- You want the agent to know about the current state of your app
- You need the agent to reference user-specific data (name, preferences, role)
- The agent should be aware of what page or view the user is on
- You want to provide domain-specific data without hardcoding it into the system prompt

## Implementation

### Register context in your component

Use `useAgentContext` to share any data with the agent:

```tsx title="components/Dashboard.tsx"
"use client"; // only necessary for Next.js App Router // [!code highlight]
import { useAgentContext } from "@copilotkit/react-core/v2"; // [!code highlight]
import { useState } from "react";

export function Dashboard() {
  const [user] = useState({
    name: "Jane Smith",
    role: "Engineering Manager",
    team: "Platform",
  });

  const [projects] = useState([
    { id: 1, name: "Auth Redesign", status: "in-progress" },
    { id: 2, name: "API v2", status: "planning" },
  ]);

  // Share user info with the agent
  // [!code highlight:4]
  useAgentContext({
    description: "The currently logged-in user",
    value: user,
  });

  // Share project data with the agent
  // [!code highlight:4]
  useAgentContext({
    description: "The user's active projects",
    value: projects,
  });

  return <div>{/* Your dashboard UI */}</div>;
}
```

### That's it — no backend setup needed

Unlike LangGraph where you need to configure agent state to receive context, the Built-in Agent handles this automatically. The context you register is included in the agent's system prompt, so it can reference your app data immediately.

```
User: "What projects am I working on?"
Agent: "You're working on two projects:
  1. Auth Redesign (in progress)
  2. API v2 (planning)"
```

## Multiple contexts

You can call `useAgentContext` multiple times across different components. All registered contexts are combined and sent to the agent:

```tsx title="components/UserInfo.tsx"
useAgentContext({
  description: "Current user profile",
  value: { name: "Jane", role: "Manager" },
});
```

```tsx title="components/PageContext.tsx"
useAgentContext({
  description: "The page the user is currently viewing",
  value: { page: "settings", section: "notifications" },
});
```

The agent sees both contexts and can reference either when responding.

## Dynamic context

Context updates automatically when the underlying data changes:

```tsx
export function TaskList() {
  const [tasks, setTasks] = useState([]);

  // Context updates whenever tasks change // [!code highlight]
  useAgentContext({
    description: "The user's current task list",
    value: tasks,
  });

  return (
    <div>
      {/* When tasks are added/removed, the agent sees the updated list */}
    </div>
  );
}
```

### Overview
- Route: `/built-in-agent`
- Source: `docs/content/docs/integrations/built-in-agent/index.mdx`
- Description: Use CopilotKit's built-in agent with any model.

The **Built-in Agent** is CopilotKit's simplest agent option, i.e what you get "built-in". It connects directly to an LLM with full support for tools, generative UI, shared state, and all CopilotKit features — without requiring an external agent framework.

It supports most popular models from OpenAI, Anthropic, Google, and AI-SDK defined models out of the box

## When to use Built-in Agent

- **Quick setup** — no external agent framework to configure or deploy
- **Chat + tools** — your use case is primarily conversational with frontend and server tools
- **Direct model access** — you want to use OpenAI, Anthropic, Google, or AI-SDK models directly

If you need more control over your agent loop, consider using an [agent framework](/#explore-by-ai-backend) instead.

## Features

## Getting Started

Head to the [Quickstart](/built-in-agent/quickstart) to set up a working Built-in Agent in minutes.

### Model Selection
- Route: `/built-in-agent/model-selection`
- Source: `docs/content/docs/integrations/built-in-agent/model-selection.mdx`
- Description: Choose and configure models for your Built-in Agent.

The Built-in Agent uses the [Vercel AI SDK](https://sdk.vercel.ai) under the hood, giving you access to models from OpenAI, Anthropic, and Google — plus the ability to use any custom AI SDK model.

## Supported Models

Specify a model using the `"provider:model"` format (or `"provider/model"` — both work).

### OpenAI

| Model | Specifier |
|-------|-----------|
| GPT-5 | `openai:gpt-5` |
| GPT-5 Mini | `openai:gpt-5-mini` |
| GPT-4.1 | `openai:gpt-4.1` |
| GPT-4.1 Mini | `openai:gpt-4.1-mini` |
| GPT-4.1 Nano | `openai:gpt-4.1-nano` |
| GPT-4o | `openai:gpt-5.2` |
| GPT-4o Mini | `openai:gpt-5.2-mini` |
| o3 | `openai:o3` |
| o3-mini | `openai:o3-mini` |
| o4-mini | `openai:o4-mini` |

```typescript
const agent = new BuiltInAgent({
  model: "openai:gpt-4.1",
});
```

### Anthropic

| Model | Specifier |
|-------|-----------|
| Claude Sonnet 4.5 | `anthropic:claude-sonnet-4.5` |
| Claude Sonnet 4 | `anthropic:claude-sonnet-4` |
| Claude 3.7 Sonnet | `anthropic:claude-3.7-sonnet` |
| Claude Opus 4.1 | `anthropic:claude-opus-4.1` |
| Claude Opus 4 | `anthropic:claude-opus-4` |
| Claude 3.5 Haiku | `anthropic:claude-3.5-haiku` |

```typescript
const agent = new BuiltInAgent({
  model: "anthropic:claude-sonnet-4.5",
});
```

### Google

| Model | Specifier |
|-------|-----------|
| Gemini 2.5 Pro | `google:gemini-2.5-pro` |
| Gemini 2.5 Flash | `google:gemini-2.5-flash` |
| Gemini 2.5 Flash Lite | `google:gemini-2.5-flash-lite` |

```typescript
const agent = new BuiltInAgent({
  model: "google:gemini-2.5-pro",
});
```

## Environment Variables

Set the API key for your chosen provider:

```bash
# OpenAI
OPENAI_API_KEY=sk-...

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Google
GOOGLE_API_KEY=...
```

Alternatively, pass the API key directly in your configuration:

```typescript
const agent = new BuiltInAgent({
  model: "openai:gpt-4.1",
  apiKey: process.env.MY_OPENAI_KEY, // [!code highlight]
});
```

## Custom Models (AI SDK)

For models not in the built-in list, you can pass any Vercel AI SDK `LanguageModel` instance directly:

```typescript
import { BuiltInAgent } from "@copilotkit/runtime/v2";
import { createOpenAI } from "@ai-sdk/openai"; // [!code highlight]

const customProvider = createOpenAI({ // [!code highlight]
  apiKey: process.env.MY_API_KEY, // [!code highlight]
  baseURL: "https://my-proxy.example.com/v1", // [!code highlight]
}); // [!code highlight]

const agent = new BuiltInAgent({
  model: customProvider("my-fine-tuned-model"), // [!code highlight]
});
```

This works with any AI SDK provider — Azure OpenAI, AWS Bedrock, Ollama, or any OpenAI-compatible endpoint:

```typescript
import { createAzure } from "@ai-sdk/azure";

const azure = createAzure({
  resourceName: "my-resource",
  apiKey: process.env.AZURE_API_KEY,
});

const agent = new BuiltInAgent({
  model: azure("my-deployment"),
});
```

## How It Works

Under the hood, the Built-in Agent resolves model strings to AI SDK provider instances:

- `"openai:gpt-4.1"` → `@ai-sdk/openai` → `openai("gpt-4.1")`
- `"anthropic:claude-sonnet-4.5"` → `@ai-sdk/anthropic` → `anthropic("claude-sonnet-4.5")`
- `"google:gemini-2.5-pro"` → `@ai-sdk/google` → `google("gemini-2.5-pro")`

Both `"provider:model"` and `"provider/model"` separators are supported and work identically.

### Quickstart
- Route: `/built-in-agent/quickstart`
- Source: `docs/content/docs/integrations/built-in-agent/quickstart.mdx`
- Description: Get started with CopilotKit's Built-in Agent in minutes.

## Prerequisites

Before you begin, you'll need the following:

- An OpenAI API key (or Anthropic/Google — see [Model Selection](/built-in-agent/model-selection))
- Node.js 20+
- Your favorite package manager

## Getting started

                    You can either start fresh with our starter template or set up manually.
                ### Run our CLI

```bash
                npx copilotkit@latest create -f built-in-agent
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

                  The starter template uses OpenAI's GPT-4o by default. See [Model Selection](/built-in-agent/model-selection) for Anthropic, Google, or custom model setup.
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
                ### Create your frontend

                CopilotKit works with any React-based frontend. We'll use Next.js for this example.

```bash
                npx create-next-app@latest my-copilot-app
                cd my-copilot-app
```
                ### Install CopilotKit packages

```npm
                npm install @copilotkit/react-core @copilotkit/react-ui @copilotkit/runtime
```
                ### Configure your environment

                Create a `.env` file and add your OpenAI API key:

```plaintext title=".env"
                OPENAI_API_KEY=your_openai_api_key
```

                  This example uses OpenAI's GPT-4o. See [Model Selection](/built-in-agent/model-selection) for Anthropic, Google, or custom model setup.
                ### Setup Copilot Runtime

                Create an API route with the `BuiltInAgent` and `CopilotRuntime`:

```ts title="app/api/copilotkit/route.ts"
                import {
                  CopilotRuntime,
                  copilotRuntimeNextJSAppRouterEndpoint,
                } from "@copilotkit/runtime";
                import { BuiltInAgent } from "@copilotkit/runtime/v2"; // [!code highlight]
                import { NextRequest } from "next/server";

                const builtInAgent = new BuiltInAgent({ // [!code highlight:3]
                  model: "openai:gpt-5.2",
                });

                const runtime = new CopilotRuntime({
                  agents: { default: builtInAgent }, // [!code highlight]
                });

                export const POST = async (req: NextRequest) => {
                  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
                    runtime,
                    endpoint: "/api/copilotkit",
                  });

                  return handleRequest(req);
                };
```
                ### Configure CopilotKit Provider

                Wrap your application with the CopilotKit provider:

```tsx title="app/layout.tsx"
                import { CopilotKit } from "@copilotkit/react-core"; // [!code highlight]
                import "@copilotkit/react-ui/v2/styles.css"; // [!code highlight]

                // ...

                export default function RootLayout({ children }: {children: React.ReactNode}) {
                  return (
                    <html lang="en">
                      <body>
                        {/* [!code highlight:3] */}
                        <CopilotKit runtimeUrl="/api/copilotkit">
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
              import { CopilotSidebar } from "@copilotkit/react-core/v2"; // [!code highlight]

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
                - Check that your API key is correctly set in the `.env` file
                - Make sure the runtime endpoint path matches the `runtimeUrl` in your CopilotKit provider

## What's next?

Now that you have your basic agent setup, explore these advanced features:

### Server Tools
- Route: `/built-in-agent/server-tools`
- Source: `docs/content/docs/integrations/built-in-agent/server-tools.mdx`
- Description: Define backend tools for your Built-in Agent.

## What are Server Tools?

Server tools are functions that run on your backend that the Built-in Agent can invoke. They're defined using `defineTool()` with Zod schemas for type-safe parameters.

## When should I use this?

- Your agent needs to access databases, APIs, or other backend services
- You want type-safe tool parameters with validation
- The tool logic requires server-side secrets or resources

## Defining a tool

```typescript title="src/copilotkit.ts"
import { BuiltInAgent, defineTool } from "@copilotkit/runtime/v2";
import { z } from "zod";

const getWeather = defineTool({
  name: "getWeather",
  description: "Get the current weather for a city",
  parameters: z.object({
    city: z.string().describe("The city name"),
  }),
  execute: async ({ city }) => {
    // Your implementation here
    return { temperature: 72, condition: "sunny", city };
  },
});

const builtInAgent = new BuiltInAgent({
  model: "openai:gpt-5.2",
  tools: [getWeather],
});
```

## Tool response

Tools can return any JSON-serializable value. The agent uses the response to continue the conversation.

## Multiple tools

Pass an array of tools — the agent chooses which to call based on the user's request:

```typescript title="src/copilotkit.ts"
const searchDocs = defineTool({
  name: "searchDocs",
  description: "Search the documentation for relevant articles",
  parameters: z.object({
    query: z.string().describe("The search query"),
  }),
  execute: async ({ query }) => {
    const results = await search(query);
    return { results, count: results.length };
  },
});

const createTicket = defineTool({
  name: "createTicket",
  description: "Create a support ticket",
  parameters: z.object({
    title: z.string().describe("Ticket title"),
    priority: z.enum(["low", "medium", "high"]).describe("Ticket priority"),
    description: z.string().describe("Detailed description of the issue"),
  }),
  execute: async ({ title, priority, description }) => {
    const ticket = await db.tickets.create({ title, priority, description });
    return { ticketId: ticket.id, status: "created" };
  },
});

const builtInAgent = new BuiltInAgent({
  model: "openai:gpt-5.2",
  tools: [searchDocs, createTicket], // [!code highlight]
});
```

## Complex Zod schemas

Use nested objects, arrays, enums, and optional fields for sophisticated tool parameters:

```typescript
const bookFlight = defineTool({
  name: "bookFlight",
  description: "Search for and book flights",
  parameters: z.object({
    trip: z.object({
      origin: z.string().describe("Origin airport code (e.g., SFO)"),
      destination: z.string().describe("Destination airport code (e.g., JFK)"),
      date: z.string().describe("Departure date in YYYY-MM-DD format"),
    }),
    passengers: z.array(
      z.object({
        name: z.string(),
        seatPreference: z.enum(["window", "middle", "aisle"]).optional(),
      })
    ).describe("List of passengers"),
    class: z.enum(["economy", "business", "first"]).default("economy"),
  }),
  execute: async ({ trip, passengers, class: seatClass }) => {
    const flights = await searchFlights(trip, seatClass);
    return { flights, passengerCount: passengers.length };
  },
});
```

## Error handling

Throw errors or return error objects from your tool — the agent will see the error and can inform the user or try a different approach:

```typescript
const getUser = defineTool({
  name: "getUser",
  description: "Look up a user by email",
  parameters: z.object({
    email: z.string().email().describe("The user's email address"),
  }),
  execute: async ({ email }) => {
    const user = await db.users.findByEmail(email);
    if (!user) {
      throw new Error(`No user found with email: ${email}`); // [!code highlight]
    }
    return { id: user.id, name: user.name, role: user.role };
  },
});
```

## Multi-step tool calling

By default, the agent performs a single step. If your agent needs to chain tool calls (e.g., search first, then create a ticket), set `maxSteps`:

```typescript
const builtInAgent = new BuiltInAgent({
  model: "openai:gpt-5.2",
  maxSteps: 5, // [!code highlight]
  tools: [searchDocs, createTicket, getUser],
});
```

With `maxSteps: 5`, the agent can:
1. Call `searchDocs` to find relevant info
2. Process the result
3. Call `createTicket` with details from the search
4. Continue until done (up to 5 iterations)

See [Advanced Configuration](/built-in-agent/advanced-configuration) for more options like `toolChoice`, `temperature`, and `providerOptions`.

### Shared State
- Route: `/built-in-agent/shared-state`
- Source: `docs/content/docs/integrations/built-in-agent/shared-state.mdx`
- Description: Bidirectional state sharing between your app and the Built-in Agent.

Share state bidirectionally between your React app and the Built-in Agent. Your app can read and write agent state, and the agent can update state that your UI reacts to in real time.

## What is this?

Shared state lets your frontend and agent stay in sync. The agent can update state (like adding items to a list or changing a setting), and your React components re-render automatically. Your app can also write state that the agent can read.

## When should I use this?

- The agent should be able to modify your app's UI (add items, update fields, toggle settings)
- You want real-time UI updates as the agent works
- Your app needs to read what the agent is doing (progress indicators, intermediate results)

## Reading agent state

Use the `useAgent` hook to access the agent's current state:

```tsx title="app/page.tsx"
import { useAgent } from "@copilotkit/react-core/v2"; // [!code highlight]

function TaskBoard() {
  // [!code highlight:3]
  const { agent } = useAgent({
    agentId: "assistant",
  });

  // Read state set by the agent // [!code highlight]
  const tasks = (agent.state.tasks as any[]) ?? [];

  return (
    <div>
      <h2>Tasks</h2>
      <ul>
        {tasks.map((task, i) => (
          <li key={i}>
            {task.title} — {task.status}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

  `agent.state` is reactive — your component re-renders automatically when the agent updates state.

## Writing state from the frontend

You can also push state from the frontend to the agent:

```tsx title="app/page.tsx"
import { useAgent } from "@copilotkit/react-core/v2";

function SettingsPanel() {
  const { agent } = useAgent({
    agentId: "assistant",
  });

  const handleThemeChange = (theme: string) => {
    agent.setState({ // [!code highlight]
      ...agent.state, // [!code highlight]
      userPreferences: { theme }, // [!code highlight]
    }); // [!code highlight]
  };

  return (
    <div>
      <button onClick={() => handleThemeChange("dark")}>Dark Mode</button>
      <button onClick={() => handleThemeChange("light")}>Light Mode</button>
    </div>
  );
}
```

## How it works

The Built-in Agent automatically has access to state tools (`AGUISendStateSnapshot` and `AGUISendStateDelta`) through the AG-UI protocol. When the agent calls these tools:

1. The agent sends a state update (full snapshot or delta)
2. The CopilotKit runtime delivers the update to the frontend via SSE
3. Your `useAgent` hook receives the update and triggers a re-render

No additional backend configuration is required — state tools are available to the Built-in Agent by default.

## Example: collaborative todo list

Here's a complete example where the agent can add and manage tasks:

```tsx title="app/page.tsx"
import { CopilotChat } from "@copilotkit/react-core/v2";
import { useAgent } from "@copilotkit/react-core/v2";

function TodoApp() {
  const { agent } = useAgent({
    agentId: "assistant",
  });

  const todos = (agent.state.todos as any[]) ?? [];

  return (
    <div style={{ display: "flex", gap: "1rem" }}>
      <div>
        <h2>My Todos</h2>
        <ul>
          {todos.map((todo, i) => (
            <li key={i} style={{ textDecoration: todo.done ? "line-through" : "none" }}>
              {todo.text}
            </li>
          ))}
        </ul>
      </div>
      <CopilotChat
        labels={{
          welcomeMessageText: "I can help manage your todos. Try 'Add a task to buy groceries'.",
        }}
      />
    </div>
  );
}
```

When you tell the agent "Add a task to buy groceries", it updates the shared state and your todo list renders the new item immediately.
