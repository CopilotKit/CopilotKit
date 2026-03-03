# Microsoft Agent Framework Integration

CopilotKit implementation guide for Microsoft Agent Framework.

## Guidance
### AG-UI
- Route: `/microsoft-agent-framework/ag-ui`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/ag-ui.mdx`
- Description: The AG-UI protocol connects your frontend to your AI agents via event-based Server-Sent Events (SSE).

CopilotKit is built on the [AG-UI protocol](https://ag-ui.com) — a lightweight, event-based standard that defines how AI agents communicate with user-facing applications over Server-Sent Events (SSE).

Everything in CopilotKit — messages, state updates, tool calls, and more — flows through AG-UI events. Understanding this layer helps you debug, extend, and build on top of CopilotKit more effectively.

## Accessing Your Agent with `useAgent`

The `useAgent` hook is your primary interface to the AG-UI agent powering your copilot. It returns an [`AbstractAgent`](https://github.com/ag-ui-protocol/ag-ui/blob/main/typescript/packages/client/src/agents/abstract-agent.ts) from the AG-UI client library — the same base type that all AG-UI agents implement.

```tsx
import { useAgent } from "@copilotkit/react-core";

function MyComponent() {
  const { agent } = useAgent();

  // agent.messages - conversation history
  // agent.state - current agent state
  // agent.isRunning - whether the agent is currently running
}
```

If you have multiple agents, pass the `agentId` to select one:

```tsx
const { agent } = useAgent({ agentId: "research-agent" });
```

The returned `agent` is a standard AG-UI `AbstractAgent`. You can subscribe to its events, read its state, and interact with it using the same interface defined by the [AG-UI specification](https://docs.ag-ui.com).

### Subscribing to AG-UI Events

Every agent exposes a `subscribe` method that lets you listen for specific AG-UI events as they stream in. Each callback receives the event and the current agent state:

```tsx
import { useAgent } from "@copilotkit/react-core";
import { useEffect } from "react";

function MyComponent() {
  const { agent } = useAgent();

  useEffect(() => {
    const subscription = agent.subscribe({
      // Called on every event
      onEvent({ event, agent }) {
        console.log("Event:", event.type, event);
      },

      // Text message streaming
      onTextMessageContentEvent({ event, textMessageBuffer, agent }) {
        console.log("Streaming text:", textMessageBuffer);
      },

      // Tool calls
      onToolCallEndEvent({ event, toolCallName, toolCallArgs, agent }) {
        console.log("Tool called:", toolCallName, toolCallArgs);
      },

      // State updates
      onStateSnapshotEvent({ event, agent }) {
        console.log("State snapshot:", agent.state);
      },

      // High-level lifecycle
      onMessagesChanged({ agent }) {
        console.log("Messages updated:", agent.messages);
      },
      onStateChanged({ agent }) {
        console.log("State changed:", agent.state);
      },
    });

    return () => subscription.unsubscribe();
  }, [agent]);
}
```

The full list of subscribable events maps directly to the [AG-UI event types](https://docs.ag-ui.com/concepts/events):

| Event | Callback | Description |
| --- | --- | --- |
| Run lifecycle | `onRunStartedEvent`, `onRunFinishedEvent`, `onRunErrorEvent` | Agent run start, completion, and errors |
| Steps | `onStepStartedEvent`, `onStepFinishedEvent` | Individual step boundaries within a run |
| Text messages | `onTextMessageStartEvent`, `onTextMessageContentEvent`, `onTextMessageEndEvent` | Streaming text content from the agent |
| Tool calls | `onToolCallStartEvent`, `onToolCallArgsEvent`, `onToolCallEndEvent`, `onToolCallResultEvent` | Tool invocation lifecycle |
| State | `onStateSnapshotEvent`, `onStateDeltaEvent` | Full state snapshots and incremental deltas |
| Messages | `onMessagesSnapshotEvent` | Full message list snapshots |
| Custom | `onCustomEvent`, `onRawEvent` | Custom and raw events for extensibility |
| High-level | `onMessagesChanged`, `onStateChanged` | Aggregate notifications after any message or state mutation |

## The Proxy Pattern

When you use CopilotKit with a runtime, your frontend never talks directly to your agent. Instead, CopilotKit creates a **proxy agent** on the frontend that forwards requests through the Copilot Runtime.

On startup, CopilotKit calls the runtime's `/info` endpoint to discover which agents are available. Each agent is wrapped in a `ProxiedCopilotRuntimeAgent` — a thin client that extends AG-UI's [`HttpAgent`](https://github.com/ag-ui-protocol/ag-ui/blob/main/typescript/packages/client/src/agents/http-agent.ts). From your component's perspective, this proxy behaves identically to a local AG-UI agent: same `AbstractAgent` interface, same subscribe API, same properties. But under the hood, every `run` call is an HTTP request to your server, and every response is an SSE stream of AG-UI events flowing back.

```tsx title="What your component sees"
const { agent } = useAgent(); // Returns an AbstractAgent
agent.messages;               // Read messages
agent.state;                  // Read state
agent.subscribe({ ... });     // Subscribe to events
```

```tsx title="What actually happens"
// useAgent() → AgentRegistry checks /info → wraps each agent in ProxiedCopilotRuntimeAgent
// agent.runAgent() → HTTP POST to runtime → runtime routes to your agent → SSE stream back
```

This indirection is what enables the runtime to provide authentication, middleware, agent routing, and ecosystem features like [threads](/premium/threads) and [observability](/premium/observability) — without changing how you interact with agents on the frontend.

## How Agents Slot into the Runtime

On the server side, the `CopilotRuntime` accepts a map of AG-UI `AbstractAgent` instances. Each agent framework provides its own implementation, but they all extend the same base type:

```ts title="app/api/copilotkit/route.ts"
import { CopilotRuntime, copilotRuntimeNextJSAppRouterEndpoint } from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const runtime = new CopilotRuntime({
  agents: {
    "my-agent": new HttpAgent({
      url: "https://my-agent-server.example.com",
    }),
  },
});

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    endpoint: "/api/copilotkit",
  });
  return handleRequest(req);
};
```

When a request comes in:

1. The runtime resolves the target agent by ID
2. It clones the agent (for thread safety) and sets messages, state, and thread context from the request
3. The `AgentRunner` executes the agent, which produces a stream of AG-UI `BaseEvent`s
4. Events are encoded as SSE and streamed back to the frontend proxy

Because every agent is an `AbstractAgent`, you can register any AG-UI-compatible agent — whether it's an `HttpAgent` pointing at a remote server, a framework-specific adapter, or a custom implementation — and the runtime handles routing, middleware, and delivery uniformly.

### Readables
- Route: `/microsoft-agent-framework/agent-app-context`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/agent-app-context.mdx`
- Description: Share app specific context with your agent.

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
```csharp title="Program.cs"
            using System.Runtime.CompilerServices;
            using System.Text;
            using Azure.AI.OpenAI;
            using Azure.Identity;
            using Microsoft.Agents.AI;
            using Microsoft.Agents.AI.Hosting.AGUI.AspNetCore;
            using Microsoft.AspNetCore.Builder;
            using Microsoft.Extensions.AI;

            var builder = WebApplication.CreateBuilder(args);
            builder.Services.AddAGUI();
            var app = builder.Build();

            string endpoint = builder.Configuration["AZURE_OPENAI_ENDPOINT"]!;
            string deployment = builder.Configuration["AZURE_OPENAI_DEPLOYMENT_NAME"]!;

            // Create the base agent
            AIAgent baseAgent = new AzureOpenAIClient(new Uri(endpoint), new DefaultAzureCredential())
                .GetChatClient(deployment)
                .CreateAIAgent(
                    name: "AGUIAssistant",
                    instructions: "You are a helpful assistant. Use the provided context about colleagues to answer questions.");

            // Wrap the agent with middleware to inject context
            AIAgent agent = baseAgent
                .AsBuilder()
                .Use(runFunc: null, runStreamingFunc: InjectContextMiddleware)
                .Build();

            // Map the AG-UI endpoint
            app.MapAGUI("/", agent);
            await app.RunAsync();

            // Middleware to inject useCopilotReadable context as a system message
            async IAsyncEnumerable<AgentRunResponseUpdate> InjectContextMiddleware(
                IEnumerable<ChatMessage> messages,
                AgentThread? thread,
                AgentRunOptions? options,
                AIAgent innerAgent,
                CancellationToken cancellationToken)
            {
                // Extract context from AG-UI additional properties and inject if present
                if (options is ChatClientAgentRunOptions { ChatOptions.AdditionalProperties: { } properties } &&
                    properties.TryGetValue("ag_ui_context", out KeyValuePair<string, string>[]? context) &&
                    context?.Length > 0)
                {
                    var contextBuilder = new StringBuilder();
                    contextBuilder.AppendLine("The following context from the user's application is available:");
                    foreach (var item in context)
                    {
                        contextBuilder.AppendLine($"- {item.Key}: {item.Value}");
                    }

                    var contextMessage = new ChatMessage(
                        ChatRole.System,
                        [new TextContent(contextBuilder.ToString())]);

                    messages = messages.Append(contextMessage);
                }

                await foreach (var update in innerAgent.RunStreamingAsync(messages, thread, options, cancellationToken))
                {
                    yield return update;
                }
            }
```
```python title="agent/src/agent.py"

            from agent_framework import ChatAgent, ChatClientProtocol
            from agent_framework.ag_ui import AgentFrameworkAgent

            def create_agent(chat_client: ChatClientProtocol) -> AgentFrameworkAgent:
                """
                Minimal agent for agent app context demo (frontend context is forwarded automatically).
                """
                base_agent = ChatAgent(
                    name="sample_agent",
                    instructions="You are a helpful assistant.",
                    chat_client=chat_client,
                )

                return AgentFrameworkAgent(
                    agent=base_agent,
                    name="CopilotKitMicrosoftAgentFrameworkAgent",
                    description="Assistant using app context forwarded from the frontend.",
                    require_confirmation=False,
                )
```

### Authentication
- Route: `/microsoft-agent-framework/auth`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/auth.mdx`
- Description: Secure your Microsoft Agent Framework agents with user authentication

## Overview

Forward user authentication from your frontend to your AG-UI server:

- **Frontend**: Pass tokens via ``
- **Backend**: Validate tokens using ASP.NET Core authentication middleware

## Frontend Setup

Pass your authentication token via the `headers` prop:

```tsx
<CopilotKit
  runtimeUrl="/api/copilotkit"
  headers={{
    Authorization: `Bearer ${userToken}`,
  }}
>
  <YourApp />
</CopilotKit>
```

## Backend Setup

Configure authentication in your AG-UI server:

```csharp title="Program.cs"
    using Microsoft.Agents.AI;
    using Microsoft.Agents.AI.Hosting.AGUI.AspNetCore;
    using Microsoft.AspNetCore.Authentication.JwtBearer;
    using OpenAI;

    var builder = WebApplication.CreateBuilder(args);

    // Configure JWT authentication
    builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
        .AddJwtBearer(options =>
        {
            options.Authority = builder.Configuration["JwtAuthority"];
            options.Audience = builder.Configuration["JwtAudience"];
            options.TokenValidationParameters = new Microsoft.IdentityModel.Tokens.TokenValidationParameters
            {
                ValidateIssuer = true,
                ValidateAudience = true,
                ValidateLifetime = true,
                ValidateIssuerSigningKey = true
            };
        });

    builder.Services.AddAuthorization();

    var app = builder.Build();

    app.UseAuthentication();
    app.UseAuthorization();

    // Create and map your agent
    string githubToken = builder.Configuration["GitHubToken"]!;
    var openAI = new OpenAIClient(
        new System.ClientModel.ApiKeyCredential(githubToken),
        new OpenAIClientOptions { Endpoint = new Uri("https://models.inference.ai.azure.com") }
    );
    var agent = openAI.GetChatClient("gpt-5.2-mini")
        .CreateAIAgent(name: "AGUIAssistant", instructions: "You are a helpful assistant.");

    app.MapAGUI("/", agent).RequireAuthorization();

    await app.RunAsync();
```
```python title="agent/src/main.py (excerpt)"
    from __future__ import annotations
    import os
    from fastapi import FastAPI, HTTPException, Request, status
    from fastapi.middleware.cors import CORSMiddleware
    from agent_framework import ChatClientProtocol
    from agent_framework.azure import AzureOpenAIChatClient
    from agent_framework.openai import OpenAIChatClient
    from azure.identity import DefaultAzureCredential
    from agent_framework.ag_ui import add_agent_framework_fastapi_endpoint
    from agent import create_agent

    app = FastAPI(title="CopilotKit + Microsoft Agent Framework (Python)")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    REQUIRED_BEARER_TOKEN = os.getenv("AUTH_BEARER_TOKEN")

    @app.middleware("http")
    async def auth_middleware(request: Request, call_next):
        # Protect the AG-UI endpoint if a token is configured
        if REQUIRED_BEARER_TOKEN and request.url.path == "/":
            auth_header = request.headers.get("Authorization", "")
            if not auth_header.startswith("Bearer "):
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
            token = auth_header.split(" ", 1)[1].strip()
            if token != REQUIRED_BEARER_TOKEN:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        return await call_next(request)

    # Build a chat client (same pattern as the Quickstart)
    def _build_chat_client() -> ChatClientProtocol:
        if bool(os.getenv("AZURE_OPENAI_ENDPOINT")):
            deployment_name = os.getenv("AZURE_OPENAI_CHAT_DEPLOYMENT_NAME", "gpt-5.2-mini")
            return AzureOpenAIChatClient(
                credential=DefaultAzureCredential(),
                deployment_name=deployment_name,
                endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
            )
        if bool(os.getenv("OPENAI_API_KEY")):
            return OpenAIChatClient(
                model_id=os.getenv("OPENAI_CHAT_MODEL_ID", "gpt-5.2-mini"),
                api_key=os.getenv("OPENAI_API_KEY"),
            )
        raise RuntimeError("Set AZURE_OPENAI_* or OPENAI_API_KEY in agent/.env")

    chat_client = _build_chat_client()
    my_agent = create_agent(chat_client)
    add_agent_framework_fastapi_endpoint(app=app, agent=my_agent, path="/")
```

### Configuration

Add settings to your server configuration:

```json title="appsettings.json"
    {
      "JwtAuthority": "https://login.microsoftonline.com/{your-tenant-id}/v2.0",
      "JwtAudience": "api://{your-client-id}",
      "GitHubToken": "your-github-token-here"
    }
```
```bash title="agent/.env"
    # Simple shared-secret example for demo purposes
    AUTH_BEARER_TOKEN=super-secret-demo-token
```

### CORS (if needed)

If your frontend and backend are on different origins:

```csharp title="Program.cs"
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins("http://localhost:3000")
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();
    });
});

// ...

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
```

## Security Best Practices

- Validate tokens on every request
- Scope data access to authenticated users
- Implement role-based access control in your agents
- Use HTTPS in production

  Examples that validate a bearer token against a single shared secret (e.g., an environment variable) are for local demos only.
  For production, use proper authentication:
  - .NET: Validate JWTs with `Microsoft.AspNetCore.Authentication.JwtBearer` (as shown above), backed by your IdP (e.g., Entra ID).
  - Python: Use OAuth 2.0 / OpenID Connect JWT validation or an API gateway that validates tokens before requests reach your AG‑UI server.

## Troubleshooting

**Token not reaching server**: Verify the `Authorization` header is set in `` and forwarded through any proxies.

**Invalid token**: Ensure the token includes the `Bearer ` prefix.

**CORS errors**: Configure CORS if frontend and backend are on different origins (see [CORS section](#cors-if-needed)).

For more details, see [Microsoft's JWT authentication guide](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/configure-jwt-bearer-authentication).

### Coding Agents
- Route: `/microsoft-agent-framework/coding-agents`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/coding-agents.mdx`
- Description: Use our MCP server to connect your Microsoft Agent Framework agents to CopilotKit.

