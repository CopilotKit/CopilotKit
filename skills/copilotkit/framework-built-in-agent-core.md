# Built In Agent — Core Setup

Core Setup guide for the Built In Agent integration.

> For shared CopilotKit concepts (runtime setup, prebuilt components, troubleshooting, etc.), see the topic guides. This file focuses on framework-specific implementation details.

## Guidance
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
                import { CopilotKit } from "@copilotkit/react-core/v2"; // [!code highlight]
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
