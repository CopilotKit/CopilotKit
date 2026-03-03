# Copilot Runtime

Runtime architecture, endpoint setup, and backend responsibilities.

## Guidance
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

### MCP (Agents<->Tools)
- Route: `/connect-mcp-servers`
- Source: `docs/content/docs/(root)/connect-mcp-servers.mdx`
- Description: Integrate Model Context Protocol (MCP) servers into your React applications

## Introduction

The Model Context Protocol is an open standard that enables developers to build secure, two-way connections between their data sources and AI-powered tools. With MCP, you can:

- Connect AI applications to your data sources
- Enable AI tools to access and utilize your data securely
- Build AI-powered features that have context about your application

For further reading, check out the [Model Context Protocol](https://modelcontextprotocol.io/introduction) website.

  If you want MCP servers to return **interactive UI components** that render directly in the chat, check out [MCP Apps](/generative-ui/specs/mcp-apps).

  MCP is one of three prominent [agentic protocols](/agentic-protocols) CopilotKit supports to connect agents to user-facing frontends

## Quickstart with CopilotKit

    ### Get an MCP Server
    First, we need to make sure we have an MCP server to connect to. You can use any MCP SSE endpoint you have configured.

          Composio provides a registry of ready-to-use MCP servers with simple authentication and setup.

          To get started, go to [Composio](https://mcp.composio.dev/), find a server the suits your needs and copy the SSE URL before continuing here.

        ### Run the CLI
        Just run this following command in your Next.js application to get started!

                No problem! Just use `create-next-app` to make one quickly.
```bash
                npx create-next-app@latest
```

```bash
        npx copilotkit@latest init -m MCP
```
        #### Set up the CopilotKit Provider

        Wrap your application with the `CopilotKit` provider:

```tsx
        "use client";

        import { CopilotKit } from "@copilotkit/react-core";

        export default function App() {
          return (
            <CopilotKit publicApiKey="<replace_with_your_own>">
              {/* Your app content */}
            </CopilotKit>
          );
        }
```
        #### Connect to MCP Servers

        Create a component to manage MCP server connections:

```tsx
        "use client";

        import { useCopilotChat } from "@copilotkit/react-core";
        import { useEffect } from "react";

        function McpServerManager() {
          const { setMcpServers } = useCopilotChat();

          useEffect(() => {
            setMcpServers([
              {
                // Try a sample MCP server at https://mcp.composio.dev/
                endpoint: "your_mcp_sse_url",
              },
            ]);
          }, [setMcpServers]);

          return null;
        }

        export default McpServerManager;
```
        #### Add the Chat Interface

        Add the `CopilotChat` component to your page:

```tsx
        "use client";

        import { CopilotChat } from "@copilotkit/react-ui";
        import McpServerManager from "./McpServerManager";

        export default function ChatInterface() {
          return (
            <div className="flex h-screen p-4">
              <McpServerManager />
              <CopilotChat
                instructions="You are a helpful assistant with access to MCP servers."
                className="flex-grow rounded-lg w-full"
              />
            </div>
          );
        }
```
        #### Visualize MCP Tool Calls (Optional)

        Create a component to display MCP tool calls in your UI:

```tsx
        "use client";

        import {
          useCopilotAction,
          CatchAllActionRenderProps,
        } from "@copilotkit/react-core";
        import McpToolCall from "./McpToolCall";

        export function ToolRenderer() {
          useCopilotAction({
            /**
             * The asterisk (*) matches all tool calls
             */
            name: "*",
            render: ({ name, status, args, result }: CatchAllActionRenderProps<[]>) => (
              <McpToolCall status={status} name={name} args={args} result={result} />
            ),
          });
          return null;
        }
```
        #### Complete Implementation

        Combine all components together:

```tsx
        "use client";

        import { CopilotKit } from "@copilotkit/react-core";
        import { CopilotChat } from "@copilotkit/react-ui";
        import McpServerManager from "./McpServerManager";
        import { ToolRenderer } from "./ToolRenderer";

        export default function Page() {
          return (
            <CopilotKit publicApiKey="<replace_with_your_own>">
              <div className="flex h-screen p-4">
                <McpServerManager />
                <CopilotChat
                  instructions="You are a helpful assistant with access to MCP servers."
                  className="flex-grow rounded-lg w-full"
                />
                <ToolRenderer />
              </div>
            </CopilotKit>
          );
        }
```

## Advanced Usage

### Implementing the McpToolCall Component

```tsx
"use client";

import * as React from "react";

interface ToolCallProps {
  status: "complete" | "inProgress" | "executing";
  name?: string;
  args?: any;
  result?: any;
}

export default function MCPToolCall({
  status,
  name = "",
  args,
  result,
}: ToolCallProps) {
  const [isOpen, setIsOpen] = React.useState(false);

  // Format content for display
  const format = (content: any): string => {
    if (!content) return "";
    const text =
      typeof content === "object"
        ? JSON.stringify(content, null, 2)
        : String(content);
    return text
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  };

  return (
    <div className="bg-[#1e2738] rounded-lg overflow-hidden w-full">
      <div
        className="p-3 flex items-center cursor-pointer"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="text-white text-sm overflow-hidden text-ellipsis">
          {name || "MCP Tool Call"}
        </span>
        <div className="ml-auto">
          <div
            className={`w-2 h-2 rounded-full ${
              status === "complete"
                ? "bg-gray-300"
                : status === "inProgress" || status === "executing"
                ? "bg-gray-500 animate-pulse"
                : "bg-gray-700"
            }`}
          />
        </div>
      </div>

      {isOpen && (
        <div className="px-4 pb-4 text-gray-300 font-mono text-xs">
          {args && (
            <div className="mb-4">
              <div className="text-gray-400 mb-2">Parameters:</div>
              <pre className="whitespace-pre-wrap max-h-[200px] overflow-auto">
                {format(args)}
              </pre>
            </div>
          )}

          {status === "complete" && result && (
            <div>
              <div className="text-gray-400 mb-2">Result:</div>
              <pre className="whitespace-pre-wrap max-h-[200px] overflow-auto">
                {format(result)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

### Self-Hosting Option

  The Copilot Runtime handles communication with LLMs, message history, and
  state. You can self-host it or use{" "}
  (recommended). Learn more in our [Self-Hosting Guide](/direct-to-llm/guides/self-hosting).

To configure your self-hosted runtime with MCP servers, you'll need to implement the `createMCPClient` function that matches this interface:

```typescript
type CreateMCPClientFunction = (
  config: MCPEndpointConfig
) => Promise<MCPClient>;
```

For detailed implementation guidance, refer to the [official MCP SDK documentation](https://github.com/modelcontextprotocol/typescript-sdk?tab=readme-ov-file#writing-mcp-clients).

Here's a basic example of configuring the runtime:

```tsx
import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { NextRequest } from "next/server";

const serviceAdapter = new OpenAIAdapter();

const runtime = new CopilotRuntime({
  createMCPClient: async (config) => {
    // Implement your MCP client creation logic here
    // See the MCP SDK docs for implementation details
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