## Overview
The CopilotKit MCP server equips AI coding agents with deep knowledge about CopilotKit's APIs, patterns, and best practices. When connected to your
development environment, it enables AI assistants to:
- Provide expert guidance
- Generate accurate code
- Give your AI agents a user interface
- Help you implement CopilotKit features correctly

Powered by 🪄 [Tadata](https://tadata.com) - The platform for instantly building and hosting MCP servers.

## GitHub Copilot

[GitHub Copilot](https://github.com/features/copilot) is Microsoft's AI pair programmer integrated into VS Code and other editors. It supports MCP to extend its capabilities with external tools and services.

    ### Enable MCP Support in VS Code
    1. Open VS Code Settings (`Cmd+,` on Mac or `Ctrl+,` on Windows/Linux)
    2. Search for "MCP" in the settings search bar
    3. Enable the `chat.mcp.enabled` setting
    ### Add MCP Server to GitHub Copilot
    You can configure MCP servers for GitHub Copilot in several ways:

        Create a `.vscode/mcp.json` file in your project root:
```json
        {
          "servers": {
            "CopilotKit MCP": {
              "url": "https://mcp.copilotkit.ai/sse"
            }
          }
        }
```
        Add to your VS Code `settings.json`:
```json
        {
          "mcp": {
            "servers": {
              "CopilotKit MCP": {
                "url": "https://mcp.copilotkit.ai/sse"
              }
            }
          }
        }
```
        1. Open the Command Palette (`Cmd+Shift+P` or `Ctrl+Shift+P`)
        2. Type "MCP: Add Server" and select the command
        3. Choose "HTTP (sse)" as the server type
        4. Enter the server URL: `https://mcp.copilotkit.ai/sse`
        5. Provide a name for the server: `CopilotKit MCP`
    ### Using MCP Tools with GitHub Copilot
    1. Open Copilot Chat in VS Code (click the Copilot icon in the activity bar)
    2. Switch to Agent mode from the chat dropdown menu
    3. Click the Tools (🔧) button to view available MCP tools
    4. Your CopilotKit MCP tools will be listed and can be used automatically

    GitHub Copilot will intelligently use the MCP tools when relevant to your queries. You can also reference tools directly using `#` followed by the tool name.
    ### Managing MCP Servers
    Use the "MCP: List Servers" command to view and manage your configured servers:

    - Start/Stop/Restart servers
    - View server logs for debugging
    - Browse available tools and resources

## Other

For MCP-compatible applications not listed above, use these universal integration patterns. MCP (Model Context Protocol) is an open standard that allows AI applications to connect with external tools and data sources.

### Connection Methods

Most MCP-compatible applications support one or both of these connection methods:

    For web-based or remote integrations:
```
    https://mcp.copilotkit.ai/sse
```
    For local command-line integrations:
```json
    {
      "command": "npx",
      "args": ["mcp-remote", "https://mcp.copilotkit.ai"]
    }
```

### Integration Steps

1. **Find MCP Settings** - Look for "MCP," "Model Context Protocol," or "Tools" in your application settings
2. **Add Server** - Use the SSE URL: `https://mcp.copilotkit.ai/sse`
3. **Test Connection** - Restart your application and verify the server appears in available tools

### Common Configuration Patterns

    Many applications use a configuration file (locations vary by app):
```json
    {
      "servers": {
        "CopilotKit MCP": {
          "url": "https://mcp.copilotkit.ai/sse"
        }
      }
    }
```
    Some apps integrate MCP into their main settings:
```json
    {
      "mcp": {
        "enabled": true,
        "servers": {
          "CopilotKit MCP": {
            "url": "https://mcp.copilotkit.ai/sse"
          }
        }
      }
    }
```

### Copilot Runtime
- Route: `/microsoft-agent-framework/copilot-runtime`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/copilot-runtime.mdx`
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

### Fully Headless UI
- Route: `/microsoft-agent-framework/custom-look-and-feel/headless-ui`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/custom-look-and-feel/headless-ui.mdx`
- Description: Fully customize your Copilot's UI from the ground up using headless UI

```bash
    npx copilotkit@latest create
```
```bash
    open README.md
```
```tsx title="src/app/layout.tsx"
    <CopilotKit
      publicLicenseKey="your-free-public-license-key"
    >
      {children}
    </CopilotKit>
```
```tsx title="src/app/page.tsx"
    "use client";
    import { useState } from "react";
    import { useCopilotChatHeadless_c } from "@copilotkit/react-core/v2"; // [!code highlight]

    export default function Home() {
      const { messages, sendMessage, isLoading } = useCopilotChatHeadless_c(); // [!code highlight]
      const [input, setInput] = useState("");

      const handleSend = () => {
        if (input.trim()) {
          // [!code highlight:5]
          sendMessage({
            id: Date.now().toString(),
            role: "user",
            content: input,
          });
          setInput("");
        }
      };

      return (
        <div>
          <h1>My Headless Chat</h1>

          {/* Messages */}
          <div>
            {/* [!code highlight:6] */}
            {messages.map((message) => (
              <div key={message.id}>
                <strong>{message.role === "user" ? "You" : "Assistant"}:</strong>
                <p>{message.content}</p>
              </div>
            ))}

            {/* [!code highlight:1] */}
            {isLoading && <p>Assistant is typing...</p>}
          </div>

          {/* Input */}
          <div>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              // [!code highlight:1]
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="Type your message here..."
            />
            {/* [!code highlight:1] */}
            <button onClick={handleSend} disabled={isLoading}>
              Send
            </button>
          </div>
        </div>
      );
    }
```
```tsx title="src/app/components/chat.tsx"
import { useFrontendTool } from "@copilotkit/react-core/v2";

export const Chat = () => {
  // ...

  // Define an action that will show a custom component
  useFrontendTool({
    name: "showCustomComponent",
    // Handle the tool on the frontend
    // [!code highlight:3]
    handler: () => {
      return "Foo, Bar, Baz";
    },
    // Render a custom component for the underlying data
    // [!code highlight:13]
    render: ({ result, args, status}) => {
      return <div style={{
        backgroundColor: "red",
        padding: "10px",
        borderRadius: "5px",
      }}>
        <p>Custom component</p>
        <p>Result: {result}</p>
        <p>Args: {JSON.stringify(args)}</p>
        <p>Status: {status}</p>
      </div>;
    }
  });

  // ...

  return <div>
    {messages.map((message) => (
      <p key={message.id}>
        {message.role === "user" ? "User: " : "Assistant: "}
        {message.content}
        {/* Render the generative UI if it exists */}
        {/* [!code highlight:1] */}
        {message.role === "assistant" && message.generativeUI?.()}
      </p>
    ))}
  </div>
};
```
```tsx title="src/app/components/chat.tsx"
export const Chat = () => {
  // ...

  return <div>
    {messages.map((message) => (
      <p key={message.id}>
        {/* Render the tool calls if they exist */}
        {/* [!code highlight:5] */}
        {message.role === "assistant" && message.toolCalls?.map((toolCall) => (
          <p key={toolCall.id}>
            {toolCall.function.name}: {toolCall.function.arguments}
          </p>
        ))}
      </p>
    ))}
  </div>
};
```
```tsx title="src/app/components/chat.tsx"
import { useCopilotChatHeadless_c, useCopilotChatSuggestions } from "@copilotkit/react-core/v2"; // [!code highlight]

export const Chat = () => {
  // Specify what suggestions should be generated
  // [!code highlight:5]
  useCopilotChatSuggestions({
    instructions:
      "Suggest 5 interesting activities for programmers to do on their next vacation",
    maxSuggestions: 5,
  });

  // Grab relevant state from the headless hook
  const { suggestions, generateSuggestions, sendMessage } = useCopilotChatHeadless_c(); // [!code highlight]

  // Generate suggestions when the component mounts
  useEffect(() => {
    generateSuggestions(); // [!code highlight]
  }, []);

  // ...

  // [!code word:suggestion]
  return <div>
    {suggestions.map((suggestion, index) => (
      <button
        key={index}
        onClick={() => sendMessage({
          id: "123",
          role: "user",
          content: suggestion.message
        })}
      >
        {suggestion.title}
      </button>
    ))}
  </div>
};
```
```tsx title="src/app/components/chat.tsx"
import { useCopilotChatHeadless_c } from "@copilotkit/react-core/v2";

export const Chat = () => {
  // Grab relevant state from the headless hook
  // [!code highlight:1]
  const { suggestions, setSuggestions } = useCopilotChatHeadless_c();

  // Set the suggestions when the component mounts
  // [!code highlight:6]
  useEffect(() => {
    setSuggestions([
      { title: "Suggestion 1", message: "The actual message for suggestion 1" },
      { title: "Suggestion 2", message: "The actual message for suggestion 2" },
    ]);
  }, []);

  // Change the suggestions on function call
  const changeSuggestions = () => {
    // [!code highlight:4]
    setSuggestions([
      { title: "Foo", message: "Bar" },
      { title: "Baz", message: "Bat" },
    ]);
  };

  // [!code word:suggestion]
  return (
    <div>
      {/* Change on button click */}
      <button onClick={changeSuggestions}>Change suggestions</button>

      {/* Render */}
      {suggestions.map((suggestion, index) => (
        <button
          key={index}
          onClick={() => sendMessage({
            id: "123",
            role: "user",
            content: suggestion.message
          })}
        >
          {suggestion.title}
        </button>
      ))}
    </div>
  );
};
```
```tsx title="src/app/components/chat.tsx"
import { useFrontendTool, useCopilotChatHeadless_c } from "@copilotkit/react-core/v2";

export const Chat = () => {
  const { messages, sendMessage } = useCopilotChatHeadless_c();

  // Define an action that will wait for the user to enter their name
  useFrontendTool({
    name: "getName",
    renderAndWaitForResponse: ({ respond, args, status}) => {
      if (status === "complete") {
        return <div>
          <p>Name retrieved...</p>
        </div>;
      }

      return <div>
        <input
          type="text"
          value={args.name || ""}
          onChange={(e) => respond?.(e.target.value)}
          placeholder="Enter your name"
        />
        {/* Respond with the name */}
        {/* [!code highlight:1] */}
        <button onClick={() => respond?.(args.name)}>Submit</button>
      </div>;
    }
  });

  return (
    {messages.map((message) => (
      <p key={message.id}>
        {message.role === "user" ? "User: " : "Assistant: "}
        {message.content}
        {/* [!code highlight:2] */}
        {/* This will render the tool-based HITL if it exists */}
        {message.role === "assistant" && message.generativeUI?.()}
      </p>
    ))}
  )
};
```

### Human-in-the-Loop with Headless UI

For human-in-the-loop interactions with custom UI, use `useHumanInTheLoop` to create approval workflows:

```tsx title="src/app/components/chat.tsx"
import { useHumanInTheLoop, useCopilotChatHeadless_c } from "@copilotkit/react-core/v2";

export const Chat = () => {
  const { messages, sendMessage } = useCopilotChatHeadless_c();

  useHumanInTheLoop({
    name: "approvalRequired",
    description: "Request user approval for an operation",
    parameters: [
      { name: "operation", type: "string", description: "The operation to approve", required: true }
    ],
    render: ({ args, respond }) => {
      if (!respond) return null;

      return (
        <div>
          <p>Approval Required</p>
          <p>Operation: {args.operation}</p>
          <button onClick={() => respond("APPROVED")}>Approve</button>
          <button onClick={() => respond("REJECTED")}>Reject</button>
        </div>
      );
    },
  });

  return (
    <div>
      {/* Your custom chat UI */}
    </div>
  )
};
```

See [Human-in-the-Loop](/microsoft-agent-framework/human-in-the-loop) for more details on approval workflows.

### Slots
- Route: `/microsoft-agent-framework/custom-look-and-feel/slots`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/custom-look-and-feel/slots.mdx`
- Description: Customize any part of the chat UI by overriding individual sub-components via slots.

## What is this?

Every CopilotKit chat component is built from composable **slots** — named sub-components that you can override individually. The slot system gives you three levels of customization without needing to rebuild the entire UI:

1. **Tailwind classes** — pass a string to add/override CSS classes
2. **Props override** — pass an object to override specific props on the default component
3. **Custom component** — pass your own React component to fully replace a slot

Slots are recursive — you can drill into nested sub-components at any depth.

## Tailwind Classes

The simplest way to customize a slot. Pass a Tailwind class string and it will be merged with the default component's classes.

```tsx title="page.tsx"
import { CopilotChat } from "@copilotkit/react-core/v2";

export function Chat() {
  return (
    <CopilotChat
      // [!code highlight:2]
      messageView="bg-gray-50 dark:bg-gray-900 p-4"
      input="border-2 border-blue-400 rounded-xl"
    />
  );
}
```

## Props Override

Pass an object to override specific props on the default component. This is useful for adding `className`, event handlers, data attributes, or any other prop the default component accepts.

```tsx title="page.tsx"
<CopilotChat
  // [!code highlight:4]
  messageView={{
    className: "my-custom-messages",
    "data-testid": "message-view",
  }}
  input={{ autoFocus: true }}
/>
```

## Custom Components

For full control, pass your own React component. It receives all the same props as the default component.

```tsx title="page.tsx"
import { CopilotChat } from "@copilotkit/react-core/v2";

// [!code highlight:8]
const CustomMessageView = ({ messages, isRunning }) => (
  <div className="space-y-4 p-6">
    {messages?.map((msg) => (
      <div key={msg.id} className={msg.role === "user" ? "text-right" : "text-left"}>
        {msg.content}
      </div>
    ))}
    {isRunning && <div className="animate-pulse">Thinking...</div>}
  </div>
);

export function Chat() {
  return (
    // [!code highlight:1]
    <CopilotChat messageView={CustomMessageView} />
  );
}
```

## Nested Slots (Drill-Down)

Slots are recursive. You can customize sub-components at any depth by nesting objects.

### Two levels deep

Override the assistant message's toolbar within the message view:

```tsx title="page.tsx"
<CopilotChat
  // [!code highlight:7]
  messageView={{
    assistantMessage: {
      toolbar: CustomToolbar,
      copyButton: CustomCopyButton,
    },
    userMessage: CustomUserMessage,
  }}
/>
```

### Three levels deep

Override a specific button inside the assistant message toolbar:

```tsx title="page.tsx"
<CopilotChat
  messageView={{
    // [!code highlight:5]
    assistantMessage: {
      copyButton: ({ onClick }) => (
        <button onClick={onClick}>Copy</button>
      ),
    },
  }}
/>
```

### Input sub-slots

```tsx title="page.tsx"
<CopilotChat
  input={{
    // [!code highlight:2]
    textArea: CustomTextArea,
    sendButton: CustomSendButton,
  }}
/>
```

### Scroll view sub-slots

```tsx title="page.tsx"
<CopilotChat
  scrollView={{
    // [!code highlight:2]
    feather: CustomFeather,
    scrollToBottomButton: CustomScrollButton,
  }}
/>
```

### Suggestion view sub-slots

```tsx title="page.tsx"
<CopilotChat
  suggestionView={{
    // [!code highlight:2]
    suggestion: CustomSuggestionPill,
    container: CustomSuggestionContainer,
  }}
/>
```

## Children Render Function

For complete layout control, use the `children` render function pattern. This gives you pre-built slot elements that you can arrange however you want.

```tsx title="page.tsx"
import { CopilotChat } from "@copilotkit/react-core/v2";

export function Chat() {
  return (
    <CopilotChat>
      {/* [!code highlight:8] */}
      {({ messageView, input, scrollView, suggestionView }) => (
        <div className="flex flex-col h-full">
          <header className="p-4 border-b font-semibold">My Agent</header>
          {scrollView}
          <div className="border-t p-4">{input}</div>
        </div>
      )}
    </CopilotChat>
  );
}
```

## Labels

Customize any text string in the UI via the `labels` prop. This does not use the slot system — it's a separate convenience prop on `CopilotChat`, `CopilotSidebar`, and `CopilotPopup`.

```tsx title="page.tsx"
<CopilotChat
  // [!code highlight:5]
  labels={{
    chatInputPlaceholder: "Ask your agent anything...",
    welcomeMessageText: "How can I help you today?",
    chatDisclaimerText: "AI responses may be inaccurate.",
  }}
/>
```

## Available Slots

### `CopilotChat` / `CopilotSidebar` / `CopilotPopup`

These are the root-level slot props available on all chat components:

| Slot | Description |
|------|-------------|
| `messageView` | The message list container. |
| `scrollView` | The scroll container with auto-scroll behavior. |
| `input` | The text input area with send/transcribe controls. |
| `suggestionView` | The suggestion pills shown below messages. |
| `welcomeScreen` | The initial empty-state screen (pass `false` to disable). |

`CopilotSidebar` and `CopilotPopup` also have:

| Slot | Description |
|------|-------------|
| `header` | The modal header bar. |
| `toggleButton` | The open/close toggle button. |

### `messageView` sub-slots

Available via `messageView={{ ... }}`:

| Slot | Description |
|------|-------------|
| `assistantMessage` | Renders assistant responses. Has its own sub-slots (see below). |
| `userMessage` | Renders user messages. Has its own sub-slots (see below). |
| `reasoningMessage` | Renders model reasoning/thinking steps. Has its own sub-slots (see below). |
| `cursor` | The streaming cursor indicator shown while the agent is responding. |

### `assistantMessage` sub-slots

Available via `messageView={{ assistantMessage: { ... } }}`:

| Slot | Description |
|------|-------------|
| `markdownRenderer` | The markdown rendering component. |
| `toolbar` | The action toolbar below messages. |
| `copyButton` | Copy message button. |
| `thumbsUpButton` | Thumbs up feedback button. |
| `thumbsDownButton` | Thumbs down feedback button. |
| `readAloudButton` | Read aloud button. |
| `regenerateButton` | Regenerate response button. |
| `toolCallsView` | Tool call visualization. |

### `userMessage` sub-slots

Available via `messageView={{ userMessage: { ... } }}`:

| Slot | Description |
|------|-------------|
| `messageRenderer` | The text rendering component for user messages. |
| `toolbar` | The action toolbar on hover. |
| `copyButton` | Copy message button. |
| `editButton` | Edit message button. |
| `branchNavigation` | Navigation between message branches (after editing). |

### `reasoningMessage` sub-slots

Available via `messageView={{ reasoningMessage: { ... } }}`:

| Slot | Description |
|------|-------------|
| `header` | The collapsible header (click to expand/collapse). |
| `contentView` | The reasoning content area. |
| `toggle` | The expand/collapse toggle wrapper. |

### `input` sub-slots

Available via `input={{ ... }}`:

| Slot | Description |
|------|-------------|
| `textArea` | The text input element. |
| `sendButton` | The send/submit button. |
| `addMenuButton` | The attachment/tools menu button. |
| `startTranscribeButton` | Button to start voice transcription. |
| `cancelTranscribeButton` | Button to cancel transcription. |
| `finishTranscribeButton` | Button to finish transcription. |
| `audioRecorder` | The audio recorder component. |
| `disclaimer` | The disclaimer text below the input. |

### `scrollView` sub-slots

Available via `scrollView={{ ... }}`:

| Slot | Description |
|------|-------------|
| `feather` | The gradient overlay at the bottom of the scroll area. |
| `scrollToBottomButton` | The button that appears when scrolled up. |

### `suggestionView` sub-slots

Available via `suggestionView={{ ... }}`:

| Slot | Description |
|------|-------------|
| `suggestion` | Individual suggestion pill/button. |
| `container` | The container wrapping all suggestion pills. |

### `welcomeScreen` sub-slots

Available via `welcomeScreen={{ ... }}`:

| Slot | Description |
|------|-------------|
| `welcomeMessage` | The welcome text shown on the empty state. |

### `header` sub-slots (Sidebar/Popup only)

Available via `header={{ ... }}`:

| Slot | Description |
|------|-------------|
| `titleContent` | The title text in the header. |
| `closeButton` | The close/minimize button. |

### `toggleButton` sub-slots (Sidebar/Popup only)

Available via `toggleButton={{ ... }}`:

| Slot | Description |
|------|-------------|
| `openIcon` | Icon shown when the chat is closed. |
| `closeIcon` | Icon shown when the chat is open. |

### Frontend Tools
- Route: `/microsoft-agent-framework/frontend-tools`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/frontend-tools.mdx`
- Description: Create frontend tools and use them within your Microsoft Agent Framework agent.

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
```csharp title="Program.cs"
            using Azure.AI.OpenAI;
            using Azure.Identity;
            using Microsoft.Agents.AI;
            using Microsoft.Agents.AI.Hosting.AGUI.AspNetCore;

            var builder = WebApplication.CreateBuilder(args);
            builder.Services.AddAGUI();
            var app = builder.Build();

            string endpoint = builder.Configuration["AZURE_OPENAI_ENDPOINT"]!;
            string deployment = builder.Configuration["AZURE_OPENAI_DEPLOYMENT_NAME"]!;

            // Create the agent
            var agent = new AzureOpenAIClient(new Uri(endpoint), new DefaultAzureCredential())
                .GetChatClient(deployment)
                .CreateAIAgent(name: "AGUIAssistant", instructions: "You are a helpful assistant.");

            // Map the AG-UI endpoint
            app.MapAGUI("/", agent);
            await app.RunAsync();
```
```python title="agent/src/byo_agent.py"
            from __future__ import annotations
            import os
            from fastapi import FastAPI
            from dotenv import load_dotenv
            from agent_framework import ChatAgent
            from agent_framework import ChatClientProtocol
            from agent_framework.azure import AzureOpenAIChatClient
            from agent_framework.openai import OpenAIChatClient
            from agent_framework.ag_ui import add_agent_framework_fastapi_endpoint
            from azure.identity import DefaultAzureCredential

            load_dotenv()

            def _build_chat_client() -> ChatClientProtocol:
                if bool(os.getenv("AZURE_OPENAI_ENDPOINT")):
                    return AzureOpenAIChatClient(
                        credential=DefaultAzureCredential(),
                        deployment_name=os.getenv("AZURE_OPENAI_CHAT_DEPLOYMENT_NAME", "gpt-5.2-mini"),
                        endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
                    )
                if bool(os.getenv("OPENAI_API_KEY")):
                    return OpenAIChatClient(
                        model_id=os.getenv("OPENAI_CHAT_MODEL_ID", "gpt-5.2-mini"),
                        api_key=os.getenv("OPENAI_API_KEY"),
                    )
                raise RuntimeError("Set AZURE_OPENAI_* or OPENAI_API_KEY in agent/.env")

            chat_client = _build_chat_client()
            agent = ChatAgent(
                name="AGUIAssistant",
                instructions="You are a helpful assistant.",
                chat_client=chat_client,
            )

            app = FastAPI(title="AG-UI Server (Python)")
            add_agent_framework_fastapi_endpoint(app=app, agent=agent, path="/")
```

### State Rendering
- Route: `/microsoft-agent-framework/generative-ui/state-rendering`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/generative-ui/state-rendering.mdx`
- Description: Render the state of your agent with custom UI components.

```csharp title="Program.cs"
        using System.Text.Json.Serialization;

        public class SearchInfo
        {
            [JsonPropertyName("query")]
            public string Query { get; set; } = string.Empty;

            [JsonPropertyName("done")]
            public bool Done { get; set; }
        }

        public class AgentStateSnapshot
        {
            [JsonPropertyName("searches")]
            public List<SearchInfo> Searches { get; set; } = new();
        }
```
```python title="agent/src/agent.py (excerpt)"
        from typing import Annotated, Dict
        from pydantic import BaseModel, Field

        class SearchItem(BaseModel):
            query: str
            done: bool

        # JSON schema used by AG-UI to validate and forward state to the frontend
        STATE_SCHEMA: Dict[str, object] = {
            "searches": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "done": {"type": "boolean"},
                    },
                    "required": ["query", "done"],
                    "additionalProperties": False,
                },
                "description": "List of searches and whether each is done.",
            }
        }
