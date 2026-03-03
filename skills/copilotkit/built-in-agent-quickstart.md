# BuiltInAgent Quickstart

Use this as the default path when a user asks to build a basic CopilotKit app fast.

## Minimal stack
- Runtime endpoint on your backend (`@copilotkit/runtime`)
- `BuiltInAgent` registered as the default agent
- `CopilotKit` provider in the frontend
- One chat UI component (`CopilotSidebar` or `CopilotChat`)

## Canonical starter (Next.js App Router)

```ts title="app/api/copilotkit/route.ts"
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { BuiltInAgent } from "@copilotkit/runtime/v2";
import { NextRequest } from "next/server";

const agent = new BuiltInAgent({
  model: "openai/gpt-4o",
  prompt: "You are a helpful assistant.",
});

const runtime = new CopilotRuntime({
  agents: { default: agent },
});
const serviceAdapter = new ExperimentalEmptyAdapter();

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });
  return handleRequest(req);
};
```

```tsx title="app/layout.tsx"
import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <CopilotKit runtimeUrl="/api/copilotkit">{children}</CopilotKit>
      </body>
    </html>
  );
}
```

```tsx title="app/page.tsx"
"use client";

import { CopilotSidebar } from "@copilotkit/react-ui";

export default function Page() {
  return <CopilotSidebar defaultOpen />;
}
```

## Checklist
1. Install packages: `@copilotkit/react-core`, `@copilotkit/react-ui`, `@copilotkit/runtime`
2. Set provider runtime URL to your backend endpoint.
3. Set an LLM API key (`OPENAI_API_KEY` or provider equivalent) in env.
4. Confirm the runtime route and UI route are both running.
5. Expand with frontend tools, context, shared state, or a framework integration as needed.

## Additional guidance from docs
### Copilot Runtime
- Route: `/backend/copilot-runtime`
- Source: `docs/content/docs/(root)/backend/copilot-runtime.mdx`
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

## The Default Agent

If you register an agent with the name `"default"`, CopilotKit's prebuilt UI components will use it automatically without any additional configuration on the frontend. This is useful when you have one primary agent and don't want to specify an `agentId` everywhere.

```ts title="app/api/copilotkit/route.ts"
const runtime = new CopilotRuntime({
  agents: {
    // This agent will be used automatically by CopilotPopup, CopilotSidebar, etc.
    "default": new HttpAgent({ url: "https://my-agent.example.com" }),
  },
});
```

When you register multiple agents, the `"default"` agent is what powers the chat unless a specific agent is selected. Other agents can still be used by passing their `agentId` to `useAgent` or the prebuilt components.

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

### MCP Apps
- Route: `/generative-ui/mcp-apps`
- Source: `docs/content/docs/(root)/generative-ui/mcp-apps.mdx`
- Description: Render interactive UI components from MCP servers directly in your chat interface.

## What is this?

MCP Apps are MCP servers that expose tools with associated UI resources. When the agent calls one of these tools, CopilotKit automatically fetches and renders the UI component in the chat — no additional frontend code required.

Key benefits:
- **Zero frontend code** — UI components are served by the MCP server
- **Full interactivity** — Components can use HTML, CSS, and JavaScript
- **Secure sandboxing** — Content runs in isolated iframes
- **Thread persistence** — MCP Apps are stored in conversation history and restored on reconnect

## Choose your AI backend

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
