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
- Route: `/copilot-runtime`
- Source: `docs/content/docs/(root)/copilot-runtime.mdx`
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
- Route: `/generative-ui/specs/mcp-apps`
- Source: `docs/content/docs/(root)/generative-ui/specs/mcp-apps.mdx`
- Description: Render interactive UI components from MCP servers directly in your chat interface

## Prerequisites

Before you begin, you'll need the following:

- An OpenAI API key (or API key for your preferred LLM provider)
- Node.js 20+
- Your favorite package manager
- An MCP server running (see [Example MCP Servers](#example-mcp-servers) below)

## What are MCP Apps?

MCP Apps are MCP servers that expose tools with associated UI resources. When the agent calls one of these tools, CopilotKit automatically fetches and renders the UI component in the chat - no additional frontend code required.

Key benefits:
- **Zero frontend code** - UI components are served by the MCP server
- **Full interactivity** - Components can use HTML, CSS, and JavaScript
- **Secure sandboxing** - Content runs in isolated iframes
- **Direct server communication** - The middleware securely proxies communication between the rendered UI and the MCP server, enabling real-time interactions
- **Thread persistence** - MCP Apps are stored in conversation history and restored on reconnect

## Quickstart

Want to try MCP Apps out with a new application? We have a pre-built example app you can use via our CLI.

```bash
npx copilotkit create -f mcp-apps
```

## Getting started

If you're looking to add an MCP App into an existing application, let's walk through the process.

    ### (Optional) Create a new application

    We'll be starting from scratch for this example, but feel free to skip this step if you already have an application.

    For the sake of this example, we'll be using Next.js but the process will slot into any frontend React framework.

```bash
    npx create-next-app@latest
```
    ### Add the dependencies

```npm
    npm install @copilotkit/react-ui @copilotkit/react-core @copilotkit/runtime @ag-ui/mcp-apps-middleware
```
    ### Configure your agent

    Add your agent configuration to CopilotRuntime and add the `MCPAppsMiddleware` to the BuiltInAgent with your MCP server configurations:

      This same process will work with any agent configuration.

```bash
    touch app/api/copilotkit/route.ts
```

```typescript title="app/api/copilotkit/route.ts"
    import {
      CopilotRuntime,
      ExperimentalEmptyAdapter,
      copilotRuntimeNextJSAppRouterEndpoint,
    } from "@copilotkit/runtime";
    import { BuiltInAgent } from "@copilotkit/runtime/v2";
    import { NextRequest } from "next/server";
    import { MCPAppsMiddleware } from "@ag-ui/mcp-apps-middleware";

    // 1. Create your agent and add the MCP Apps middleware
    const agent = new BuiltInAgent({
      model: "openai/gpt-4o",
      prompt: "You are a helpful assistant.",
    }).use(
       new MCPAppsMiddleware({
        mcpServers: [
          {
            type: "http",
            url: "http://localhost:3108/mcp",
            serverId: "my-server" // Recommended: stable identifier
          },
        ],
      }),
    )

    // 2. Create a service adapter, empty if not relevant
    const serviceAdapter = new ExperimentalEmptyAdapter();

    // 3. Create the runtime and add the agent
    const runtime = new CopilotRuntime({
      agents: {
        default: agent,
      },
    });

    // 4. Create the API route
    export const POST = async (req: NextRequest) => {
      const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
        runtime,
        serviceAdapter,
        endpoint: "/api/copilotkit",
      });

      return handleRequest(req);
    };

```

      Always provide a `serverId` for production deployments. Without it, CopilotKit generates a hash from the server URL. If your URL changes (e.g., different environments), previously stored MCP Apps in conversation history won't load correctly.
    ### Configure environment

    Create a `.env.local` file in your frontend directory and add your API key:

```plaintext title=".env.local"
    OPENAI_API_KEY=your_openai_api_key
```

    The example is configured to use OpenAI's GPT-4o by default, but you can modify the BuiltInAgent to use any language model supported by CopilotKit.
    ### Configure CopilotKit Provider

    Wrap your application with the CopilotKit provider:

```tsx title="app/layout.tsx"
    // [!code highlight:2]
    import { CopilotKit } from "@copilotkit/react-core";
    import "@copilotkit/react-ui/styles.css";

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
    "use client";

    import { CopilotSidebar } from "@copilotkit/react-ui";

    export default function Page() {
        return (
            <main>
                <h1>Your App</h1>
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

    Your application will be available at `http://localhost:3000`.

That's it! MCP Apps will now render automatically when the agent uses tools that have associated UI resources.

## Transport Types

The middleware supports two transport types:

### HTTP Transport

For MCP servers using HTTP-based communication:

```typescript
{
  type: "http",
  url: "http://localhost:3101/mcp",
  serverId: "my-http-server"
}
```

### SSE Transport

For MCP servers using Server-Sent Events:

```typescript
{
  type: "sse",
  url: "https://mcp.example.com/sse",
  headers: {
    "Authorization": "Bearer token"
  },
  serverId: "my-sse-server"
}
```

## Threading Support

MCP Apps integrate fully with CopilotKit's threading system:

- **Persistence** - When you save a thread, MCP Apps are stored as part of the conversation history
- **Restoration** - Loading a thread restores all MCP Apps with their original state
- **Server ID stability** - Using consistent `serverId` values ensures MCP Apps load correctly across sessions

## Example MCP Servers

Try these open-source MCP Apps servers to get started:

https://github.com/modelcontextprotocol/ext-apps

This repo contains multiple demo servers with tools like budget allocators, data visualizations, and interactive dashboards.

### Quickstart
- Route: `/direct-to-llm/guides/quickstart`
- Source: `docs/content/docs/integrations/direct-to-llm/guides/quickstart.mdx`
- Description: Get started with CopilotKit in under 5 minutes.

## Using the CLI

If you have a **NextJS** application, you can use our CLI to automatically bootstrap your application for use with CopilotKit.

```bash
npx copilotkit@latest init
```

    No problem! Just use `create-next-app` to make a new NextJS application
    quickly. ```bash npx create-next-app@latest ```

## Code-along

If you don't have a NextJS application or just want to code-along, you can follow the steps below.

### Install CopilotKit

First, install the latest packages for CopilotKit.

```npm
npm install @copilotkit/react-ui @copilotkit/react-core
```

### Get a Copilot Cloud Public API Key
Navigate to [Copilot Cloud](https://cloud.copilotkit.ai) and follow the instructions to get a public API key - it's free!
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
        {/* [!code highlight:3] */}
        <CopilotKit publicApiKey="<your-copilot-cloud-public-api-key>"> 
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
import "@copilotkit/react-ui/styles.css";
```

  Copilot UI ships with a number of built-in UI patterns, choose whichever one you like.

    `CopilotPopup` is a convenience wrapper for `CopilotChat` that lives at the same level as your main content in the view hierarchy. It provides **a floating chat interface** that can be toggled on and off.

```tsx
    // [!code word:CopilotPopup]
    import { CopilotPopup } from "@copilotkit/react-ui";

    export function YourApp() {
      return (
        <>
          <YourMainContent />
          <CopilotPopup
            instructions={"You are assisting the user as best as you can. Answer in the best way possible given the data you have."}
            labels={{
              title: "Popup Assistant",
              initial: "Need any help?",
            }}
          />
        </>
      );
    }
```

    `CopilotSidebar` is a convenience wrapper for `CopilotChat` that wraps your main content in the view hierarchy. It provides a **collapsible and expandable sidebar** chat interface.

```tsx
    // [!code word:CopilotSidebar]
    import { CopilotSidebar } from "@copilotkit/react-ui";

    export function YourApp() {
      return (
        <CopilotSidebar
          defaultOpen={true}
          instructions={"You are assisting the user as best as you can. Answer in the best way possible given the data you have."}
          labels={{
            title: "Sidebar Assistant",
            initial: "How can I help you today?",
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
    import { CopilotChat } from "@copilotkit/react-ui";

    export function YourComponent() {
      return (
        <CopilotChat
          instructions={"You are assisting the user as best as you can. Answer in the best way possible given the data you have."}
          labels={{
            title: "Your Assistant",
            initial: "Hi! 👋 How can I assist you today?",
          }}
        />
      );
    }
```

    The built-in Copilot UI can be customized in many ways -- both through css and by passing in custom sub-components.

    CopilotKit also offers **fully custom headless UI**, through the `useCopilotChat` hook. Everything built with the built-in UI (and more) can be implemented with the headless UI, providing deep customizability.

```tsx
    import { useCopilotChat } from "@copilotkit/react-core";
    import { Role, TextMessage } from "@copilotkit/runtime-client-gql";

    export function CustomChatInterface() {
      const {
        visibleMessages,
        appendMessage,
        setMessages,
        deleteMessage,
        reloadMessages,
        stopGeneration,
        isLoading,
      } = useCopilotChat();

      const sendMessage = (content: string) => {
        appendMessage(new TextMessage({ content, role: Role.User }));
      };

      return (
        <div>
          {/* Implement your custom chat UI here */}
        </div>
      );
    }
```

### Install CopilotKit
First, install the latest packages for CopilotKit.

```npm
npm install @copilotkit/react-ui @copilotkit/react-core @copilotkit/runtime
```

### Set up a Copilot Runtime Endpoint

  If you are planning to use a single LangGraph agent in agent-lock mode as your agentic backend, your LLM adapter will only be used for peripherals such as suggestions, etc.

If you are not sure yet, simply ignore this note.

            The LangChain adapter shown here is using OpenAI, but can be used with any LLM!

            Be aware that the empty adapter only works in combination with CoAgents in agent lock mode!

            In addition, bare in mind that `useCopilotChatSuggestions`, `CopilotTextarea` and `CopilotTask` will not work, as these require an LLM.

        ### Install provider package

```npm
        npm install {{packageName}}
```

        ### Add your API key

        Next, add your API key to your `.env` file in the root of your project (unless you prefer to provide it directly to the client):

```plaintext title=".env"
        {{envVarName}}=your_api_key_here
```

        ### Add your API key

        Next, add your API key to your `.env` file in the root of your project (unless you prefer to provide it directly to the client):

```plaintext title=".env"
        {{envVarSecret}}=your_secret_key_here
        {{envVarAccess}}=your_access_key_here
        {{envVarToken}}=your_session_token_here
```

            Please note that the code below uses GPT-4o, which requires a paid OpenAI API key. **If you are using a free OpenAI API key**, change the model to a different option such as `gpt-3.5-turbo`.

    ### Setup the Runtime Endpoint

        ### Serverless Function Timeouts

        When deploying to serverless platforms (Vercel, AWS Lambda, etc.), be aware that default function timeouts may be too short for CopilotKit's streaming responses:

        - Vercel defaults: 10s (Hobby), 15s (Pro)
        - AWS Lambda default: 3s

        **Solution options:**
        1. Increase function timeout:
```json
            // vercel.json
            {
              "functions": {
                "api/copilotkit/**/*": {
                  "maxDuration": 60
                }
              }
            }
```
        2. Use [Copilot Cloud](https://cloud.copilotkit.ai/) to avoid timeout issues entirely

        { value: 'Next.js App Router', icon:  },
        { value: 'Next.js Pages Router', icon:  },
        { value: 'Node.js Express', icon:  },
        { value: 'Node.js HTTP', icon:  },
        { value: 'NestJS', icon:  }
    ]}>

            Create a new route to handle the `/api/copilotkit` endpoint.

```ts title="app/api/copilotkit/route.ts"
            import {
              CopilotRuntime,
              {{adapterImport}},
              copilotRuntimeNextJSAppRouterEndpoint,
            } from '@copilotkit/runtime';
            {{extraImports}}
            import { NextRequest } from 'next/server';

            {{clientSetup}}
            {{adapterSetup}}
            const runtime = new CopilotRuntime();

            export const POST = async (req: NextRequest) => {
              const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
                runtime,
                serviceAdapter,
                endpoint: '/api/copilotkit',
              });

              return handleRequest(req);
            };
```

            Your Copilot Runtime endpoint should be available at `http://localhost:3000/api/copilotkit`.

            Create a new route to handle the `/api/copilotkit` endpoint:

```ts title="pages/api/copilotkit.ts"
            import { NextApiRequest, NextApiResponse } from 'next';
            import {
              CopilotRuntime,
              {{adapterImport}},
              copilotRuntimeNextJSPagesRouterEndpoint,
            } from '@copilotkit/runtime';
            {{extraImports}}

            {{clientSetup}}
            {{adapterSetup}}

            const handler = async (req: NextApiRequest, res: NextApiResponse) => {
              const runtime = new CopilotRuntime();

              const handleRequest = copilotRuntimeNextJSPagesRouterEndpoint({
                endpoint: '/api/copilotkit',
                runtime,
                serviceAdapter,
              });

              return await handleRequest(req, res);
            };

            export default handler;
```

            Your Copilot Runtime endpoint should be available at `http://localhost:3000/api/copilotkit`.

            Create a new Express.js app and set up the Copilot Runtime handler:

```ts title="server.ts"
            import express from 'express';
            import {
              CopilotRuntime,
              {{adapterImport}},
              copilotRuntimeNodeHttpEndpoint,
            } from '@copilotkit/runtime';
            {{extraImports}}

            const app = express();
            {{clientSetup}}
            {{adapterSetup}}

            app.use('/copilotkit', (req, res, next) => {
              (async () => {
                const runtime = new CopilotRuntime();
                const handler = copilotRuntimeNodeHttpEndpoint({
                  endpoint: '/copilotkit',
                  runtime,
                  serviceAdapter,
                });

                return handler(req, res);
              })().catch(next);
            });

            app.listen(4000, () => {
              console.log('Listening at http://localhost:4000/copilotkit');
            });
```

            Your Copilot Runtime endpoint should be available at `http://localhost:4000/copilotkit`.

                Remember to point your `runtimeUrl` to the correct endpoint in your client-side code, e.g. `http://localhost:PORT/copilotkit`.

            Set up a simple Node.js HTTP server and use the Copilot Runtime to handle requests:

```ts title="server.ts"
            import { createServer } from 'node:http';
            import {
              CopilotRuntime,
              {{adapterImport}},
              copilotRuntimeNodeHttpEndpoint,
            } from '@copilotkit/runtime';
            {{extraImports}}

            {{clientSetup}}
            {{adapterSetup}}

            const server = createServer((req, res) => {
              const runtime = new CopilotRuntime();
              const handler = copilotRuntimeNodeHttpEndpoint({
                endpoint: '/copilotkit',
                runtime,
                serviceAdapter,
              });

              return handler(req, res);
            });

            server.listen(4000, () => {
              console.log('Listening at http://localhost:4000/copilotkit');
            });
```

            Your Copilot Runtime endpoint should be available at `http://localhost:4000/copilotkit`.

                Remember to point your `runtimeUrl` to the correct endpoint in your client-side code, e.g. `http://localhost:PORT/copilotkit`.

            Set up a controller in NestJS to handle the Copilot Runtime endpoint:

```ts title="copilotkit.controller.ts"
            import { All, Controller, Req, Res } from '@nestjs/common';
            import { CopilotRuntime, copilotRuntimeNestEndpoint, {{adapterImport}} } from '@copilotkit/runtime';
            import { Request, Response } from 'express';

            @Controller()
            export class CopilotKitController {
              @All('/copilotkit')
              copilotkit(@Req() req: Request, @Res() res: Response) {
                {{adapterSetup}}
                const runtime = new CopilotRuntime();

                const handler = copilotRuntimeNestEndpoint({
                  runtime,
                  serviceAdapter,
                  endpoint: '/copilotkit',
                });
                return handler(req, res);
              }
            }
```

            Your Copilot Runtime endpoint should be available at `http://localhost:3000/copilotkit`.

                Remember to point your `runtimeUrl` to the correct endpoint in your client-side code, e.g. `http://localhost:PORT/copilotkit`.

  ### Get Your Copilot Cloud API Key (Optional but Recommended)

  While self-hosting, you can still leverage Copilot Cloud's enhanced
  features for production-ready deployments.

1. Go to [Copilot Cloud](https://cloud.copilotkit.ai) and sign up for free
2. Get your API key from the dashboard
3. Add it to your environment variables:

```plaintext title=".env"
COPILOT_CLOUD_PUBLIC_API_KEY=your_api_key_here
```

**Why add this?**

- **Free tier available** - Your requests will NOT be logged
- **Production-ready features** - Enhanced error handling and observability
- **Developer console** - Better debugging and monitoring (coming soon)
- **Error observability** - Track and debug issues in production

This enables CopilotKit platform features while still using your self-hosted runtime.

### Configure the CopilotKit Provider

```tsx title="layout.tsx"
import "./globals.css";
import { ReactNode } from "react";
import { CopilotKit } from "@copilotkit/react-core"; // [!code highlight]

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body> 
        {/* Make sure to use the URL you configured in the previous step  */}
        {/* [!code highlight:3] */}
        <CopilotKit runtimeUrl="/api/copilotkit"> 
          {children}
        </CopilotKit>
      </body>
    </html>
  );
}

</Step>
<Step>
### Choose a Copilot UI

You are almost there! Now it's time to setup your Copilot UI.

First, import the default styles in your root component (typically `layout.tsx`) :

```tsx filename="layout.tsx"
```

<Callout type="info">
  Copilot UI ships with a number of built-in UI patterns, choose whichever one you like.
</Callout>

<Tabs groupId="component" items={["CopilotChat", "CopilotSidebar", "CopilotPopup", "Headless UI"]}>
  <Tab value="CopilotPopup">

    `CopilotPopup` is a convenience wrapper for `CopilotChat` that lives at the same level as your main content in the view hierarchy. It provides **a floating chat interface** that can be toggled on and off.

    <img src="https://cdn.copilotkit.ai/docs/copilotkit/images/popup-example.gif" alt="Popup Example" className="w-full rounded-lg my-4" />

```tsx
    //

      return (
      );
```

  </Tab>
  <Tab value="CopilotSidebar">
    `CopilotSidebar` is a convenience wrapper for `CopilotChat` that wraps your main content in the view hierarchy. It provides a **collapsible and expandable sidebar** chat interface.

    <img src="https://cdn.copilotkit.ai/docs/copilotkit/images/sidebar-example.gif" alt="Popup Example" className="w-full rounded-lg my-4" />

```tsx
    //

      return (
      );
```

  </Tab>
  <Tab value="CopilotChat">
    `CopilotChat` is a flexible chat interface component that **can be placed anywhere in your app** and can be resized as you desire.

    <img src="https://cdn.copilotkit.ai/docs/copilotkit/images/copilotchat-example.gif" alt="Popup Example" className="w-full rounded-lg my-4" />

```tsx
    //

      return (
      );
```

  </Tab>
  <Tab value="Headless UI">
    The built-in Copilot UI can be customized in many ways -- both through css and by passing in custom sub-components.

    CopilotKit also offers **fully custom headless UI**, through the `useCopilotChat` hook. Everything built with the built-in UI (and more) can be implemented with the headless UI, providing deep customizability.

```tsx

      const {
      } = useCopilotChat();

      const sendMessage = (content: string) => {
        appendMessage(new TextMessage({ content, role: Role.User }));
      };

      return (

      );
```
  </Tab>
</Tabs>

</Step>
</Steps>
</TailoredContentOption>
</TailoredContent>

---

## Next Steps

🎉 Congrats! You've successfully integrated a fully functional chatbot in your application! Give it a try now and see it in action. Want to
take it further? Learn more about what CopilotKit has to offer!

<Cards>
  <Card
    title="Connecting Your Data"
    description="Learn how to connect CopilotKit to your data, application state and user state."
    href="/direct-to-llm/guides/connect-your-data"
    icon={<LinkIcon />}
  />
  <Card
    title="Generative UI"
    description="Learn how to render custom UI components directly in the CopilotKit chat window."
    href="/direct-to-llm/guides/generative-ui"
    icon={<LinkIcon />}
  />
  <Card
    title="Frontend Tools"
    description="Learn how to allow your copilot to execute tools in the frontend."
    href="/direct-to-llm/guides/frontend-actions"
    icon={<LinkIcon />}
  />
  <Card
    title="Copilots with Agent Frameworks"
   description="Learn how to build agentic copilots using an Agent Framework like LangGraph, Mastra, or Pydantic AI."
    href="/langgraph"
    icon={<LinkIcon />}
  />
</Cards>