```
```tsx title="app/page.tsx"
    type SearchInfo = {
      query: string;
      done: boolean;
    };

    type AgentState = {
      searches: SearchInfo[];
    };
```
```csharp title="Program.cs"
        using System.Runtime.CompilerServices;
        using System.Text.Json;
        using Azure.AI.OpenAI;
        using Azure.Identity;
        using Microsoft.Agents.AI;
        using Microsoft.Agents.AI.Hosting.AGUI.AspNetCore;
        using Microsoft.AspNetCore.Builder;
        using Microsoft.AspNetCore.Http.Json;
        using Microsoft.Extensions.AI;
        using Microsoft.Extensions.DependencyInjection;
        using Microsoft.Extensions.Options;

        var builder = WebApplication.CreateBuilder(args);
        builder.Services.AddAGUI();
        var app = builder.Build();

        string endpoint = builder.Configuration["AZURE_OPENAI_ENDPOINT"]!;
        string deployment = builder.Configuration["AZURE_OPENAI_DEPLOYMENT_NAME"]!;

        // Get JSON serializer options
        var jsonOptions = app.Services.GetRequiredService<IOptions<JsonOptions>>();

        // Create the base agent
        AIAgent baseAgent = new AzureOpenAIClient(new Uri(endpoint), new DefaultAzureCredential())
            .GetChatClient(deployment)
            .CreateAIAgent(
                name: "ResearchAssistant",
                instructions: "You are a research assistant that tracks your progress.");

        // Wrap with state-streaming agent
        AIAgent agent = new StateStreamingAgent(baseAgent, jsonOptions.Value.SerializerOptions);

        // Map the AG-UI endpoint
        app.MapAGUI("/", agent);
        await app.RunAsync();

        // Agent wrapper that streams state updates
        internal sealed class StateStreamingAgent : DelegatingAIAgent
        {
            private readonly JsonSerializerOptions _jsonSerializerOptions;

            public StateStreamingAgent(AIAgent innerAgent, JsonSerializerOptions jsonSerializerOptions)
                : base(innerAgent)
            {
                this._jsonSerializerOptions = jsonSerializerOptions;
            }

            public override async IAsyncEnumerable<AgentRunResponseUpdate> RunStreamingAsync(
                IEnumerable<ChatMessage> messages,
                AgentThread? thread = null,
                AgentRunOptions? options = null,
                [EnumeratorCancellation] CancellationToken cancellationToken = default)
            {
                // Get current state from options if provided
                JsonElement currentState = default;
                if (options is ChatClientAgentRunOptions { ChatOptions.AdditionalProperties: { } properties } &&
                    properties.TryGetValue("ag_ui_state", out object? stateObj) && stateObj is JsonElement state)
                {
                    currentState = state;
                }

                // Create options with JSON schema for structured state output
                ChatClientAgentRunOptions stateOptions = new ChatClientAgentRunOptions
                {
                    ChatOptions = new ChatOptions
                    {
                        ResponseFormat = ChatResponseFormat.ForJsonSchema<AgentStateSnapshot>(
                            schemaName: "AgentStateSnapshot",
                            schemaDescription: "Research progress state")
                    }
                };

                // Add system message with current state
                var stateMessage = new ChatMessage(ChatRole.System,
                    $"Current state: {(currentState.ValueKind != JsonValueKind.Undefined ? currentState.GetRawText() : "{}")}");
                var messagesWithState = messages.Append(stateMessage);

                // Collect all updates
                var allUpdates = new List<AgentRunResponseUpdate>();
                await foreach (var update in this.InnerAgent.RunStreamingAsync(messagesWithState, thread, stateOptions, cancellationToken))
                {
                    allUpdates.Add(update);
                    // Stream non-text updates immediately
                    if (update.Contents.Any(c => c is not TextContent))
                    {
                        yield return update;
                    }
                }

                // Deserialize state snapshot from response
                var response = allUpdates.ToAgentRunResponse();
                if (response.TryDeserialize(this._jsonSerializerOptions, out JsonElement stateSnapshot))
                {
                    byte[] stateBytes = JsonSerializer.SerializeToUtf8Bytes(
                        stateSnapshot,
                        this._jsonSerializerOptions.GetTypeInfo(typeof(JsonElement)));

                    // Emit state snapshot as DataContent
                    yield return new AgentRunResponseUpdate
                    {
                        Contents = [new DataContent(stateBytes, "application/json")]
                    };
                }

                // Stream text summary
                var summaryMessage = new ChatMessage(ChatRole.System, "Provide a brief summary of your progress.");
                await foreach (var update in this.InnerAgent.RunStreamingAsync(
                    messages.Concat(response.Messages).Append(summaryMessage), thread, options, cancellationToken))
                {
                    yield return update;
                }
            }
        }
```
```python title="agent/src/agent.py"
        from typing import Annotated, Dict
        from agent_framework import ChatAgent, ChatClientProtocol, ai_function
        from agent_framework.ag_ui import AgentFrameworkAgent
        from pydantic import BaseModel, Field

        class SearchItem(BaseModel):
            query: str
            done: bool

        STATE_SCHEMA: Dict[str, object] = {
            "searches": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "done": {"type": "boolean"},
                    },
                    "required": ["query", "done"],
                    "additionalProperties": False,
                },
                "description": "List of searches and whether each is done.",
            }
        }

        PREDICT_STATE_CONFIG: Dict[str, Dict[str, str]] = {
            "searches": {
                "tool": "update_searches",
                "tool_argument": "searches",
            }
        }

        @ai_function(
            name="update_searches",
            description=(
                "Replace the entire list of searches with the provided values. "
                "Always include the full list you want to keep. "
                "Each search should include: { query: string, done: boolean }."
            ),
        )
        def update_searches(
            searches: Annotated[list[SearchItem], Field(description=("The complete source of truth for the user's searches. Maintain ordering and include the full list on each call."))],
        ) -> str:
            return f"Searches updated. Tracking {len(searches)} item(s)."

        def create_agent(chat_client: ChatClientProtocol) -> AgentFrameworkAgent:
            base_agent = ChatAgent(
                name="search_agent",
                instructions=(
                    "You help users create and run searches.\\n\\n"
                    "State sync rules:\\n"
                    "- Maintain a list of searches: each item has { query, done }.\\n"
                    "- When adding a new search, call `update_searches` with the FULL list, including the new item with done=true.\\n"
                    "- All searches in the list should have done=true unless explicitly in progress.\\n"
                    "- Never send partial updates—always include the full list on each call.\\n"
                ),
                chat_client=chat_client,
                tools=[update_searches],
            )

            return AgentFrameworkAgent(
                agent=base_agent,
                name="CopilotKitMicrosoftAgentFrameworkAgent",
                description="Maintains a list of searches and streams state to the UI.",
                state_schema=STATE_SCHEMA,
                predict_state_config=PREDICT_STATE_CONFIG,
                require_confirmation=False,
            )
