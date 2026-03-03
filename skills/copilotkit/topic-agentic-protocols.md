# Agentic Protocols

AG-UI, MCP, and A2A protocol-level integration guidance.

## Guidance
### MCP (Agents<->Tools)
- Route: `/learn/connect-mcp-servers`
- Source: `docs/content/docs/learn/connect-mcp-servers.mdx`
- Description: Integrate Model Context Protocol (MCP) servers into your React applications

## Introduction

The Model Context Protocol is an open standard that enables developers to build secure, two-way connections between their data sources and AI-powered tools. With MCP, you can:

- Connect AI applications to your data sources
- Enable AI tools to access and utilize your data securely
- Build AI-powered features that have context about your application

For further reading, check out the [Model Context Protocol](https://modelcontextprotocol.io/introduction) website.

  If you want MCP servers to return **interactive UI components** that render directly in the chat, check out [MCP Apps](/learn/generative-ui/specs/mcp-apps).

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

        import { CopilotKit } from "@copilotkit/react-core/v2";

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

        import { useCopilotKit } from "@copilotkit/react-core/v2";
        import { useEffect } from "react";

        function McpServerManager() {
          const { setMcpServers } = useCopilotKit();

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

        import { CopilotChat } from "@copilotkit/react-core/v2";
        import McpServerManager from "./McpServerManager";

        export default function ChatInterface() {
          return (
            <div className="flex h-screen p-4">
              <McpServerManager />
              <CopilotChat
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
          useFrontendTool,
          CatchAllActionRenderProps,
        } from "@copilotkit/react-core/v2";
        import McpToolCall from "./McpToolCall";

        export function ToolRenderer() {
          useFrontendTool({
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

        import { CopilotKit } from "@copilotkit/react-core/v2";
        import { CopilotChat } from "@copilotkit/react-core/v2";
        import McpServerManager from "./McpServerManager";
        import { ToolRenderer } from "./ToolRenderer";

        export default function Page() {
          return (
            <CopilotKit publicApiKey="<replace_with_your_own>">
              <div className="flex h-screen p-4">
                <McpServerManager />
                <CopilotChat
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
  (recommended). Learn more in our [Self-Hosting Guide](/built-in-agent/copilot-runtime).

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

### A2A (Agents<->Agents)
- Route: `/learn/a2a-protocol`
- Source: `docs/content/docs/learn/a2a-protocol.mdx`
- Description: Bring your A2A agents to your users through AG-UI and CopilotKit.

```bash
    npx copilotkit@latest create -f a2a
```
```bash
    npm install @ag-ui/a2a-middleware
```
```tsx title="app/api/copilotkit/route.ts"
    import { A2AMiddlewareAgent } from "@ag-ui/a2a-middleware"

    ...

    // These first two are the urls to the a2a agents
    const researchAgentUrl = process.env.RESEARCH_AGENT_URL || "http://localhost:9001";
    const analysisAgentUrl = process.env.ANALYSIS_AGENT_URL || "http://localhost:9002";

    // And this is the url to the orchestrator agent that will be wrapped in the middleware
    const orchestratorUrl = process.env.ORCHESTRATOR_URL || "http://localhost:9000";

    // the orchestrator agent we pass to the middleware needs to be an instance of a derivative of an ag-ui `AbstractAgent`
    // In this case, we have access to the agent via url, so we can gain an instance using the `HttpAgent` class
    const orchestrationAgent = new HttpAgent({
      url: orchestratorUrl,
    });

    // A2A Middleware: Wraps orchestrator and injects send_message_to_a2a_agent tool
    // This allows orchestrator to communicate with A2A agents transparently
    const a2aMiddlewareAgent = new A2AMiddlewareAgent({
      description:
        "Research assistant with 2 specialized agents: Research (LangGraph) and Analysis (ADK)",
      // We pass the urls to the a2a agents, the middleware will handle the connections
      agentUrls: [
        researchAgentUrl,
        analysisAgentUrl,
      ],
      // Pass the agent instance
      orchestrationAgent,
      // These are domain specific instructions for the agent. They will be added to the generic instructions on how to
      // connect to a2a agents that will be automatically generated by the middleware
      instructions: `
        You are a research assistant that orchestrates between 2 specialized agents.

        AVAILABLE AGENTS:

        - Research Agent (LangGraph): Gathers and summarizes information about a topic
        - Analysis Agent (ADK): Analyzes research findings and provides insights

        WORKFLOW STRATEGY (SEQUENTIAL - ONE AT A TIME):

        When the user asks to research a topic:

        1. Research Agent - First, gather information about the topic
          - Pass: The user's research query or topic
          - The agent will return structured JSON with research findings

        2. Analysis Agent - Then, analyze the research results
          - Pass: The research results from step 1
          - The agent will return structured JSON with analysis and insights

        3. Present the complete research and analysis to the user

        CRITICAL RULES:
        - Call agents ONE AT A TIME, wait for results before making next call
        - Pass information from earlier agents to later agents
        - Synthesize all gathered information in final response
      `,
    });

    // CopilotKit runtime connects frontend to agent system
    const runtime = new CopilotRuntime({
      agents: {
        a2a_chat: a2aMiddlewareAgent, // Must match agent prop in <CopilotKit agent="a2a_chat">
      },
    });

```
```tsx title="components/chat.tsx"
    import { useFrontendTool } from "@copilotkit/react-core/v2"
    import { Markdown } from "@copilotkit/react-core/v2"

    function YourMainContent() {
      // ...

      useFrontendTool({
        name: "send_message_to_a2a_agent",
        description: "Sends a message to an A2A agent",
        available: "frontend",
        parameters: [
          {
            name: "agentName",
            type: "string",
            description: "The name of the A2A agent to send the message to",
          },
          {
            name: "task",
            type: "string",
            description: "The message to send to the A2A agent",
          },
        ],
        render: (actionRenderProps) => {
          return (
            <>
              <MessageToA2A {...actionRenderProps} />
              <MessageFromA2A {...actionRenderProps} />
            </>
          );
        },
      });

      // ...
    }
```
```tsx title="components/a2a/MessageToA2A.tsx"
    import React from "react";
    import { getAgentStyle, truncateTask } from "./agent-styles";

    type MessageActionRenderProps = {
      status: string;
      args: {
        agentName?: string;
        task?: string;
      };
    };

    export const MessageToA2A: React.FC<MessageActionRenderProps> = ({ status, args }) => {
      switch (status) {
        case "executing":
        case "complete":
          break;
        default:
          return null;
      }

      if (!args.agentName || !args.task) {
        return null;
      }

      const agentStyle = getAgentStyle(args.agentName);

      return (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 my-2 a2a-message-enter">
          <div className="flex items-start gap-3">
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="flex flex-col items-center">
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-gray-700 text-white">
                  Orchestrator
                </span>
                <span className="text-[9px] text-gray-500 mt-0.5">ADK</span>
              </div>

              <span className="text-gray-400 text-sm">→</span>

              <div className="flex flex-col items-center">
                <span
                  className={`px-3 py-1 rounded-full text-xs font-semibold border-2 ${agentStyle.bgColor} ${agentStyle.textColor} ${agentStyle.borderColor} flex items-center gap-1`}
                >
                  <span>{agentStyle.icon}</span>
                  <span>{args.agentName}</span>
                </span>
                {agentStyle.framework && (
                  <span className="text-[9px] text-gray-500 mt-0.5">{agentStyle.framework}</span>
                )}
              </div>
            </div>

            <span className="text-gray-700 text-sm flex-1 min-w-0 break-words" title={args.task}>
              {truncateTask(args.task)}
            </span>
          </div>
        </div>
      );
    };
```
```tsx title="components/a2a/MessageToA2A.tsx"
    import React from "react";
    import { getAgentStyle } from "./agent-styles";

    type MessageActionRenderProps = {
      status: string;
      args: {
        agentName?: string;
      };
    };

    export const MessageFromA2A: React.FC<MessageActionRenderProps> = ({ status, args }) => {
      switch (status) {
        case "complete":
          break;
        default:
          return null;
      }

      if (!args.agentName) {
        return null;
      }

      const agentStyle = getAgentStyle(args.agentName);

      return (
        <div className="my-2">
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 min-w-[200px] flex-shrink-0">
                <div className="flex flex-col items-center">
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-semibold border-2 ${agentStyle.bgColor} ${agentStyle.textColor} ${agentStyle.borderColor} flex items-center gap-1`}
                  >
                    <span>{agentStyle.icon}</span>
                    <span>{args.agentName}</span>
                  </span>
                  {agentStyle.framework && (
                    <span className="text-[9px] text-gray-500 mt-0.5">{agentStyle.framework}</span>
                  )}
                </div>

                <span className="text-gray-400 text-sm">→</span>

                <div className="flex flex-col items-center">
                  <span className="px-3 py-1 rounded-full text-xs font-semibold bg-gray-700 text-white">
                    Orchestrator
                  </span>
                  <span className="text-[9px] text-gray-500 mt-0.5">ADK</span>
                </div>
              </div>

              <span className="text-xs text-gray-600">✓ Response received</span>
            </div>
          </div>
        </div>
      );
    };
```