```
```tsx title="app/page.tsx"
    import { useAgent } from "@copilotkit/react-core/v2";

    // For type safety, define the state type matching your agent's state snapshot
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
        name: "sample_agent", // the name the agent is served as
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

    // Define the state type matching your agent's state snapshot
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
        name: "sample_agent", // the name the agent is served as
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
- Route: `/microsoft-agent-framework/generative-ui/tool-rendering`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/generative-ui/tool-rendering.mdx`
- Description: Render your agent's tool calls with custom UI components.

```csharp title="Program.cs"
    using System.ComponentModel;
    using Azure.AI.OpenAI;
    using Azure.Identity;
    using Microsoft.Agents.AI;
    using Microsoft.Agents.AI.Hosting.AGUI.AspNetCore;

    var builder = WebApplication.CreateBuilder(args);
    builder.Services.AddAGUI();
    var app = builder.Build();

    string endpoint = builder.Configuration["AZURE_OPENAI_ENDPOINT"]!;
    string deployment = builder.Configuration["AZURE_OPENAI_DEPLOYMENT_NAME"]!;

    // [!code highlight:4]
    // Define the weather tool function
    [Description("Get the weather for a given location.")]
    static string GetWeather([Description("The location to get weather for")] string location)
        => $"The weather for {location} is 70 degrees.";

    // Create the agent with tools
    var agent = new AzureOpenAIClient(new Uri(endpoint), new DefaultAzureCredential())
        .GetChatClient(deployment)
        .CreateAIAgent(
            name: "AGUIAssistant",
            tools: [AIFunctionFactory.Create(GetWeather)]);

    // Map the AG-UI endpoint
    app.MapAGUI("/", agent);

    await app.RunAsync();
```
```python title="agent/src/agent.py"
    from __future__ import annotations
    from typing import Annotated
    from agent_framework import ChatAgent, ChatClientProtocol, ai_function
    from agent_framework.ag_ui import AgentFrameworkAgent
    from pydantic import Field

    # [!code highlight:9]
    @ai_function(
        name="get_weather",
        description="Get the weather for a given location.",
    )
    def get_weather(
        location: Annotated[str, Field(description="The location to get weather for")],
    ) -> str:
        normalized = location.strip() or "the requested location"
        return f"The weather for {normalized} is 70 degrees."

    def create_agent(chat_client: ChatClientProtocol) -> AgentFrameworkAgent:
        base_agent = ChatAgent(
            name="sample_agent",
            instructions="You are a helpful assistant.",
            chat_client=chat_client,
            tools=[get_weather],
        )

        return AgentFrameworkAgent(
            agent=base_agent,
            name="CopilotKitMicrosoftAgentFrameworkAgent",
            description="Assistant with a get_weather backend tool.",
            require_confirmation=False,
        )
```
```tsx title="app/page.tsx"
import { useRenderToolCall } from "@copilotkit/react-core/v2"; // [!code highlight]
// ...

const YourMainContent = () => {
  // ...
  // [!code highlight:11]
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

### Display-only
- Route: `/microsoft-agent-framework/generative-ui/your-components/display-only`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/generative-ui/your-components/display-only.mdx`
- Description: Register React components that your agent can render in the chat.

## What is this?

`useComponent` lets you register a React component as a tool your agent can invoke. When the agent calls the tool, CopilotKit renders your component directly in the chat with the tool's arguments as props.

This is the simplest form of Generative UI — your agent decides when to show a component, and CopilotKit renders it. No handler logic, no user interaction required.

## When should I use this?

Use `useComponent` when you want to:
- Display rich UI (cards, charts, tables) inline in the chat
- Show structured data from agent responses
- Render previews, status indicators, or visual feedback
- Let the agent present information beyond plain text

For components that need user interaction, see the Interactive or Interrupt-based guides.

## Register a component

Use the `useComponent` hook to register a React component. The agent will be able to call it by name, and CopilotKit will render it with the tool arguments as props.

```tsx title="app/page.tsx"
import { useComponent } from "@copilotkit/react-core/v2"; // [!code highlight]
import { z } from "zod";

const weatherSchema = z.object({
  city: z.string().describe("City name"),
  temperature: z.number().describe("Temperature in Fahrenheit"),
  condition: z.string().describe("Weather condition"),
});

function WeatherCard({ city, temperature, condition }: z.infer<typeof weatherSchema>) {
  return (
    <div className="rounded-lg border p-4">
      <h3 className="font-semibold">{city}</h3>
      <p className="text-2xl">{temperature}°F</p>
      <p className="text-sm text-gray-500">{condition}</p>
    </div>
  );
}

function YourMainContent() {
  // [!code highlight:9]
  useComponent({
    name: "showWeather",
    description: "Display a weather card for a city.",
    parameters: weatherSchema,
    render: WeatherCard,
  });

  return <div>{/* ... */}</div>;
}
```

## Without parameters

For simple components that don't need typed parameters:

```tsx
useComponent({
  name: "showGreeting",
  render: ({ message }: { message: string }) => (
    <div className="rounded border p-3 bg-blue-50">
      <p>{message}</p>
    </div>
  ),
});
```

## Scoping to an agent

In multi-agent setups, scope a component to a specific agent:

```tsx
useComponent({
  name: "renderProfile",
  parameters: z.object({ userId: z.string() }),
  render: ProfileCard,
  agentId: "support-agent",
});
```

### Interactive
- Route: `/microsoft-agent-framework/generative-ui/your-components/interactive`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/generative-ui/your-components/interactive.mdx`
- Description: Create components that your agent can use to interact with the user.

```tsx title="page.tsx"
import { useHumanInTheLoop } from "@copilotkit/react-core/v2" // [!code highlight]
import { z } from "zod";

export function Page() {
  // ...

  // [!code highlight:20]
  useHumanInTheLoop({
    name: "humanApprovedCommand",
    description: "Ask human for approval to run a command.",
    parameters: z.object({
      command: z.string().describe("The command to run"),
    }),
    render: ({ args, respond, status }) => {
      if (status !== "executing") return <></>;
      return (
        <div>
          <pre>{args.command}</pre>
          {/* [!code highlight:2] */}
          <button onClick={() => respond?.(`Command is APPROVED`)}>Approve</button>
          <button onClick={() => respond?.(`Command is DENIED`)}>Deny</button>
        </div>
      );
    },
  });

  // ...
}
```

### Human-in-the-loop
- Route: `/microsoft-agent-framework/human-in-the-loop`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/human-in-the-loop.mdx`
- Description: Create frontend tools and use them within your agent framework agent.

```tsx title="page.tsx"
        import { useHumanInTheLoop } from "@copilotkit/react-core/v2" // [!code highlight]

        export function Page() {
          // ...

          useHumanInTheLoop({
            name: "humanApprovedCommand",
            description: "Ask human for approval to run a command.",
            parameters: [
              {
                name: "command",
                type: "string",
                description: "The command to run",
                required: true,
              },
            ],
            render: ({ args, respond }) => {
              if (!respond) return <></>;
              return (
                <div>
                  <pre>{args.command}</pre>
                  {/* [!code highlight:2] */}
                  <button onClick={() => respond(`Command is APPROVED`)}>Approve</button>
                  <button onClick={() => respond(`Command is DENIED`)}>Deny</button>
                </div>
              );
            },
          });

          // ...
        }
```
```csharp title="Program.cs"
            using Azure.AI.OpenAI;
            using Azure.Identity;
            using Microsoft.Agents.AI;
            using Microsoft.Agents.AI.Hosting.AGUI.AspNetCore;

            var builder = WebApplication.CreateBuilder(args);
            builder.Services.AddAGUI();
            var app = builder.Build();

            string endpoint = builder.Configuration["AZURE_OPENAI_ENDPOINT"]!;
            string deployment = builder.Configuration["AZURE_OPENAI_DEPLOYMENT_NAME"]!;

            // Create the agent - frontend tools are automatically available
            var agent = new AzureOpenAIClient(new Uri(endpoint), new DefaultAzureCredential())
                .GetChatClient(deployment)
                .CreateAIAgent(name: "AGUIAssistant", instructions: "You are a helpful assistant.");

            // Map the AG-UI endpoint
            app.MapAGUI("/", agent);
            await app.RunAsync();
```
```python title="agent/src/agent.py"
            from __future__ import annotations
            import os
            from fastapi import FastAPI
            from dotenv import load_dotenv
            from agent_framework import ChatAgent
            from agent_framework import ChatClientProtocol
            from agent_framework.azure import AzureOpenAIChatClient
            from agent_framework.openai import OpenAIChatClient
            from agent_framework.ag_ui import add_agent_framework_fastapi_endpoint
            from azure.identity import DefaultAzureCredential

            load_dotenv()

            def _build_chat_client() -> ChatClientProtocol:
                if bool(os.getenv("AZURE_OPENAI_ENDPOINT")):
                    return AzureOpenAIChatClient(
                        credential=DefaultAzureCredential(),
                        deployment_name=os.getenv("AZURE_OPENAI_CHAT_DEPLOYMENT_NAME", "gpt-5.2-mini"),
                        endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
                    )
                if bool(os.getenv("OPENAI_API_KEY")):
                    return OpenAIChatClient(
                        model_id=os.getenv("OPENAI_CHAT_MODEL_ID", "gpt-5.2-mini"),
                        api_key=os.getenv("OPENAI_API_KEY"),
                    )
                raise RuntimeError("Set AZURE_OPENAI_* or OPENAI_API_KEY in agent/.env")

            chat_client = _build_chat_client()
            # Frontend tools registered with useHumanInTheLoop are automatically available
            agent = ChatAgent(
                name="sample_agent",
                instructions="You are a helpful assistant.",
                chat_client=chat_client,
            )

            app = FastAPI(title="AG-UI Server (Python)")
            add_agent_framework_fastapi_endpoint(app=app, agent=agent, path="/")
```

### Introduction
- Route: `/microsoft-agent-framework`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/index.mdx`
- Description: Bring your Microsoft Agent Framework agents to your users with CopilotKit via AG-UI.

## Resources

- [Agent Framework User Guide](https://learn.microsoft.com/en-us/agent-framework/user-guide/overview)
- [Agent Framework Tutorials](https://learn.microsoft.com/en-us/agent-framework/tutorials/overview)

### Inspector
- Route: `/microsoft-agent-framework/inspector`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/inspector.mdx`
- Description: Inspector for debugging actions, readables, agent status, messages, and context.

## What it shows

The CopilotKit Inspector is a built-in debugging tool that overlays on your app, giving you full visibility into what's happening between your frontend and your agents in real time.

| Feature | Description |
| --- | --- |
| **AG-UI Events** | View the raw AG-UI event stream between your frontend and agent in real time. |
| **Available Agents** | See which agents are connected and available to your app. |
| **Agent State** | Inspect your agent's current state as it updates. |
| **Frontend Tools** | See what tools you've defined on the frontend and their parameter schemas. |
| **Context** | View the context you've provided to the agent, including readables and document context. |

## Disabling the Inspector

The Inspector is enabled by default. To disable it, set `enableInspector` to `false`:

```tsx
<CopilotKit
  publicLicenseKey={process.env.NEXT_PUBLIC_COPILOTKIT_LICENSE_KEY}
  enableInspector={false}
>
  {children}
</CopilotKit>
```

No matter what, **the inspector automatically disables when you create a production build.**

### Prebuilt Components
- Route: `/microsoft-agent-framework/prebuilt-components`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/prebuilt-components.mdx`
- Description: Drop-in chat components for your Microsoft Agent Framework agent.

```tsx title="layout.tsx"
import "@copilotkit/react-ui/v2/styles.css";
```
```tsx title="page.tsx"
// [!code word:CopilotChat]
import { CopilotChat } from "@copilotkit/react-core/v2";

export function YourComponent() {
  return (
    <CopilotChat
      labels={{
        modalHeaderTitle: "Your Assistant",
        welcomeMessageText: "Hi! How can I assist you today?",
      }}
    />
  );
}
```
```tsx title="page.tsx"
// [!code word:CopilotSidebar]
import { CopilotSidebar } from "@copilotkit/react-core/v2";

export function YourApp() {
  return (
    <CopilotSidebar
      defaultOpen={true}
      labels={{
        modalHeaderTitle: "Sidebar Assistant",
        welcomeMessageText: "How can I help you today?",
      }}
    >
      <YourMainContent />
    </CopilotSidebar>
  );
}
```
```tsx title="page.tsx"
// [!code word:CopilotPopup]
import { CopilotPopup } from "@copilotkit/react-core/v2";

export function YourApp() {
  return (
    <>
      <YourMainContent />
      <CopilotPopup
        labels={{
          modalHeaderTitle: "Popup Assistant",
          welcomeMessageText: "Need any help?",
        }}
      />
    </>
  );
}
```
```tsx title="page.tsx"
<CopilotChat
  // Style slots with Tailwind classes
  input={{
    textArea: "text-lg",
    sendButton: "bg-blue-600 hover:bg-blue-700",
  }}
  // Customize nested message slots
  messageView={{
    assistantMessage: {
      className: "bg-gray-50 rounded-xl p-4",
      toolbar: "border-t mt-2",
    },
    userMessage: "bg-blue-100 rounded-xl",
  }}
  // Hide elements by returning null
  scrollView={{
    feather: () => null,
  }}
/>
```

### Fully Headless UI
- Route: `/microsoft-agent-framework/premium/headless-ui`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/premium/headless-ui.mdx`
- Description: Fully customize your Copilot's UI from the ground up using headless UI

```bash
    npx copilotkit@latest create
```
```bash
    open README.md
```
```tsx title="src/app/layout.tsx"
    <CopilotKit
      publicLicenseKey="your-free-public-license-key"
    >
      {children}
    </CopilotKit>
```
```tsx title="src/app/page.tsx"
    "use client";
    import { useState } from "react";
    import { useCopilotChatHeadless_c } from "@copilotkit/react-core/v2"; // [!code highlight]

    export default function Home() {
      const { messages, sendMessage, isLoading } = useCopilotChatHeadless_c(); // [!code highlight]
      const [input, setInput] = useState("");

      const handleSend = () => {
        if (input.trim()) {
          // [!code highlight:5]
          sendMessage({
            id: Date.now().toString(),
            role: "user",
            content: input,
          });
          setInput("");
        }
      };

      return (
        <div>
          <h1>My Headless Chat</h1>

          {/* Messages */}
          <div>
            {/* [!code highlight:6] */}
            {messages.map((message) => (
              <div key={message.id}>
                <strong>{message.role === "user" ? "You" : "Assistant"}:</strong>
                <p>{message.content}</p>
              </div>
            ))}

            {/* [!code highlight:1] */}
            {isLoading && <p>Assistant is typing...</p>}
          </div>

          {/* Input */}
          <div>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              // [!code highlight:1]
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="Type your message here..."
            />
            {/* [!code highlight:1] */}
            <button onClick={handleSend} disabled={isLoading}>
              Send
            </button>
          </div>
        </div>
      );
    }
```
```tsx title="src/app/components/chat.tsx"
import { useFrontendTool } from "@copilotkit/react-core/v2";

export const Chat = () => {
  // ...

  // Define an action that will show a custom component
  useFrontendTool({
    name: "showCustomComponent",
    // Handle the tool on the frontend
    // [!code highlight:3]
    handler: () => {
      return "Foo, Bar, Baz";
    },
    // Render a custom component for the underlying data
    // [!code highlight:13]
    render: ({ result, args, status}) => {
      return <div style={{
        backgroundColor: "red",
        padding: "10px",
        borderRadius: "5px",
      }}>
        <p>Custom component</p>
        <p>Result: {result}</p>
        <p>Args: {JSON.stringify(args)}</p>
        <p>Status: {status}</p>
      </div>;
    }
  });

  // ...

  return <div>
    {messages.map((message) => (
      <p key={message.id}>
        {message.role === "user" ? "User: " : "Assistant: "}
        {message.content}
        {/* Render the generative UI if it exists */}
        {/* [!code highlight:1] */}
        {message.role === "assistant" && message.generativeUI?.()}
      </p>
    ))}
  </div>
};
```
```tsx title="src/app/components/chat.tsx"
export const Chat = () => {
  // ...

  return <div>
    {messages.map((message) => (
      <p key={message.id}>
        {/* Render the tool calls if they exist */}
        {/* [!code highlight:5] */}
        {message.role === "assistant" && message.toolCalls?.map((toolCall) => (
          <p key={toolCall.id}>
            {toolCall.function.name}: {toolCall.function.arguments}
          </p>
        ))}
      </p>
    ))}
  </div>
};
```
```tsx title="src/app/components/chat.tsx"
import { useCopilotChatHeadless_c, useCopilotChatSuggestions } from "@copilotkit/react-core/v2"; // [!code highlight]

export const Chat = () => {
  // Specify what suggestions should be generated
  // [!code highlight:5]
  useCopilotChatSuggestions({
    instructions:
      "Suggest 5 interesting activities for programmers to do on their next vacation",
    maxSuggestions: 5,
  });

  // Grab relevant state from the headless hook
  const { suggestions, generateSuggestions, sendMessage } = useCopilotChatHeadless_c(); // [!code highlight]

  // Generate suggestions when the component mounts
  useEffect(() => {
    generateSuggestions(); // [!code highlight]
  }, []);

  // ...

  // [!code word:suggestion]
  return <div>
    {suggestions.map((suggestion, index) => (
      <button
        key={index}
        onClick={() => sendMessage({
          id: "123",
          role: "user",
          content: suggestion.message
        })}
      >
        {suggestion.title}
      </button>
    ))}
  </div>
};
```
```tsx title="src/app/components/chat.tsx"
import { useCopilotChatHeadless_c } from "@copilotkit/react-core/v2";

export const Chat = () => {
  // Grab relevant state from the headless hook
  // [!code highlight:1]
  const { suggestions, setSuggestions } = useCopilotChatHeadless_c();

  // Set the suggestions when the component mounts
  // [!code highlight:6]
  useEffect(() => {
    setSuggestions([
      { title: "Suggestion 1", message: "The actual message for suggestion 1" },
      { title: "Suggestion 2", message: "The actual message for suggestion 2" },
    ]);
  }, []);

  // Change the suggestions on function call
  const changeSuggestions = () => {
    // [!code highlight:4]
    setSuggestions([
      { title: "Foo", message: "Bar" },
      { title: "Baz", message: "Bat" },
    ]);
  };

  // [!code word:suggestion]
  return (
    <div>
      {/* Change on button click */}
      <button onClick={changeSuggestions}>Change suggestions</button>

      {/* Render */}
      {suggestions.map((suggestion, index) => (
        <button
          key={index}
          onClick={() => sendMessage({
            id: "123",
            role: "user",
            content: suggestion.message
          })}
        >
          {suggestion.title}
        </button>
      ))}
    </div>
  );
};
```
```tsx title="src/app/components/chat.tsx"
import { useFrontendTool, useCopilotChatHeadless_c } from "@copilotkit/react-core/v2";

export const Chat = () => {
  const { messages, sendMessage } = useCopilotChatHeadless_c();

  // Define an action that will wait for the user to enter their name
  useFrontendTool({
    name: "getName",
    renderAndWaitForResponse: ({ respond, args, status}) => {
      if (status === "complete") {
        return <div>
          <p>Name retrieved...</p>
        </div>;
      }

      return <div>
        <input
          type="text"
          value={args.name || ""}
          onChange={(e) => respond?.(e.target.value)}
          placeholder="Enter your name"
        />
        {/* Respond with the name */}
        {/* [!code highlight:1] */}
        <button onClick={() => respond?.(args.name)}>Submit</button>
      </div>;
    }
  });

  return (
    {messages.map((message) => (
      <p key={message.id}>
        {message.role === "user" ? "User: " : "Assistant: "}
        {message.content}
        {/* [!code highlight:2] */}
        {/* This will render the tool-based HITL if it exists */}
        {message.role === "assistant" && message.generativeUI?.()}
      </p>
    ))}
  )
};
```

### Observability
- Route: `/microsoft-agent-framework/premium/observability`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/premium/observability.mdx`
- Description: Monitor your CopilotKit application with comprehensive observability hooks. Understand user interactions, chat events, and system errors.

Monitor CopilotKit with first‑class observability hooks that emit structured signals for chat events, user interactions, and runtime errors. Send these signals straight to your existing stack, including Sentry, Datadog, New Relic, and OpenTelemetry, or route them to your analytics pipeline. The hooks expose stable schemas and IDs so you can join agent events with app telemetry, trace sessions end to end, and alert on failures in real time. Works with Copilot Cloud via `publicApiKey`, or self‑hosted via `publicLicenseKey`.
## Quick Start

  All observability hooks require a `publicLicenseKey` or `publicAPIkey` - Get yours free at
  [https://cloud.copilotkit.ai](https://cloud.copilotkit.ai)

### Chat Observability Hooks

Track user interactions and chat events with comprehensive observability hooks:

```tsx
import { CopilotChat } from "@copilotkit/react-core/v2";
import { CopilotKit } from "@copilotkit/react-core/v2";

export default function App() {
  return (
    <CopilotKit
      publicApiKey="ck_pub_your_key" // [!code highlight] - Use publicApiKey for Copilot Cloud
      // OR
      publicLicenseKey="ck_pub_your_key" // [!code highlight] - Use publicLicenseKey for self-hosted
    >
      <CopilotChat
        observabilityHooks={{
          // [!code highlight]
          onMessageSent: (message) => {
            // [!code highlight]
            console.log("Message sent:", message);
            analytics.track("chat_message_sent", { message });
          }, // [!code highlight]
          onChatExpanded: () => {
            // [!code highlight]
            console.log("Chat opened");
            analytics.track("chat_expanded");
          }, // [!code highlight]
          onChatMinimized: () => {
            // [!code highlight]
            console.log("Chat closed");
            analytics.track("chat_minimized");
          }, // [!code highlight]
          onFeedbackGiven: (messageId, type) => {
            // [!code highlight]
            console.log("Feedback:", type, messageId);
            analytics.track("chat_feedback", { messageId, type });
          }, // [!code highlight]
        }} // [!code highlight]
      />
    </CopilotKit>
  );
}
```

### Error Observability

Monitor system errors and performance with error observability hooks:

```tsx
import { CopilotKit } from "@copilotkit/react-core/v2";

export default function App() {
  return (
    <CopilotKit
      publicApiKey="ck_pub_your_key" // [!code highlight] - Use publicApiKey for Copilot Cloud
      // OR
      publicLicenseKey="ck_pub_your_key" // [!code highlight] - Use publicLicenseKey for self-hosted
      onError={(errorEvent) => {
        // [!code highlight]
        // Send errors to monitoring service
        console.error("CopilotKit Error:", errorEvent);

        // Example: Send to analytics
        analytics.track("copilotkit_error", {
          type: errorEvent.type,
          source: errorEvent.context.source,
          timestamp: errorEvent.timestamp,
        });
      }} // [!code highlight]
      showDevConsole={false} // Hide dev console in production
    >
      {/* Your app */}
    </CopilotKit>
  );
}
```

## Observability Features

### CopilotChat Observability Hooks

Track user interactions, chat behavior and errors with comprehensive observability hooks (requires a `publicLicenseKey` if self-hosted or `publicAPIkey` if using CopilotCloud):

```tsx
import { CopilotChat } from "@copilotkit/react-core/v2";

<CopilotChat
  observabilityHooks={{
    onMessageSent: (message) => {
      console.log("Message sent:", message);
      // Track message analytics
      analytics.track("chat_message_sent", { message });
    },
    onChatExpanded: () => {
      console.log("Chat opened");
      // Track engagement
      analytics.track("chat_expanded");
    },
    onChatMinimized: () => {
      console.log("Chat closed");
      // Track user behavior
      analytics.track("chat_minimized");
    },
    onMessageRegenerated: (messageId) => {
      console.log("Message regenerated:", messageId);
      // Track regeneration requests
      analytics.track("chat_message_regenerated", { messageId });
    },
    onMessageCopied: (content) => {
      console.log("Message copied:", content);
      // Track content sharing
      analytics.track("chat_message_copied", { contentLength: content.length });
    },
    onFeedbackGiven: (messageId, type) => {
      console.log("Feedback given:", messageId, type);
      // Track user feedback
      analytics.track("chat_feedback_given", { messageId, type });
    },
    onChatStarted: () => {
      console.log("Chat generation started");
      // Track when AI starts responding
      analytics.track("chat_generation_started");
    },
    onChatStopped: () => {
      console.log("Chat generation stopped");
      // Track when AI stops responding
      analytics.track("chat_generation_stopped");
    },
    onError: (errorEvent) => {
      console.log("Error occurred", errorEvent);
      // Log error
      analytics.track("error_event", errorEvent);
    },
  }}
/>;
```

**Available Observability Hooks:**

- `onMessageSent(message)` - User sends a message
- `onChatExpanded()` - Chat is opened/expanded
- `onChatMinimized()` - Chat is closed/minimized
- `onMessageRegenerated(messageId)` - Message is regenerated
- `onMessageCopied(content)` - Message is copied
- `onFeedbackGiven(messageId, type)` - Thumbs up/down feedback given
- `onChatStarted()` - Chat generation starts
- `onChatStopped()` - Chat generation stops
- `onError(errorEvent)` - Error events and system monitoring

**Requirements:**

- ✅ Requires a `publicLicenseKey` (when self-hosting) or `publicApiKey` from [Copilot Cloud](https://cloud.copilotkit.ai)
- ✅ Works with `CopilotChat`, `CopilotPopup`, `CopilotSidebar`, and all pre-built components

  **Important:** Observability hooks will **not trigger** without a valid
  key. This is a security feature to ensure observability hooks only
  work in authorized applications.

## Error Event Structure

The `onError` handler receives detailed error events with rich context:

```typescript
interface CopilotErrorEvent {
  type:
    | "error"
    | "request"
    | "response"
    | "agent_state"
    | "action"
    | "message"
    | "performance";
  timestamp: number;
  context: {
    source: "ui" | "runtime" | "agent";
    request?: {
      operation: string;
      method?: string;
      url?: string;
      startTime: number;
    };
    response?: {
      endTime: number;
      latency: number;
    };
    agent?: {
      name: string;
      nodeName?: string;
    };
    messages?: {
      input: any[];
      messageCount: number;
    };
    technical?: {
      environment: string;
      stackTrace?: string;
    };
  };
  error?: any; // Present for error events
}
```

## Common Observability Patterns

### Chat Event Tracking

```tsx
<CopilotChat
  observabilityHooks={{
    onMessageSent: (message) => {
      // Track message analytics
      analytics.track("chat_message_sent", {
        messageLength: message.length,
        timestamp: Date.now(),
        userId: getCurrentUserId(),
      });
    },
    onChatExpanded: () => {
      // Track user engagement
      analytics.track("chat_expanded", {
        timestamp: Date.now(),
        userId: getCurrentUserId(),
      });
    },
    onFeedbackGiven: (messageId, type) => {
      // Track feedback for AI improvement
      analytics.track("chat_feedback", {
        messageId,
        feedbackType: type,
        timestamp: Date.now(),
      });
    },
  }}
/>
```

### Combined Event and Error Tracking

```tsx
<CopilotKit
  publicApiKey="ck_pub_your_key" // [!code highlight] - Use publicApiKey for Copilot Cloud
  // OR
  publicLicenseKey="ck_pub_your_key" // [!code highlight] - Use publicLicenseKey for self-hosted
  onError={(errorEvent) => {
    // Error observability
    if (errorEvent.type === "error") {
      console.error("CopilotKit Error:", errorEvent);
      analytics.track("copilotkit_error", {
        error: errorEvent.error?.message,
        context: errorEvent.context,
      });
    }
  }}
>
  <CopilotChat
    observabilityHooks={{
      onMessageSent: (message) => {
        // Event tracking
        analytics.track("chat_message_sent", { message });
      },
      onChatExpanded: () => {
        analytics.track("chat_expanded");
      },
    }}
  />
</CopilotKit>
```

## Error Observability Patterns

### Basic Error Logging

```tsx
<CopilotKit
  publicApiKey="ck_pub_your_key" // [!code highlight] - Use publicApiKey for Copilot Cloud
  // OR
  publicLicenseKey="ck_pub_your_key" // [!code highlight] - Use publicLicenseKey for self-hosted
  onError={(errorEvent) => {
    console.error("[CopilotKit Error]", {
      type: errorEvent.type,
      timestamp: new Date(errorEvent.timestamp).toISOString(),
      context: errorEvent.context,
      error: errorEvent.error,
    });
  }}
>
  {/* Your app */}
</CopilotKit>
```

### Integration with Monitoring Services

```tsx
// Example with Sentry
import * as Sentry from "@sentry/react";

<CopilotKit
  publicApiKey="ck_pub_your_key" // [!code highlight] - Use publicApiKey for Copilot Cloud
  // OR
  publicLicenseKey="ck_pub_your_key" // [!code highlight] - Use publicLicenseKey for self-hosted
  onError={(errorEvent) => {
    if (errorEvent.type === "error") {
      Sentry.captureException(errorEvent.error, {
        tags: {
          source: errorEvent.context.source,
          operation: errorEvent.context.request?.operation,
        },
        extra: {
          context: errorEvent.context,
          timestamp: errorEvent.timestamp,
        },
      });
    }
  }}
>
  {/* Your app */}
</CopilotKit>;
```

### Custom Error Analytics

```tsx
<CopilotKit
  publicApiKey="ck_pub_your_key" // [!code highlight] - Use publicApiKey for Copilot Cloud
  // OR
  publicLicenseKey="ck_pub_your_key" // [!code highlight] - Use publicLicenseKey for self-hosted
  onError={(errorEvent) => {
    // Track different error types
    analytics.track("copilotkit_event", {
      event_type: errorEvent.type,
      source: errorEvent.context.source,
      agent_name: errorEvent.context.agent?.name,
      latency: errorEvent.context.response?.latency,
      error_message: errorEvent.error?.message,
      timestamp: errorEvent.timestamp,
    });
  }}
>
  {/* Your app */}
</CopilotKit>
```

## Development vs Production Setup

### Development Environment

```tsx
<CopilotKit
  runtimeUrl="http://localhost:3000/api/copilotkit"
  publicLicenseKey={process.env.NEXT_PUBLIC_COPILOTKIT_LICENSE_KEY} // Self-hosted
  // OR
  publicApiKey={process.env.NEXT_PUBLIC_COPILOTKIT_API_KEY} // Using Copilot Cloud
  showDevConsole={true} // Show visual errors
  onError={(errorEvent) => {
    // Simple console logging for development
    console.log("CopilotKit Event:", errorEvent);
  }}
>
  <CopilotChat
    observabilityHooks={{
      onMessageSent: (message) => {
        console.log("Message sent:", message);
      },
      onChatExpanded: () => {
        console.log("Chat expanded");
      },
    }}
  />
</CopilotKit>
```

### Production Environment

```tsx
<CopilotKit
  runtimeUrl="https://your-app.com/api/copilotkit"
  publicLicenseKey={process.env.NEXT_PUBLIC_COPILOTKIT_LICENSE_KEY} // [!code highlight]
  // OR
  publicApiKey={process.env.NEXT_PUBLIC_COPILOTKIT_API_KEY} // [!code highlight]
  showDevConsole={false} // Hide from users
  onError={(errorEvent) => {
    // Production error observability
    if (errorEvent.type === "error") {
      // Log critical errors
      logger.error("CopilotKit Error", {
        error: errorEvent.error,
        context: errorEvent.context,
        timestamp: errorEvent.timestamp,
      });

      // Send to monitoring service
      monitoring.captureError(errorEvent.error, {
        extra: errorEvent.context,
      });
    }
  }}
>
  <CopilotChat
    observabilityHooks={{
      onMessageSent: (message) => {
        // Track production analytics
        analytics.track("chat_message_sent", {
          messageLength: message.length,
          userId: getCurrentUserId(),
        });
      },
      onChatExpanded: () => {
        analytics.track("chat_expanded");
      },
      onFeedbackGiven: (messageId, type) => {
        // Track feedback for AI improvement
        analytics.track("chat_feedback", { messageId, type });
      },
    }}
  />
</CopilotKit>
```

## Getting Started with CopilotKit Premium

To use observability hooks (event hooks and error observability), you'll need a CopilotKit Premium account:

1. **Sign up for free** at [https://cloud.copilotkit.ai](https://cloud.copilotkit.ai)
2. **Get your public license key (for self-hosting), or public API key** from the dashboard
3. **Add it to your environment variables**:
```bash
   NEXT_PUBLIC_COPILOTKIT_LICENSE_KEY=ck_pub_your_key_here
   # OR
   NEXT_PUBLIC_COPILOTKIT_API_KEY=ck_pub_your_key_here
```
4. **Use it in your CopilotKit provider**:
```tsx
   <CopilotKit 
      publicLicenseKey={process.env.NEXT_PUBLIC_COPILOTKIT_LICENSE_KEY}
      // OR
      publicApiKey={process.env.NEXT_PUBLIC_COPILOTKIT_API_KEY}
      >
     <CopilotChat
       observabilityHooks={{
         onMessageSent: (message) => console.log("Message:", message),
         onChatExpanded: () => console.log("Chat opened"),
       }}
     />
   </CopilotKit>
```

  CopilotKit Premium is free to get started and provides production-ready
  infrastructure for your AI copilots, including comprehensive observability
  capabilities for tracking user behavior and monitoring system health.

### CopilotKit Premium
- Route: `/microsoft-agent-framework/premium/overview`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/premium/overview.mdx`
- Description: Premium features for CopilotKit.

## What is CopilotKit Premium?
CopilotKit Premium plans deliver:
- A commercial license for premium extensions to the open source CopilotKit framework (self-hosted or using Copilot Cloud)
- Access to the Copilot Cloud hosted service.

CopilotKit Premium is designed for teams building production-grade, agent-powered applications with CopilotKit.
Premium extension features — such as Fully Headless UI and debugging tools — can be used in both self-hosted and cloud-hosted deployments.

The Developer tier of CopilotKit Premium is always free.

## Premium Plans
- Developer – Free forever, includes early-stage access and limited cloud usage
- Pro – For growing teams building in production
- Enterprise – For organizations with advanced scalability, security, and support needs
## Early Access
Certain features—like the Headless UI—will initially be available only to Premium subscribers before becoming part of the open-source core as the framework matures.
All CopilotKit Premium subscribers get early access to new features, tooling, and integrations as they are released.

## Current Premium Features
- [Fully Headless Chat UI](headless-ui) - Early Access
- [Observability Hooks](observability)
- [Copilot Cloud](https://cloud.copilotkit.ai)

## FAQs

### How do I get access to premium features?

#### Option 1:  Use Copilot Cloud!
All CopilotKit Premium features are included in Copilot Cloud.

#### Option 2:  Self-host with a license key.
Access to premium features requires a public license key. To get yours, follow the steps below.

    #### Sign up

    Create a *free* account on [Copilot Cloud](https://cloud.copilotkit.ai).

    This does not require a credit card or use of Copilot Cloud.
    #### Get your public license key

    Once you've signed up, you'll be able to get your public license key from the left nav.
    #### Use the public license key

    Once you've signed up, you'll be able to use the public license key in your CopilotKit instance.

```tsx title="layout.tsx"
    <CopilotKit publicLicenseKey="your-public-license-key" />
```

### Can I still self-host with a public license key?

Yes, you can still self-host with a public license key. It is only required if you want to use premium features,
for access to Copilot Cloud a public API key is utilized.

### What is the difference between a public license key and a public API key?

A public API key is a key that you use to connect your app to Copilot Cloud. Public license keys are used to access premium features
and do not require a connection to Copilot Cloud.

### Programmatic Control
- Route: `/microsoft-agent-framework/programmatic-control`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/programmatic-control.mdx`
- Description: Chat with an agent using CopilotKit's UI components.

### Import the hook

    First, import `useAgent` from the v2 package:

```tsx title="page.tsx"
    import { useAgent } from "@copilotkit/react-core/v2"; // [!code highlight]
```

    ### Access your agent

    Call the hook to get a reference to your agent:

```tsx title="page.tsx"
    export function AgentInfo() {
      const { agent } = useAgent(); // [!code highlight]

      return (
        <div>
          {/* [!code highlight:4] */}
          <p>Agent ID: {agent.id}</p>
          <p>Thread ID: {agent.threadId}</p>
          <p>Status: {agent.isRunning ? "Running" : "Idle"}</p>
          <p>Messages: {agent.messages.length}</p>
        </div>
      );
    }
```

    The hook will throw an error if no agent is configured, so you can safely use `agent` without null checks.

    ### Display messages

    Access the agent's conversation history:

```tsx title="page.tsx"
    export function MessageList() {
      const { agent } = useAgent();

      return (
        <div>
          {/* [!code highlight:6] */}
          {agent.messages.map((msg) => (
            <div key={msg.id}>
              <strong>{msg.role}:</strong>
              <span>{msg.content}</span>
            </div>
          ))}
        </div>
      );
    }
```

    ### Show running status

    Add a loading indicator when the agent is processing:

```tsx title="page.tsx"
    export function AgentStatus() {
      const { agent } = useAgent();

      return (
        <div>
          {/* [!code highlight:8] */}
          {agent.isRunning ? (
            <div>
              <div className="spinner" />
              <span>Agent is processing...</span>
            </div>
          ) : (
            <span>Ready</span>
          )}
        </div>
      );
    }
```

    ### Run the agent

    Use `copilotkit.runAgent()` to trigger your agent programmatically:

```tsx title="page.tsx"
    import { useAgent } from "@copilotkit/react-core/v2";
    import { useCopilotKit } from "@copilotkit/react-core/v2";
    import { randomUUID } from "@copilotkit/shared/v2";

    export function RunAgent() {
      const { agent } = useAgent();
      // [!code highlight:1]
      const { copilotkit } = useCopilotKit();

      const handleRun = async () => {
        agent.addMessage({
          id: randomUUID(),
          role: "user",
          content: "Hello, agent!",
        });

        // [!code highlight:1]
        await copilotkit.runAgent({ agent });
      };

      return <button onClick={handleRun}>Send</button>;
    }
```

    `copilotkit.runAgent()` orchestrates the full agent lifecycle — executing frontend tools, handling follow-up runs, and streaming results. This is the same method `` uses internally.

## Working with State

Agents expose their state through the `agent.state` property. This state is shared between your application and the agent - both can read and modify it.

### Reading State

Access your agent's current state:

```tsx title="page.tsx"
export function StateDisplay() {
  const { agent } = useAgent();

  return (
    <div>
      <h3>Agent State</h3>
      {/* [!code highlight:1] */}
      <pre>{JSON.stringify(agent.state, null, 2)}</pre>

      {/* Access specific properties */}
      {/* [!code highlight:2] */}
      {agent.state.user_name && <p>User: {agent.state.user_name}</p>}
      {agent.state.preferences && <p>Preferences: {JSON.stringify(agent.state.preferences)}</p>}
    </div>
  );
}
```

Your component automatically re-renders when the agent's state changes.

### Updating State

Update state that your agent can access:

```tsx title="page.tsx"
export function ThemeSelector() {
  const { agent } = useAgent();

  const updateTheme = (theme: string) => {
    // [!code highlight:4]
    agent.setState({
      ...agent.state,
      user_theme: theme,
    });
  };

  return (
    <div>
      {/* [!code highlight:2] */}
      <button onClick={() => updateTheme("dark")}>Dark Mode</button>
      <button onClick={() => updateTheme("light")}>Light Mode</button>
      <p>Current: {agent.state.user_theme || "default"}</p>
    </div>
  );
}
```

State updates are immediately available to your agent in its next execution.

## Subscribing to Agent Events

You can subscribe to agent events using the `subscribe()` method. This is useful for logging, monitoring, or responding to specific agent behaviors.

### Basic Event Subscription

```tsx title="page.tsx"
import { useEffect } from "react";
import { useAgent } from "@copilotkit/react-core/v2";
import type { AgentSubscriber } from "@ag-ui/client";

export function EventLogger() {
  const { agent } = useAgent();

  useEffect(() => {
    // [!code highlight:15]
    const subscriber: AgentSubscriber = {
      onCustomEvent: ({ event }) => {
        console.log("Custom event:", event.name, event.value);
      },
      onRunStartedEvent: () => {
        console.log("Agent started running");
      },
      onRunFinalized: () => {
        console.log("Agent finished running");
      },
      onStateChanged: (state) => {
        console.log("State changed:", state);
      },
    };

    // [!code highlight:2]
    const { unsubscribe } = agent.subscribe(subscriber);
    return () => unsubscribe();
  }, []);

  return null;
}
```

### Available Events

The `AgentSubscriber` interface provides:

- **`onCustomEvent`** - Custom events emitted by the agent
- **`onRunStartedEvent`** - Agent starts executing
- **`onRunFinalized`** - Agent completes execution
- **`onStateChanged`** - Agent's state changes
- **`onMessagesChanged`** - Messages are added or modified

## Rendering Tool Calls

You can customize how agent tool calls are displayed in your UI. First, define your tool renderers:

```tsx title="components/weather-tool.tsx"
import { defineToolCallRenderer } from "@copilotkit/react-core/v2";

// [!code highlight:6]
export const weatherToolRender = defineToolCallRenderer({
  name: "get_weather",
  render: ({ args, status }) => {
    return <WeatherCard location={args.location} status={status} />;
  },
});

function WeatherCard({ location, status }: { location?: string; status: string }) {
  return (
    <div className="rounded-lg border p-6 shadow-sm">
      <h3 className="text-xl font-semibold">Weather in {location}</h3>
      <div className="mt-4">
        <span className="text-5xl font-light">70°F</span>
      </div>
      {status === "executing" && <div className="spinner">Loading...</div>}
    </div>
  );
}
```

Register your tool renderers with CopilotKit:

```tsx title="layout.tsx"
import { CopilotKit } from "@copilotkit/react-core";
import { weatherToolRender } from "./components/weather-tool";

export default function RootLayout({ children }) {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      {/* [!code highlight:1] */}
      renderToolCalls={[weatherToolRender]}
    >
      {children}
    </CopilotKit>
  );
}
```

Then use `useRenderToolCall` to render tool calls from agent messages:

```tsx title="components/message-list.tsx"
import { useAgent, useRenderToolCall } from "@copilotkit/react-core/v2";

export function MessageList() {
  const { agent } = useAgent();
  const renderToolCall = useRenderToolCall();

  return (
    <div className="messages">
      {agent.messages.map((message) => (
        <div key={message.id}>
          {/* Display message content */}
          {message.content && <p>{message.content}</p>}

          {/* Render tool calls if present */}
          {/* [!code highlight:9] */}
          {message.role === "assistant" && message.toolCalls?.map((toolCall) => {
            const toolMessage = agent.messages.find(
              (m) => m.role === "tool" && m.toolCallId === toolCall.id
            );
            return (
              <div key={toolCall.id}>
                {renderToolCall({ toolCall, toolMessage })}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
```

## Building a Complete Dashboard

Here's a full example combining all concepts into an interactive agent dashboard:

```tsx title="page.tsx"
"use client";

import { useAgent } from "@copilotkit/react-core/v2";

export default function AgentDashboard() {
  const { agent } = useAgent();

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      {/* Status */}
      <div className="p-6 bg-white rounded-lg shadow">
        <h2 className="text-xl font-bold mb-4">Agent Status</h2>
        <div className="space-y-2">
          {/* [!code highlight:6] */}
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${
              agent.isRunning ? "bg-yellow-500 animate-pulse" : "bg-green-500"
            }`} />
            <span>{agent.isRunning ? "Running" : "Idle"}</span>
          </div>
          <div>Thread: {agent.threadId}</div>
          <div>Messages: {agent.messages.length}</div>
        </div>
      </div>

      {/* State */}
      <div className="p-6 bg-white rounded-lg shadow">
        <h2 className="text-xl font-bold mb-4">Agent State</h2>
        {/* [!code highlight:3] */}
        <pre className="bg-gray-50 p-4 rounded text-sm overflow-auto">
          {JSON.stringify(agent.state, null, 2)}
        </pre>
      </div>

      {/* Messages */}
      <div className="p-6 bg-white rounded-lg shadow">
        <h2 className="text-xl font-bold mb-4">Conversation</h2>
        <div className="space-y-3">
          {/* [!code highlight:11] */}
          {agent.messages.map((msg) => (
            <div
              key={msg.id}
              className={`p-3 rounded-lg ${
                msg.role === "user" ? "bg-blue-50 ml-8" : "bg-gray-50 mr-8"
              }`}
            >
              <div className="font-semibold text-sm mb-1">
                {msg.role === "user" ? "You" : "Agent"}
              </div>
              <div>{msg.content}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

## Running the Agent Programmatically

Use `copilotkit.runAgent()` to trigger your agent from any component — no chat UI required. This is the same method CopilotKit's built-in `` uses internally.

```tsx title="page.tsx"
import { useAgent } from "@copilotkit/react-core/v2";
import { useCopilotKit } from "@copilotkit/react-core/v2";
import { randomUUID } from "@copilotkit/shared/v2";

export function AgentTrigger() {
  const { agent } = useAgent();
  // [!code highlight:1]
  const { copilotkit } = useCopilotKit();

  const handleRun = async () => {
    // Add a user message to the agent's conversation
    agent.addMessage({
      id: randomUUID(),
      role: "user",
      content: "Summarize the latest sales data",
    });

    // [!code highlight:2]
    // Run the agent — handles tool execution, follow-ups, and streaming
    await copilotkit.runAgent({ agent });
  };

  return <button onClick={handleRun}>Run Agent</button>;
}
```

### `copilotkit.runAgent()` vs `agent.runAgent()`

Both methods trigger the agent, but they operate at different levels:

- **`copilotkit.runAgent({ agent })`** — The recommended approach. Orchestrates the full agent lifecycle: executes frontend tools, handles follow-up runs when tools request them, and manages errors through the subscriber system.
- **`agent.runAgent()`** — Low-level method on the agent instance. Sends the request to the runtime but does **not** execute frontend tools or handle follow-ups. Use this only when you need direct control over the agent execution (e.g., resuming from an interrupt with `forwardedProps`).

### Stopping a Run

You can stop a running agent using `copilotkit.stopAgent()`:

```tsx title="page.tsx"
const handleStop = () => {
  copilotkit.stopAgent({ agent });
};
```

### Quickstart
- Route: `/microsoft-agent-framework/quickstart`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/quickstart.mdx`
- Description: Turn your Microsoft Agent Framework agent into an agent-native application in 10 minutes.

## Prerequisites

Before you begin, you'll need the following:

- A GitHub Personal Access Token (for GitHub Models API - free AI access)
- .NET 9.0 SDK or later
- Node.js 20+
- Your favorite package manager (npm, pnpm, yarn, or bun)

## Getting started

                    You can either start fresh with our starter template or integrate CopilotKit into your existing Microsoft Agent Framework agent.
                ### Run our CLI

                First, we'll use our CLI to create a new project for us.

```bash
                        npx copilotkit@latest create -f microsoft-agent-framework-dotnet
```
```bash
                        npx copilotkit@latest create -f microsoft-agent-framework-py
```
                ### Install dependencies

                The starter includes a `postinstall` script that automatically installs both your npm and agent dependencies.

```npm
                npm install
```

                      If you have issues with automatic .NET package installation, you can manually restore them:
```bash
                      npm run install:agent
```
                      If you have issues with automatic Python setup, you can manually install the agent dependencies:
```bash
                      npm run install:agent
                      # or manually:
                      cd agent
                      uv sync
```
                ### Configure your environment

                        The starter template uses GitHub Models API for free access to AI models. Set up your GitHub token:

                        First, get your GitHub token (requires [GitHub CLI](https://github.com/cli/cli)):
```bash
                        gh auth token
```

                        Then navigate to the agent directory and set it as a user secret:
```bash
                        cd agent
                        dotnet user-secrets set GitHubToken "$(gh auth token)"
                        cd ..
```

                          The starter template is configured to use GitHub Models (free), but you can modify it to use:
                          - OpenAI directly
                          - Azure OpenAI
                          - Any other model supported by Microsoft Agent Framework

                          Check the `agent/Program.cs` file to customize the model configuration.
                        Create a `.env` file inside the `agent` folder with one of the following configurations:

```bash title="agent/.env (OpenAI)"
                        OPENAI_API_KEY=sk-...your-openai-key-here...
                        OPENAI_CHAT_MODEL_ID=gpt-5.2-mini
```

```bash title="agent/.env (Azure OpenAI)"
                        AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
                        AZURE_OPENAI_CHAT_DEPLOYMENT_NAME=gpt-5.2-mini
                        # If you are not relying on az login:
                        # AZURE_OPENAI_API_KEY=...
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

                This will start both the Next.js UI (port 3000) and agent server (port 8000) concurrently.
                ### Start your Microsoft Agent Framework agent

                Make sure your agent is running and exposing an AG-UI endpoint. Here's a minimal example:

                        First, setup a new .NET project:
```bash
                        dotnet new web -n AGUIServer
                        cd AGUIServer
                        dotnet add package Microsoft.Agents.AI.Hosting.AGUI.AspNetCore --version 1.0.0-preview.251110.1
                        dotnet add package Microsoft.Extensions.AI.OpenAI --version 9.10.2-preview.1.25552.1
                        dotnet add package OpenAI --version 2.6.0
                        dotnet user-secrets init
```

                        Build a minimal agent and serve it via AG-UI:

```csharp title="Program.cs"
                        using Microsoft.Agents.AI;
                        # [!code highlight:1]
                        using Microsoft.Agents.AI.Hosting.AGUI.AspNetCore;
                        using Microsoft.Extensions.AI;
                        using OpenAI;

                        var builder = WebApplication.CreateBuilder(args);
                        # [!code highlight:1]
                        builder.Services.AddAGUI();
                        var app = builder.Build();

                        // Get your GitHub token for GitHub Models (free)
                        var githubToken = builder.Configuration["GitHubToken"]!;
                        var openAI = new OpenAIClient(
                            new System.ClientModel.ApiKeyCredential(githubToken),
                            new OpenAIClientOptions {
                                Endpoint = new Uri("https://models.inference.ai.azure.com")
                            });

                        var chatClient = openAI.GetChatClient("gpt-5.2-mini").AsIChatClient();
                        var agent = new ChatClientAgent(
                            chatClient,
                            name: "MyAgent",
                            description: "You are a helpful assistant.");

                        # [!code highlight:1]
                        app.MapAGUI("/", agent);
                        app.Run("http://localhost:8000");
```

                        Then just setup the environment and run your agent:

```bash
                        # Set your GitHub token and run
                        dotnet user-secrets set GitHubToken "$(gh auth token)"
                        dotnet run
```
                        Create a minimal FastAPI server that exposes a Microsoft Agent Framework agent over AG-UI:

```python title="agent/src/byo_agent.py"
                        from __future__ import annotations

                        import os

                        import uvicorn
                        from agent_framework import ChatClientProtocol
                        from azure.identity import DefaultAzureCredential
                        from agent_framework.azure import AzureOpenAIChatClient
                        from agent_framework.openai import OpenAIChatClient
                        from agent_framework import ChatAgent
                        from agent_framework.ag_ui import add_agent_framework_fastapi_endpoint
                        from dotenv import load_dotenv
                        from fastapi import FastAPI

                        load_dotenv()

                        def _build_chat_client() -> ChatClientProtocol:
                            if bool(os.getenv("AZURE_OPENAI_ENDPOINT")):
                                deployment_name = os.getenv("AZURE_OPENAI_CHAT_DEPLOYMENT_NAME", "gpt-5.2-mini")
                                return AzureOpenAIChatClient(
                                    credential=DefaultAzureCredential(),
                                    deployment_name=deployment_name,
                                    endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
                                )

                            if bool(os.getenv("OPENAI_API_KEY")):
                                return OpenAIChatClient(
                                    model_id=os.getenv("OPENAI_CHAT_MODEL_ID", "gpt-5.2-mini"),
                                    api_key=os.getenv("OPENAI_API_KEY"),
                                )

                            raise RuntimeError(
                                "Missing credentials. Set either AZURE_OPENAI_ENDPOINT (+ AZURE_OPENAI_CHAT_DEPLOYMENT_NAME) "
                                "or OPENAI_API_KEY as environment variables."
                            )

                        chat_client = _build_chat_client()

                        agent = ChatAgent(
                            name="MyAgent",
                            instructions="You are a helpful assistant.",
                            chat_client=chat_client,
                        )

                        app = FastAPI(title="Microsoft Agent Framework (Python) - Quickstart")
                        add_agent_framework_fastapi_endpoint(app=app, agent=agent, path="/")

                        if __name__ == "__main__":
                            uvicorn.run("byo_agent:app", host="0.0.0.0", port=8000, reload=True)
```

                        Then set your environment and run:

```bash
                        # OpenAI (agent/.env)
                        OPENAI_API_KEY=sk-...your-openai-key-here...
                        OPENAI_CHAT_MODEL_ID=gpt-5.2-mini
                        # or Azure OpenAI (agent/.env)
                        AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
                        AZURE_OPENAI_CHAT_DEPLOYMENT_NAME=gpt-5.2-mini
                        # (optional) AZURE_OPENAI_API_KEY=...

                        # Run the agent
                        cd agent
                        uv run src/byo_agent.py
```

                ### Frontend Setup
                CopilotKit works with any React-based frontend. We'll use Next.js for this example.

                In a new terminal window, run the following commands:

```bash
                npx create-next-app@latest my-copilot-app
                cd my-copilot-app
```
                ### Install CopilotKit packages

```npm
                npm install @copilotkit/react-ui @copilotkit/react-core @copilotkit/runtime @ag-ui/client
```
                ### Setup Copilot Runtime

                CopilotKit requires a Copilot Runtime endpoint to safely communicate with your agent. This can be served
                anywhere that Node.js can run, but for this example we'll use Next.js.

                Create a new API route at `app/api/copilotkit/route.ts`:

```tsx title="app/api/copilotkit/route.ts"
                import {
                  CopilotRuntime,
                  ExperimentalEmptyAdapter,
                  copilotRuntimeNextJSAppRouterEndpoint,
                } from "@copilotkit/runtime";
                import { HttpAgent } from "@ag-ui/client";
                import { NextRequest } from "next/server";

                // 1. You can use any service adapter here for multi-agent support. We use
                //    the empty adapter since we're only using one agent.
                const serviceAdapter = new ExperimentalEmptyAdapter();

                // 2. Create the CopilotRuntime instance and utilize the Microsoft Agent Framework
                //    AG-UI integration to setup the connection.
                // [!code highlight:5]
                const runtime = new CopilotRuntime({
                  agents: {
                    my_agent: new HttpAgent({ url: "http://localhost:8000/" }),
                  },
                });

                // 3. Build a Next.js API route that handles the CopilotKit runtime requests.
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

                Next, wrap your application with the CopilotKit provider so that CopilotKit can take control across your application
                via the Microsoft Agent Framework agent.

```tsx title="app/layout.tsx"
                import { CopilotKit } from "@copilotkit/react-core/v2"; // [!code highlight]
                import "@copilotkit/react-ui/v2/styles.css";

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
              "use client";

              // [!code highlight:1]
              import { CopilotSidebar } from "@copilotkit/react-core/v2";

              export default function Page() {
                return (
                  <main>
                    {/* [!code highlight:6] */}
                    <CopilotSidebar
                      labels={{
                        modalHeaderTitle: "Your Assistant",
                        welcomeMessageText: "Hi! How can I help you today?",
                      }}
                    />
                    <h1>Your App</h1>
                  </main>
                );
              }
```
              ### Run and start your Next.js app
              To run the Next.js app we just created, use the following command:

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
        What do you think about .NET?
```

                **Agent Connection Issues**
                - If you see "I'm having trouble connecting to my tools", make sure:
                  - The C# agent is running on port 8000
                  - Your GitHub token is set correctly via user secrets
                  - Both servers started successfully (check terminal output)

                **GitHub Token Issues**
                - If the agent fails with "GitHubToken not found":
```bash
                  cd agent
                  dotnet user-secrets set GitHubToken "$(gh auth token)"
```

                **.NET SDK Issues**
                - Verify .NET SDK is installed:
```bash
                  dotnet --version  # Should be 9.0.x or higher
```
                - Restore packages manually if needed:
```bash
                  cd agent
                  dotnet restore
                  dotnet run
```

                **Port Conflicts**
                - If port 8000 is already in use, you can change it in:
                  - `agent/Properties/launchSettings.json` - Update `applicationUrl`
                  - `src/app/api/copilotkit/route.ts` - Update the remote endpoint URL

## What's next?

Now that you have your basic agent setup, explore these advanced features:

### Reading agent state
- Route: `/microsoft-agent-framework/shared-state/in-app-agent-read`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/shared-state/in-app-agent-read.mdx`
- Description: Read the realtime agent state in your native application.

```csharp title="agent/Program.cs (excerpt)"
        public class AgentStateSnapshot
        {
            public string Language { get; set; } = "english";
        }
```
```python title="agent/src/agent.py (excerpt)"
        STATE_SCHEMA: dict[str, object] = {
            "language": {
                "type": "string",
                "enum": ["english", "spanish"],
                "description": "Preferred language."
            }
        }
```
```ts title="ui/app/page.tsx"
    type AgentState = {
      language: "english" | "spanish";
    }
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
        name: "sample_agent",
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
}

function YourMainContent() {
  // ...
  // [!code highlight:7]
  useAgent<AgentState>({
    name: "sample_agent",
    render: ({ agentState }) => {
      if (!agentState.language) return null;
      return <div>Language: {agentState.language}</div>;
    },
  });
  // ...
}
```

### Writing agent state
- Route: `/microsoft-agent-framework/shared-state/in-app-agent-write`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/shared-state/in-app-agent-write.mdx`
- Description: Write to agent's state from your application.

```csharp title="agent/Program.cs (excerpt)"
        public class AgentStateSnapshot
        {
            public string Language { get; set; } = "english";
        }
```
```python title="agent/src/agent.py (excerpt)"
        from typing import Annotated
        from agent_framework import ChatAgent, ChatClientProtocol, ai_function
        from agent_framework.ag_ui import AgentFrameworkAgent
        from pydantic import Field

        STATE_SCHEMA: dict[str, object] = {
            "language": {
                "type": "string",
                "enum": ["english", "spanish"],
                "description": "Preferred language.",
            }
        }

        PREDICT_STATE_CONFIG: Dict[str, Dict[str, str]] = {
            "language": {"tool": "update_language", "tool_argument": "language"}
        }

        @ai_function(
            name="update_language",
            description="Update the preferred language (english or spanish).",
        )
        def update_language(
            language: Annotated[str, Field(description="Preferred language: 'english' or 'spanish'")],
        ) -> str:
            normalized = (language or "").strip().lower()
            if normalized not in ("english", "spanish"):
                return "Language unchanged. Use 'english' or 'spanish'."
            return f"Language updated to {normalized}."

        def create_agent(chat_client: ChatClientProtocol) -> AgentFrameworkAgent:
            base_agent = ChatAgent(
                name="sample_agent",
                instructions="You are a helpful assistant.",
                chat_client=chat_client,
                tools=[update_language],   # [!code highlight:1]
            )

            return AgentFrameworkAgent(
                agent=base_agent,
                name="CopilotKitMicrosoftAgentFrameworkAgent",
                description="Assistant that tracks a simple language state.",
                state_schema=STATE_SCHEMA,               # [!code highlight:2]
                predict_state_config=PREDICT_STATE_CONFIG, # [!code highlight:2]
                require_confirmation=False,
            )
```
```ts title="ui/app/page.tsx"
    type AgentState = {
      language: "english" | "spanish";
    }
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
        name: "sample_agent",
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
          {/* [!code highlight:1] */}
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
    name: "sample_agent",
    initialState: { language: "english" }  // optionally provide an initial state
  });

  // setup to be called when some event in the app occurs
  const toggleLanguage = () => {
    const newLanguage = agentState.language === "english" ? "spanish" : "english";
    setAgentState({ language: newLanguage });

    // [!code highlight:7]
    // re-run the agent and provide a hint about what's changed
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

### Predictive state updates
- Route: `/microsoft-agent-framework/shared-state/predictive-state-updates`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/shared-state/predictive-state-updates.mdx`
- Description: Stream in-progress agent state updates to the frontend.

This example demonstrates predictive state updates in the CopilotKit Feature Viewer.

## What is this?

Microsoft Agent Framework agents can stream state updates through AG-UI as tool arguments are generated by the LLM. CopilotKit surfaces these updates in the UI, enabling optimistic, real-time rendering. We call these predictive state updates.

## When should I use this?

Use predictive state updates when you want to:
- Keep users engaged during long-running operations
- Show step-by-step progress
- Build trust by exposing what the agent is doing now, not only at the end
- Enable agent steering (users can intervene if needed)

When the tool completes, the agent emits a final state snapshot. Any predictive updates should be reflected in that final state or they will be overwritten.

## Implementation

    ### Define the state
    We will define an `observed_steps` array that is updated while the agent performs long-running tasks.

```csharp title="agent/Program.cs (excerpt)"
        using System.Text.Json.Serialization;
        public class AgentStateSnapshot
        {
            [JsonPropertyName("observed_steps")]
            public List<string> ObservedSteps { get; set; } = new();
        }
```
```python title="agent/src/agent.py (excerpt)"
        from typing import Dict

        STATE_SCHEMA: Dict[str, object] = {
            "observed_steps": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Array of completed steps"
            }
        }
```

    ### Emit the intermediate state (tool-based predictive updates)
    Configure AG-UI state management to treat tool arguments as predictive updates to `observed_steps`. As the LLM streams arguments for the tool call, AG-UI emits state delta events immediately.

```csharp title="agent/Program.cs (excerpt)"
        using System.ComponentModel;
        using System.Text.Json;
        using System.Text.Json.Serialization;
        using Azure.AI.OpenAI;
        using Azure.Identity;
        using Microsoft.Agents.AI;
        using Microsoft.Agents.AI.Hosting.AGUI.AspNetCore;
        using Microsoft.AspNetCore.Http.Json;
        using Microsoft.Extensions.AI;
        using Microsoft.Extensions.DependencyInjection;
        using Microsoft.Extensions.Options;

        var builder = WebApplication.CreateBuilder(args);
        builder.Services.AddAGUI();
        // Register a source-generated serializer context for fast, typed JSON
        builder.Services.ConfigureHttpJsonOptions(options =>
            options.SerializerOptions.TypeInfoResolverChain.Add(AGUIDojoServerSerializerContext.Default));

        var app = builder.Build();

        string endpoint = builder.Configuration["AZURE_OPENAI_ENDPOINT"]!;
        string deployment = builder.Configuration["AZURE_OPENAI_DEPLOYMENT_NAME"]!;

        // Define a tool the LLM may call as it progresses to report partial steps
        [Description("Report current step progress.")]
        static string StepProgress([Description("Steps completed so far")] string[] steps)
            => "Progress received.";

        // Create the base agent with the reporting tool
        var baseAgent = new AzureOpenAIClient(new Uri(endpoint), new DefaultAzureCredential())
            .GetChatClient(deployment)
            .CreateAIAgent(
                name: "AGUIAssistant",
                instructions: "You are a helpful assistant that may call the 'step_progress' tool to report intermediate steps.",
                tools: [AIFunctionFactory.Create(StepProgress)]);

        // Wrap with a streaming middleware that emits interim state snapshots (typed, source-generated).
        // See the "Stream state from your agent" section in the Agent State guide for a full example of a DelegatingAIAgent
        // that reads streaming updates and emits DataContent with an AgentStateSnapshot.
        var jsonOptions = app.Services.GetRequiredService<IOptions<JsonOptions>>();
        AIAgent agent = new StateStreamingAgent(baseAgent, jsonOptions.Value.SerializerOptions);

        app.MapAGUI("/", agent);
        await app.RunAsync();

        // Example: streaming agent wrapper emitting state snapshots (simplified)
        internal sealed class StateStreamingAgent : DelegatingAIAgent
        {
            private readonly JsonSerializerOptions _jsonOptions;
            public StateStreamingAgent(AIAgent inner, JsonSerializerOptions jsonOptions) : base(inner)
            {
                _jsonOptions = jsonOptions;
            }

            public override async IAsyncEnumerable<AgentRunResponseUpdate> RunStreamingAsync(
                IEnumerable<ChatMessage> messages,
                AgentThread? thread = null,
                AgentRunOptions? options = null,
                [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
            {
                var observedSteps = new List<string>();
                await foreach (var update in this.InnerAgent.RunStreamingAsync(messages, thread, options, cancellationToken))
                {
                    // Inspect streaming contents for function calls and collect step arguments as they arrive
                    foreach (var content in update.Contents)
                    {
                        if (content is FunctionCallContent f
                            && string.Equals(f.Name, "step_progress", StringComparison.OrdinalIgnoreCase)
                            && f.Arguments is JsonElement args)
                        {
                            if (args.TryGetProperty("steps", out var stepsElement))
                            {
                                if (stepsElement.Deserialize(_jsonOptions.GetTypeInfo(typeof(string[]))) is string[] steps)
                                {
                                    observedSteps.Clear();
                                    foreach (var s in steps)
                                    {
                                        observedSteps.Add(s);
                                    }
                                    // Emit a typed state snapshot into the AG‑UI stream
                                    var snapshot = new AgentStateSnapshot { Steps = observedSteps };
                                    byte[] stateBytes = JsonSerializer.SerializeToUtf8Bytes(
                                        snapshot,
                                        _jsonOptions.GetTypeInfo(typeof(AgentStateSnapshot)));
                                    yield return new AgentRunResponseUpdate
                                    {
                                        Contents = [ new DataContent(stateBytes, "application/json") ]
                                    };
                                }
                            }
                        }
                    }

                    // Always forward the original update (text deltas / final tool results, etc.)
                    yield return update;
                }
            }
        }

        // Typed state snapshot for source-generated JSON
        internal sealed class AgentStateSnapshot
        {
            [JsonPropertyName("observed_steps")]
            public List<string> Steps { get; set; } = new();
        }

        // Source-generated serializer context (register above via ConfigureHttpJsonOptions)
        [JsonSerializable(typeof(AgentStateSnapshot))]
        [JsonSerializable(typeof(string[]))]
        internal sealed partial class AGUIDojoServerSerializerContext : JsonSerializerContext;
```
```python title="agent/src/agent.py (excerpt)"
        from __future__ import annotations
        from typing import Annotated, Dict
        from agent_framework import ChatAgent, ChatClientProtocol, ai_function
        from agent_framework_ag_ui import AgentFrameworkAgent
        from pydantic import Field

        # 1) Define state schema for AG-UI
        STATE_SCHEMA: Dict[str, object] = {
            "observed_steps": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Array of completed steps"
            }
        }

        # 2) Predictive state mapping: observed_steps <- step_progress.steps
        PREDICT_STATE_CONFIG: Dict[str, Dict[str, str]] = {
            "observed_steps": {
                "tool": "step_progress",
                "tool_argument": "steps",
            }
        }

        # 3) Tool that the LLM will call with step updates
        @ai_function(
            name="step_progress",
            description="Report current step progress."
        )
        def step_progress(
            steps: Annotated[list[str], Field(description="Steps completed so far")]
        ) -> str:
            return "Progress received."

        def create_agent(chat_client: ChatClientProtocol) -> AgentFrameworkAgent:
            base = ChatAgent(
                name="sample_agent",
                instructions="You are a task performer. Report progress using step_progress.",
                chat_client=chat_client,
                tools=[step_progress],
            )
            return AgentFrameworkAgent(
                agent=base,
                name="CopilotKitMicrosoftAgentFrameworkAgent",
                description="Agent with predictive state updates for observed steps.",
                state_schema=STATE_SCHEMA,
                predict_state_config=PREDICT_STATE_CONFIG,
                require_confirmation=False,
            )
```
      With this configuration, AG-UI emits predictive state updates as soon as the model streams the tool arguments, without waiting for tool completion.

    ### Observe predictions on the client
    Add a state renderer to observe the predicted `observed_steps` updates as they stream in.

```tsx title="ui/app/page.tsx"
    import { useAgent } from "@copilotkit/react-core/v2";

    type AgentState = {
      observed_steps: string[];
    };

    export default function Page() {
      // Access both predicted and final states
      const { agentState } = useAgent<AgentState>({ name: "sample_agent" });

      // Observe predictions (render inside the chat)
      useAgent<AgentState>({
        name: "sample_agent",
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

      return <div>...</div>;
    }
```
    ### Give it a try!
    Ask the agent to perform a multi-step task (e.g., “write a short outline and report progress each step”). You’ll see `observed_steps` update in real time as the tool arguments stream in.

### Common Copilot Issues
- Route: `/microsoft-agent-framework/troubleshooting/common-issues`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/troubleshooting/common-issues.mdx`
- Description: Common issues you may encounter when using Copilots.

Welcome to the CopilotKit Troubleshooting Guide! Here, you can find answers to common issues

    Have an issue not listed here? Open a ticket on [GitHub](https://github.com/CopilotKit/CopilotKit/issues) or reach out on [Discord](https://discord.com/invite/6dffbvGU3D)
    and we'll be happy to help.

    We also highly encourage any open source contributors that want to add their own troubleshooting issues to [Github as a pull request](https://github.com/CopilotKit/CopilotKit/blob/main/CONTRIBUTING.md).

## I am getting network errors / API not found error

If you're encountering network or API errors, here's how to troubleshoot:

        Verify your endpoint configuration in your CopilotKit setup:

```tsx
        <CopilotKit
          runtimeUrl="/api/copilotkit"
        >
          {/* Your app */}
        </CopilotKit>
```

        or, if using CopilotCloud
```tsx
        <CopilotKit
            publicApiKey="<your-copilot-cloud-public-api-key>"
        >
            {/* Your app */}
        </CopilotKit>
```

        Common issues:
        - Missing leading slash in endpoint path
        - Incorrect path relative to your app's base URL, or, if using absolute paths, incorrect full URL
        - Typos in the endpoint path
        - If using CopilotCloud, make sure to omit the `runtimeUrl` property and provide a valid API key
        If you're running locally and getting connection errors, try using `127.0.0.1` instead of `localhost`:

```bash
        # If this doesn't work:
        http://localhost:3000/api/copilotkit

        # Try this instead:
        http://127.0.0.1:3000/api/copilotkit
```

        This is often due to local DNS resolution issues in `/etc/hosts` or network configuration.
        Make sure your backend server is:
        - Running on the expected port
        - Accessible from your frontend
        - Not blocked by CORS or firewalls

        Check the [quickstart](/quickstart) to see how to set it up

## I am getting "CopilotKit's Remote Endpoint" not found error

If you're getting a "CopilotKit's Remote Endpoint not found" error, it usually means the server serving `/info` endpoint isn't accessible. Here's how to fix it:

        Refer to [Remote Python Endpoint](/guides/backend-actions/remote-backend-endpoint) to see how to set it up
        The `/info` endpoint should return agent or action information. Test it directly:

```bash
        curl -v -d '{}' http://localhost:8000/copilotkit/info
```
        The response looks something like this:
```bash
        * Host localhost:8000 was resolved.
        * IPv6: ::1
        * IPv4: 127.0.0.1
        *   Trying [::1]:8000...
        * connect to ::1 port 8000 from ::1 port 55049 failed: Connection refused
        *   Trying 127.0.0.1:8000...
        * Connected to localhost (127.0.0.1) port 8000
        > POST /copilotkit/info HTTP/1.1
        > Host: localhost:8000
        > User-Agent: curl/8.7.1
        > Accept: */*
        > Content-Length: 2
        > Content-Type: application/x-www-form-urlencoded
        >
        * upload completely sent off: 2 bytes
        < HTTP/1.1 200 OK
        < date: Thu, 16 Jan 2025 17:45:05 GMT
        < server: uvicorn
        < content-length: 214
        < content-type: application/json
        <
        * Connection #0 to host localhost left intact
        {"actions":[],"agents":[{"name":"my_agent","description":"A helpful agent.","type":"langgraph"},],"sdkVersion":"0.1.32"}%
```

        As you can see, it's a JSON response with your registered agents and actions, as well as the `200 OK` HTTP response status.
        If you see a different response, check your FastAPI logs for errors.

## Connection issues with tunnel creation

If you notice the tunnel creation process spinning indefinitely, your router or ISP might be blocking the connection to CopilotKit's tunnel service.

        To verify connectivity to the tunnel service, try these commands:

```bash
        ping tunnels.devcopilotkit.com
        curl -I https://tunnels.devcopilotkit.com
        telnet tunnels.devcopilotkit.com 443
```

        If these fail, your router's security features or ISP might be blocking the connection. Common solutions:
        - Check router security settings
        - Contact your ISP to verify if they're blocking the connection
        - Try a different network to confirm the issue

### Migrate to V2
- Route: `/microsoft-agent-framework/troubleshooting/migrate-to-v2`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/troubleshooting/migrate-to-v2.mdx`
- Description: Migration guide for upgrading to CopilotKit V2 frontend packages

## Overview

CopilotKit V2 consolidates the frontend into a single package. Both hooks and UI components are now exported from `@copilotkit/react-core/v2`. Your backend does not need any changes.

**What's changing:**

| Before | After |
|--------|-------|
| `@copilotkit/react-core` | `@copilotkit/react-core/v2` |
| `@copilotkit/react-ui` | `@copilotkit/react-core/v2` |
| `@copilotkit/react-ui/styles.css` | `@copilotkit/react-core/v2/styles.css` |

**What's NOT changing:**
- Backend packages (`@copilotkit/runtime`, etc.) — no changes needed
- Your `CopilotRuntime` configuration — stays the same
- Agent definitions and backend setup — stays the same

## Migration Steps

### Update `@copilotkit/react-core` imports

Replace imports from `@copilotkit/react-core` with `@copilotkit/react-core/v2`.

#### Before
```tsx
import { CopilotKit } from "@copilotkit/react-core";
import { useCopilotReadable, useCopilotAction } from "@copilotkit/react-core";
```

#### After
```tsx
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import { useAgent } from "@copilotkit/react-core/v2";
```

### Replace `@copilotkit/react-ui` imports

UI components like `CopilotChat`, `CopilotSidebar`, and `CopilotPopup` are now exported from `@copilotkit/react-core/v2`.

#### Before
```tsx
import { CopilotPopup } from "@copilotkit/react-ui";
import { CopilotSidebar } from "@copilotkit/react-ui";
import { CopilotChat } from "@copilotkit/react-ui";
```

#### After
```tsx
import { CopilotPopup } from "@copilotkit/react-core/v2";
import { CopilotSidebar } from "@copilotkit/react-core/v2";
import { CopilotChat } from "@copilotkit/react-core/v2";
```

### Update your styles import

#### Before
```tsx
import "@copilotkit/react-ui/styles.css";
```

#### After
```tsx
import "@copilotkit/react-core/v2/styles.css";
```

### Upgrade `@ag-ui/client` (if using directly)

If you import from `@ag-ui/client` directly, upgrade to the latest version:

```bash
npm install @ag-ui/client@latest
```

Note: If you only use CopilotKit's React packages, `@ag-ui/client` types are already re-exported from `@copilotkit/react-core/v2` and you don't need a separate install.

## Full Example

### Before

```tsx
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotPopup } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";

export function App() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit">
      <YourApp />
      <CopilotPopup />
    </CopilotKit>
  );
}
```

### After

```tsx
import { CopilotKitProvider, CopilotPopup } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";

export function App() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit">
      <YourApp />
      <CopilotPopup />
    </CopilotKitProvider>
  );
}
```
