# Microsoft Agent Framework Integration

CopilotKit implementation guide for Microsoft Agent Framework.

## Guidance
### Readables
- Route: `/microsoft-agent-framework/agent-app-context`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/agent-app-context.mdx`
- Description: Share app specific context with your agent.

```tsx title="YourComponent.tsx" showLineNumbers {1, 7-10}
        "use client" // only necessary if you are using Next.js with the App Router. // [!code highlight]
        import { useCopilotReadable } from "@copilotkit/react-core"; // [!code highlight]
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
    var agent = openAI.GetChatClient("gpt-4o-mini")
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
            deployment_name = os.getenv("AZURE_OPENAI_CHAT_DEPLOYMENT_NAME", "gpt-4o-mini")
            return AzureOpenAIChatClient(
                credential=DefaultAzureCredential(),
                deployment_name=deployment_name,
                endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
            )
        if bool(os.getenv("OPENAI_API_KEY")):
            return OpenAIChatClient(
                model_id=os.getenv("OPENAI_CHAT_MODEL_ID", "gpt-4o-mini"),
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

### Custom Sub-Components
- Route: `/microsoft-agent-framework/custom-look-and-feel/bring-your-own-components`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/custom-look-and-feel/bring-your-own-components.mdx`

```tsx
import { type UserMessageProps } from "@copilotkit/react-ui";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";

const CustomUserMessage = (props: UserMessageProps) => {
  const wrapperStyles = "flex items-center gap-2 justify-end mb-4";
  const messageStyles = "bg-blue-500 text-white py-2 px-4 rounded-xl break-words flex-shrink-0 max-w-[80%]";
  const avatarStyles = "bg-blue-500 shadow-sm min-h-10 min-w-10 rounded-full text-white flex items-center justify-center";

  return (
    <div className={wrapperStyles}>
      <div className={messageStyles}>{props.message?.content}</div>
      <div className={avatarStyles}>TS</div>
    </div>
  );
};

<CopilotKit>
  <CopilotSidebar UserMessage={CustomUserMessage} />
</CopilotKit>
```
```tsx
import { type AssistantMessageProps } from "@copilotkit/react-ui";
import { useChatContext } from "@copilotkit/react-ui";
import { Markdown } from "@copilotkit/react-ui";
import { SparklesIcon } from "@heroicons/react/24/outline";

import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";

const CustomAssistantMessage = (props: AssistantMessageProps) => {
  const { icons } = useChatContext();
  const { message, isLoading, subComponent } = props;

  const avatarStyles = "bg-zinc-400 border-zinc-500 shadow-lg min-h-10 min-w-10 rounded-full text-white flex items-center justify-center";
  const messageStyles = "px-4 rounded-xl pt-2";

  const avatar = <div className={avatarStyles}><SparklesIcon className="h-6 w-6" /></div>

  // [!code highlight:12]
  return (
    <div className="py-2">
      <div className="flex items-start">
        {!subComponent && avatar}
        <div className={messageStyles}>
          {message && <Markdown content={message.content || ""} /> }
          {isLoading && icons.spinnerIcon}
        </div>
      </div>
      <div className="my-2">{subComponent}</div>
    </div>
  );
};

<CopilotKit>
  <CopilotSidebar AssistantMessage={CustomAssistantMessage} />
</CopilotKit>
```
```tsx
import { type WindowProps, useChatContext, CopilotSidebar } from "@copilotkit/react-ui";
import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";
function Window({ children }: WindowProps) {
  const { open, setOpen } = useChatContext();

  if (!open) return null;

  // [!code highlight:15]
  return (
    <div 
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
      onClick={() => setOpen(false)}
    >
      <div 
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full h-[80vh] overflow-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex flex-col h-full">
          {children}
        </div>
      </div>
    </div>
  );
};

<CopilotKit>
  <CopilotSidebar Window={Window} />
</CopilotKit>
```
```tsx
import { type ButtonProps, useChatContext, CopilotSidebar } from "@copilotkit/react-ui";
import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";
function Button({}: ButtonProps) {
  const { open, setOpen } = useChatContext();

  const wrapperStyles = "w-24 bg-blue-500 text-white p-4 rounded-lg text-center cursor-pointer";

  // [!code highlight:10]
  return (
    <div onClick={() => setOpen(!open)} className={wrapperStyles}>
      <button
        className={`${open ? "open" : ""}`}
        aria-label={open ? "Close Chat" : "Open Chat"}
      >
        Ask AI
      </button>
    </div>
  );
};

<CopilotKit>
  <CopilotSidebar Button={Button} />
</CopilotKit>
```
```tsx
import { type HeaderProps, useChatContext, CopilotSidebar } from "@copilotkit/react-ui";
import { BookOpenIcon } from "@heroicons/react/24/outline";
import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";
function Header({}: HeaderProps) {
  const { setOpen, icons, labels } = useChatContext();

  // [!code highlight:15]
  return (
    <div className="flex justify-between items-center p-4 bg-blue-500 text-white">
      <div className="w-24">
        <a href="/">
          <BookOpenIcon className="w-6 h-6" />
        </a>
      </div>
      <div className="text-lg">{labels.title}</div>
      <div className="w-24 flex justify-end">
        <button onClick={() => setOpen(false)} aria-label="Close">
          {icons.headerCloseIcon}
        </button>
      </div>
    </div>
  );
};

<CopilotKit>
  <CopilotSidebar Header={Header} />
</CopilotKit>
```
```tsx
import { type MessagesProps, CopilotSidebar } from "@copilotkit/react-ui";
import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";

export default function CustomMessages({
  messages,
  inProgress,
  RenderMessage,
}: MessagesProps) {
  const wrapperStyles = "p-4 flex flex-col gap-2 h-full overflow-y-auto bg-indigo-300";

  // [!code highlight:14]
  return (
    <div className={wrapperStyles}>
      {messages.map((message, index) => {
        const isCurrentMessage = index === messages.length - 1;
        return <RenderMessage
          key={index}
          message={message}
          inProgress={inProgress}
          index={index}
          isCurrentMessage={isCurrentMessage}
        />
      })}
    </div>
  );
}

<CopilotKit>
  <CopilotSidebar Messages={CustomMessages} />
</CopilotKit>
```
```tsx
        import { CopilotKit } from "@copilotkit/react-core";
        import {
            CopilotSidebar,
            type CopilotChatSuggestion,
            RenderSuggestion,
            type RenderSuggestionsListProps
        } from "@copilotkit/react-ui";
        import "@copilotkit/react-ui/styles.css";

        const CustomSuggestionsList = ({ suggestions, onSuggestionClick }: RenderSuggestionsListProps) => {
            return (
                <div className="suggestions flex flex-col gap-2 p-4">
                    <h1>Try asking:</h1>
                    <div className="flex gap-2">
                        {suggestions.map((suggestion: CopilotChatSuggestion, index) => (
                            <RenderSuggestion
                            key={index}
                                      title={suggestion.title}
                                      message={suggestion.message}
                                      partial={suggestion.partial}
                                      className="rounded-md border border-gray-500 bg-white px-2 py-1 shadow-md"
                                      onClick={() => onSuggestionClick(suggestion.message)}
                            />
                        ))}
                    </div>
                </div>
            );
        };

        <CopilotKit>
            <CopilotSidebar RenderSuggestionsList={CustomSuggestionsList} />
        </CopilotKit>
```
```tsx
import { type InputProps, CopilotSidebar } from "@copilotkit/react-ui";
import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";
function CustomInput({ inProgress, onSend, isVisible }: InputProps) {
  const handleSubmit = (value: string) => {
    if (value.trim()) onSend(value);
  };

  const wrapperStyle = "flex gap-2 p-4 border-t";
  const inputStyle = "flex-1 p-2 rounded-md border border-gray-300 focus:outline-none focus:border-blue-500 disabled:bg-gray-100";
  const buttonStyle = "px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed";

  // [!code highlight:27]
  return (
    <div className={wrapperStyle}>
      <input 
        disabled={inProgress}
        type="text" 
        placeholder="Ask your question here..." 
        className={inputStyle}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            handleSubmit(e.currentTarget.value);
            e.currentTarget.value = '';
          }
        }}
      />
      <button 
        disabled={inProgress}
        className={buttonStyle}
        onClick={(e) => {
          const input = e.currentTarget.previousElementSibling as HTMLInputElement;
          handleSubmit(input.value);
          input.value = '';
        }}
      >
        Ask
      </button>
    </div>
  );
}

<CopilotKit>
  <CopilotSidebar Input={CustomInput} />
</CopilotKit>
```
```tsx
"use client" // only necessary if you are using Next.js with the App Router.
import { useCopilotAction } from "@copilotkit/react-core"; 

// Your custom components (examples - implement these in your app)
import { LoadingView } from "./loading-view"; // Your loading component
import { CalendarMeetingCardComponent, type CalendarMeetingCardProps } from "./calendar-meeting-card"; // Your meeting card component

export function YourComponent() {
  useCopilotAction({ 
    name: "showCalendarMeeting",
    description: "Displays calendar meeting information",
    parameters: [
      {
        name: "date",
        type: "string",
        description: "Meeting date (YYYY-MM-DD)",
        required: true
      },
      {
        name: "time",
        type: "string",
        description: "Meeting time (HH:mm)",
        required: true
      },
      {
        name: "meetingName",
        type: "string",
        description: "Name of the meeting",
        required: false
      }
    ],
    render: ({ status, args }) => {
      const { date, time, meetingName } = args;

      if (status === 'inProgress') {
        return <LoadingView />; // Your own component for loading state
      } else {
        const meetingProps: CalendarMeetingCardProps = {
          date: date,
          time,
          meetingName
        };
        return <CalendarMeetingCardComponent {...meetingProps} />;
      }
    },
  });

  return (
    <>...</>
  );
}
```
```tsx
"use client"; // only necessary if you are using Next.js with the App Router.

import { useCoAgentStateRender } from "@copilotkit/react-core";
import { Progress } from "./progress";

type AgentState = {
  logs: string[];
}

useCoAgentStateRender<AgentState>({
  name: "basic_agent",
  render: ({ state, nodeName, status }) => {
    if (!state.logs || state.logs.length === 0) {
      return null;
    }

    // Progress is a component we are omitting from this example for brevity.
    return <Progress logs={state.logs} />; 
  },
});
```
```tsx
import {
  type CopilotChatReasoningMessageProps,
} from "@copilotkit/react-ui";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";

function CustomReasoningMessage({
  message,
  messages,
  isRunning,
}: CopilotChatReasoningMessageProps) {
  const isLatest = messages?.[messages.length - 1]?.id === message.id;
  const isStreaming = !!(isRunning && isLatest);

  if (!message.content && !isStreaming) return null;

  // [!code highlight:8]
  return (
    <details open={isStreaming} className="my-2 rounded border p-3">
      <summary className="cursor-pointer font-medium text-sm">
        {isStreaming ? "🧠 Thinking…" : "💡 View reasoning"}
      </summary>
      <p className="mt-2 text-sm text-gray-600 whitespace-pre-wrap">
        {message.content}
      </p>
    </details>
  );
}

<CopilotKit>
  <CopilotSidebar
    messageView={{
      reasoningMessage: CustomReasoningMessage,
    }}
  />
</CopilotKit>
```

### Styling Copilot UI
- Route: `/microsoft-agent-framework/custom-look-and-feel/customize-built-in-ui-components`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/custom-look-and-feel/customize-built-in-ui-components.mdx`

CopilotKit has a variety of ways to customize colors and structures of the Copilot UI components.
- [CSS Variables](#css-variables-easiest)
- [Custom CSS](#custom-css)
- [Custom Icons](#custom-icons)
- [Custom Labels](#custom-labels)

If you want to customize the style as well as the functionality of the Copilot UI, you can also try the following:
- [Custom Sub-Components](/custom-look-and-feel/bring-your-own-components)
- [Fully Headless UI](/custom-look-and-feel/headless-ui)

## CSS Variables (Easiest)
The easiest way to change the colors using in the Copilot UI components is to override CopilotKit CSS variables.

  Hover over the interactive UI elements below to see the available CSS variables.

Once you've found the right variable, you can import `CopilotKitCSSProperties` and simply wrap CopilotKit in a div and override the CSS variables.

```tsx
import { CopilotKitCSSProperties } from "@copilotkit/react-ui";

<div
  // [!code highlight:5]
  style={
    {
      "--copilot-kit-primary-color": "#222222",
    } as CopilotKitCSSProperties
  }
>
  <CopilotSidebar .../>
</div>
```

### Reference

| CSS Variable | Description |
|-------------|-------------|
| `--copilot-kit-primary-color` | Main brand/action color - used for buttons, interactive elements |
| `--copilot-kit-contrast-color` | Color that contrasts with primary - used for text on primary elements |
| `--copilot-kit-background-color` | Main page/container background color |
| `--copilot-kit-secondary-color` | Secondary background - used for cards, panels, elevated surfaces |
| `--copilot-kit-secondary-contrast-color` | Primary text color for main content |
| `--copilot-kit-separator-color` | Border color for dividers and containers |
| `--copilot-kit-muted-color` | Muted color for disabled/inactive states |

## Custom CSS

In addition to customizing the colors, the CopilotKit CSS is structured to easily allow customization via CSS classes.

```css title="globals.css"
.copilotKitButton {
  border-radius: 0;
}

.copilotKitMessages {
  padding: 2rem;
}

.copilotKitUserMessage {
  background: #007AFF;
}
```

### Reference

For a full list of styles and classes used in CopilotKit, click [here](https://github.com/CopilotKit/CopilotKit/blob/main/src/v1.x/packages/react-ui/src/css/).

| CSS Class | Description |
|-----------|-------------|
| `.copilotKitMessages` | Main container for all chat messages with scroll behavior and spacing |
| `.copilotKitInput` | Text input container with typing area and send button |
| `.copilotKitUserMessage` | Styling for user messages including background, text color and bubble shape |
| `.copilotKitAssistantMessage` | Styling for AI responses including background, text color and bubble shape |
| `.copilotKitHeader` | Top bar of chat window containing title and controls |
| `.copilotKitButton` | Primary chat toggle button with hover and active states |
| `.copilotKitWindow` | Root container defining overall chat window dimensions and position |
| `.copilotKitMarkdown` | Styles for rendered markdown content including lists, links and quotes |
| `.copilotKitCodeBlock` | Code snippet container with syntax highlighting and copy button |
| `.copilotKitChat` | Base chat layout container handling positioning and dimensions |
| `.copilotKitSidebar` | Styles for sidebar chat mode including width and animations |
| `.copilotKitPopup` | Styles for popup chat mode including position and animations |
| `.copilotKitButtonIcon` | Icon styling within the main chat toggle button |
| `.copilotKitButtonIconOpen` `.copilotKitButtonIconClose` | Icon states for when chat is open/closed |
| `.copilotKitCodeBlockToolbar` | Top bar of code blocks with language and copy controls |
| `.copilotKitCodeBlockToolbarLanguage` | Language label styling in code block toolbar |
| `.copilotKitCodeBlockToolbarButtons` | Container for code block action buttons |
| `.copilotKitCodeBlockToolbarButton` | Individual button styling in code block toolbar |
| `.copilotKitSidebarContentWrapper` | Inner container for sidebar mode content |
| `.copilotKitInputControls` | Container for input area buttons and controls |
| `.copilotKitActivityDot1` `.copilotKitActivityDot2` `.copilotKitActivityDot3` | Animated typing indicator dots |
| `.copilotKitDevConsole` | Development debugging console container |
| `.copilotKitDevConsoleWarnOutdated` | Warning styles for outdated dev console |
| `.copilotKitVersionInfo` | Version information display styles |
| `.copilotKitDebugMenuButton` | Debug menu toggle button styling |
| `.copilotKitDebugMenu` | Debug options menu container |
| `.copilotKitDebugMenuItem` | Individual debug menu option styling |

## Custom Fonts
You can customize the fonts by updating the `fontFamily` property in the various CSS classes that are used in the CopilotKit.

```css title="globals.css"
.copilotKitMessages {
  font-family: "Arial, sans-serif";
}

.copilotKitInput {
  font-family: "Arial, sans-serif";
}
```

### Reference
You can update the main content classes to change the font family for the various components.

| CSS Class | Description |
|-----------|-------------|
| `.copilotKitMessages` | Main container for all messages |
| `.copilotKitInput` | The input field |
| `.copilotKitMessage` | Base styling for all chat messages |
| `.copilotKitUserMessage` | User messages |
| `.copilotKitAssistantMessage` | AI responses |

## Custom Icons

You can customize the icons by passing the `icons` property to the `CopilotSidebar`, `CopilotPopup` or `CopilotChat` component.

```tsx
<CopilotChat
  icons={{
    // Use your own icons here – any React nodes
    openIcon: <YourOpenIconComponent />,
    closeIcon: <YourCloseIconComponent />,
  }}
/>
```

### Reference

| Icon | Description |
|--------------|-------------|
| `openIcon` | The icon to use for the open chat button |
| `closeIcon` | The icon to use for the close chat button |
| `headerCloseIcon` | The icon to use for the close chat button in the header |
| `sendIcon` | The icon to use for the send button |
| `activityIcon` | The icon to use for the activity indicator |
| `spinnerIcon` | The icon to use for the spinner |
| `stopIcon` | The icon to use for the stop button |
| `regenerateIcon` | The icon to use for the regenerate button |
| `pushToTalkIcon` | The icon to use for push to talk |

## Custom Labels

To customize labels, pass the `labels` property to the `CopilotSidebar`, `CopilotPopup` or `CopilotChat` component.

```tsx
<CopilotChat
  labels={{
    initial: "Hello! How can I help you today?",
    title: "My Copilot",
    placeholder: "Ask me anything!",
    stopGenerating: "Stop",
    regenerateResponse: "Regenerate",
  }} 
/>
```

### Reference

| Label | Description |
|---------------|-------------|
| `initial` | The initial message(s) to display in the chat window |
| `title` | The title to display in the header |
| `placeholder` | The placeholder to display in the input |
| `stopGenerating` | The label to display on the stop button |
| `regenerateResponse` | The label to display on the regenerate button |

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
    import { useCopilotChatHeadless_c } from "@copilotkit/react-core"; // [!code highlight]

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
import { useCopilotAction } from "@copilotkit/react-core";

export const Chat = () => {
  // ...

  // Define an action that will show a custom component
  useCopilotAction({
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
import { useCopilotChatHeadless_c, useCopilotChatSuggestions } from "@copilotkit/react-core"; // [!code highlight]

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
import { useCopilotChatHeadless_c } from "@copilotkit/react-core";

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
import { useCopilotAction, useCopilotChatHeadless_c } from "@copilotkit/react-core";

export const Chat = () => {
  const { messages, sendMessage } = useCopilotChatHeadless_c();

  // Define an action that will wait for the user to enter their name
  useCopilotAction({
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
import { useHumanInTheLoop, useCopilotChatHeadless_c } from "@copilotkit/react-core";

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

### Markdown rendering
- Route: `/microsoft-agent-framework/custom-look-and-feel/markdown-rendering`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/custom-look-and-feel/markdown-rendering.mdx`

```tsx
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar, ComponentsMap } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
// We will include the styles in a separate css file, for convenience
import "./styles.css";

function YourComponent() {
    const customMarkdownTagRenderers: ComponentsMap<{ "reference-chip": { href: string } }> = {
        // You can make up your own tags, or use existing, valid HTML ones!
        "reference-chip": ({ children, href }) => {
            return (
                <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="w-fit border rounded-xl py-1 px-2 text-xs" // Classes list trimmed for brevity
                >
                    {children}
                    <LinkIcon className="w-3.5 h-3.5" />
                </a>
            );
        },
    };

    return (
        <CopilotKit>
          <CopilotSidebar
            // For demonstration, we'll force the LLM to return our reference chip in every message
            instructions={`
                You are a helpful assistant.
                End each message with a reference chip,
                like so: <reference-chip href={href}>{title}</reference-chip>
            `}
            markdownTagRenderers={customMarkdownTagRenderers}
          />
        </CopilotKit>
    )
}
```
```css
.reference-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background-color: #f0f1f2;
    color: #444;
    border-radius: 12px;
    padding: 2px 8px;
    font-size: 0.8rem;
    font-weight: 500;
    text-decoration: none;
    margin: 0 2px;
    border: 1px solid #e0e0e0;
    cursor: pointer;
    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
}
```

### Frontend Tools
- Route: `/microsoft-agent-framework/frontend-actions`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/frontend-actions.mdx`
- Description: Create frontend tools and use them within your Microsoft Agent Framework agent.

```tsx title="page.tsx"
        import { useFrontendTool } from "@copilotkit/react-core" // [!code highlight]

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
                        deployment_name=os.getenv("AZURE_OPENAI_CHAT_DEPLOYMENT_NAME", "gpt-4o-mini"),
                        endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
                    )
                if bool(os.getenv("OPENAI_API_KEY")):
                    return OpenAIChatClient(
                        model_id=os.getenv("OPENAI_CHAT_MODEL_ID", "gpt-4o-mini"),
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

### Agent State
- Route: `/microsoft-agent-framework/generative-ui/agentic`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/generative-ui/agentic.mdx`
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
    import { useCoAgentStateRender } from "@copilotkit/react-core";

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
      useCoAgentStateRender<AgentState>({
        name: "sample_agent", // the name the agent is served as
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
    import { useCoAgent } from "@copilotkit/react-core"; // [!code highlight]
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
      const { state } = useCoAgent<AgentState>({
        name: "sample_agent", // the name the agent is served as
      })

      // ...

      return (
        <div>
          {/* ... */}
          <div className="flex flex-col gap-2 mt-4">
            {/* [!code highlight:5] */}
            {state.searches?.map((search, index) => (
              <div key={index} className="flex flex-row">
                {search.done ? "✅" : "❌"} {search.query}
              </div>
            ))}
          </div>
        </div>
      )
    }
```

### Backend Tools
- Route: `/microsoft-agent-framework/generative-ui/backend-tools`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/generative-ui/backend-tools.mdx`
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
import { useCopilotAction } from "@copilotkit/react-core"; // [!code highlight]
// ...

const YourMainContent = () => {
  // ...
  // [!code highlight:12]
  useCopilotAction({
    name: "get_weather",
    available: "disabled", // Don't allow the agent or UI to call this tool as its only for rendering
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

### Frontend Tools
- Route: `/microsoft-agent-framework/generative-ui/frontend-tools`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/generative-ui/frontend-tools.mdx`
- Description: Create frontend tools and use them within your Microsoft Agent Framework agent.

```tsx title="page.tsx"
        import { useFrontendTool } from "@copilotkit/react-core" // [!code highlight]

        export function Page() {
          // ...

          // [!code highlight:25]
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
            handler({ name }) {
              // Handler returns the result of the tool call
              return { currentURLPath: window.location.href, userName: name };
            },
            render: ({ args }) => {
              // Renders UI based on the data of the tool call
              return (
                <div>
                  <h1>Hello, {args.name}!</h1>
                  <h1>You're currently on {window.location.href}</h1>
                </div>
              );
            },
          });

          // ...
        }
```
```csharp title="Program.cs"
            using Microsoft.Agents.AI;
            using Microsoft.Agents.AI.Hosting.AGUI.AspNetCore;
            using OpenAI;

            var builder = WebApplication.CreateBuilder(args);
            builder.Services.AddAGUI();
            var app = builder.Build();

            var githubToken = builder.Configuration["GitHubToken"]!;
            var openAI = new OpenAIClient(
                new System.ClientModel.ApiKeyCredential(githubToken),
                new OpenAIClientOptions { Endpoint = new Uri("https://models.inference.ai.azure.com") });

            // Create the agent - frontend tools are automatically available
            var agent = openAI.GetChatClient("gpt-4o-mini")
                .CreateAIAgent(name: "SampleAgent", instructions: "You are a helpful assistant.");

            // Map the AG-UI endpoint
            app.MapAGUI("/", agent);
            app.Run("http://localhost:8000");
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
                        deployment_name=os.getenv("AZURE_OPENAI_CHAT_DEPLOYMENT_NAME", "gpt-4o-mini"),
                        endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
                    )
                if bool(os.getenv("OPENAI_API_KEY")):
                    return OpenAIChatClient(
                        model_id=os.getenv("OPENAI_CHAT_MODEL_ID", "gpt-4o-mini"),
                        api_key=os.getenv("OPENAI_API_KEY"),
                    )
                raise RuntimeError("Set AZURE_OPENAI_* or OPENAI_API_KEY in agent/.env")

            chat_client = _build_chat_client()
            # Frontend tools registered with useFrontendTool are automatically available
            # to the agent through the AG-UI protocol.
            agent = ChatAgent(
                name="sample_agent",
                instructions="You are a helpful assistant.",
                chat_client=chat_client,
            )

            app = FastAPI(title="AG-UI Server (Python)")
            add_agent_framework_fastapi_endpoint(app=app, agent=agent, path="/")
```

### Generative UI
- Route: `/microsoft-agent-framework/generative-ui`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/generative-ui/index.mdx`
- Description: Render your agent's behavior with custom UI components.

This example shows our [Research Canvas](/langgraph/videos/research-canvas) making use of Generative UI!

## What is Generative UI?

Generative UI lets you render your agent's state, progress, outputs, and tool calls with custom UI components in real-time. It bridges the gap between AI
agents and user interfaces. As your agent processes information and makes decisions, you can render custom UI components that:

- Show loading states and progress indicators
- Display structured data in tables, cards, or charts
- Create interactive elements for user input
- Animate transitions between different states

## How can I use this?

To get started, you first need to decide what is going to be backing your generative UI. There are three main variants of Generative UI with CopilotKit for Microsoft Agent Framework.

### Human-in-the-loop
- Route: `/microsoft-agent-framework/human-in-the-loop`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/human-in-the-loop.mdx`
- Description: Create frontend tools and use them within your agent framework agent.

```tsx title="page.tsx"
        import { useHumanInTheLoop } from "@copilotkit/react-core" // [!code highlight]

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
                        deployment_name=os.getenv("AZURE_OPENAI_CHAT_DEPLOYMENT_NAME", "gpt-4o-mini"),
                        endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
                    )
                if bool(os.getenv("OPENAI_API_KEY")):
                    return OpenAIChatClient(
                        model_id=os.getenv("OPENAI_CHAT_MODEL_ID", "gpt-4o-mini"),
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
    import { useCopilotChatHeadless_c } from "@copilotkit/react-core"; // [!code highlight]

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
import { useCopilotAction } from "@copilotkit/react-core";

export const Chat = () => {
  // ...

  // Define an action that will show a custom component
  useCopilotAction({
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
import { useCopilotChatHeadless_c, useCopilotChatSuggestions } from "@copilotkit/react-core"; // [!code highlight]

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
import { useCopilotChatHeadless_c } from "@copilotkit/react-core";

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
import { useCopilotAction, useCopilotChatHeadless_c } from "@copilotkit/react-core";

export const Chat = () => {
  const { messages, sendMessage } = useCopilotChatHeadless_c();

  // Define an action that will wait for the user to enter their name
  useCopilotAction({
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

### Inspector
- Route: `/microsoft-agent-framework/premium/inspector`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/premium/inspector.mdx`
- Description: Inspector for debugging actions, readables, agent status, messages, and context.

The Copilot Inspector is a debugging aid, accessible from a copilotkit button overlaid on your app, which allows you to see the information, state and conversation between them and you (the user).

  The Inspector is available to CopilotKit Premium users. Get a free public
  license key on [Copilot Cloud](https://cloud.copilotkit.ai) or read more about{" "}

## What it shows

- Actions: Registered actions and parameter schemas
- Readables: Context/readables available to the agent
- Agent Status: Coagent states and running/completion info
- Messages: Conversation history
- Context: Document context fed into the model

## Requirements

- Provide `publicLicenseKey` to `` to enable premium features:

```tsx
<CopilotKit publicLicenseKey={process.env.NEXT_PUBLIC_COPILOTKIT_LICENSE_KEY}>
  {children}
</CopilotKit>
```

## How to open

A draggable circular trigger is rendered in-app. Click to open the Inspector.
If no license key is configured, you’ll see a "Get License Key" prompt.

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
import { CopilotChat } from "@copilotkit/react-ui";
import { CopilotKit } from "@copilotkit/react-core";

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
import { CopilotKit } from "@copilotkit/react-core";

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
import { CopilotChat } from "@copilotkit/react-ui";

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
                        OPENAI_CHAT_MODEL_ID=gpt-4o-mini
```

```bash title="agent/.env (Azure OpenAI)"
                        AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
                        AZURE_OPENAI_CHAT_DEPLOYMENT_NAME=gpt-4o-mini
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

                        var chatClient = openAI.GetChatClient("gpt-4o-mini").AsIChatClient();
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
                                deployment_name = os.getenv("AZURE_OPENAI_CHAT_DEPLOYMENT_NAME", "gpt-4o-mini")
                                return AzureOpenAIChatClient(
                                    credential=DefaultAzureCredential(),
                                    deployment_name=deployment_name,
                                    endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
                                )

                            if bool(os.getenv("OPENAI_API_KEY")):
                                return OpenAIChatClient(
                                    model_id=os.getenv("OPENAI_CHAT_MODEL_ID", "gpt-4o-mini"),
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
                        OPENAI_CHAT_MODEL_ID=gpt-4o-mini
                        # or Azure OpenAI (agent/.env)
                        AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
                        AZURE_OPENAI_CHAT_DEPLOYMENT_NAME=gpt-4o-mini
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
                import { CopilotKit } from "@copilotkit/react-core"; // [!code highlight]
                import "@copilotkit/react-ui/styles.css";

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
              import { CopilotSidebar } from "@copilotkit/react-ui";

              export default function Page() {
                return (
                  <main>
                    {/* [!code highlight:6] */}
                    <CopilotSidebar
                      labels={{
                        title: "Your Assistant",
                        initial: "Hi! How can I help you today?",
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
    import { useCoAgent } from "@copilotkit/react-core"; // [!code highlight]

    // Define the agent state type, should match the actual state of your agent
    type AgentState = {
      language: "english" | "spanish";
    }

    function YourMainContent() {
      // [!code highlight:4]
      const { state } = useCoAgent<AgentState>({
        name: "sample_agent",
        initialState: { language: "english" }  // optionally provide an initial state
      });

      // ...

      return (
        // style excluded for brevity
        <div>
          <h1>Your main content</h1>
          {/* [!code highlight:1] */}
          <p>Language: {state.language}</p>
        </div>
      );
    }
```
```tsx title="ui/app/page.tsx"
import { useCoAgentStateRender } from "@copilotkit/react-core"; // [!code highlight]

// Define the agent state type, should match the actual state of your agent
type AgentState = {
  language: "english" | "spanish";
}

function YourMainContent() {
  // ...
  // [!code highlight:7]
  useCoAgentStateRender({
    name: "sample_agent",
    render: ({ state }) => {
      if (!state.language) return null;
      return <div>Language: {state.language}</div>;
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
    import { useCoAgent } from "@copilotkit/react-core"; // [!code highlight]

    // Define the agent state type, should match the actual state of your agent
    type AgentState = {
      language: "english" | "spanish";
    }

    // Example usage in a pseudo React component
    function YourMainContent() {
      const { state, setState } = useCoAgent<AgentState>({ // [!code highlight]
        name: "sample_agent",
        initialState: { language: "english" }  // optionally provide an initial state
      });

      // ...

      const toggleLanguage = () => {
        setState({ language: state.language === "english" ? "spanish" : "english" }); // [!code highlight]
      };

      // ...

      return (
        // style excluded for brevity
        <div>
          <h1>Your main content</h1>
          {/* [!code highlight:1] */}
          <p>Language: {state.language}</p>
          <button onClick={toggleLanguage}>Toggle Language</button>
        </div>
      );
    }
```
```tsx title="ui/app/page.tsx"
import { useCoAgent } from "@copilotkit/react-core";
import { TextMessage, MessageRole } from "@copilotkit/runtime-client-gql";  // [!code highlight]

// ...

function YourMainContent() {
  // [!code word:run:1]
  const { state, setState, run } = useCoAgent<AgentState>({
    name: "sample_agent",
    initialState: { language: "english" }  // optionally provide an initial state
  });

  // setup to be called when some event in the app occurs
  const toggleLanguage = () => {
    const newLanguage = state.language === "english" ? "spanish" : "english";
    setState({ language: newLanguage });

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
    import { useCoAgent, useCoAgentStateRender } from "@copilotkit/react-core";

    type AgentState = {
      observed_steps: string[];
    };

    export default function Page() {
      // Access both predicted and final states
      const { state } = useCoAgent<AgentState>({ name: "sample_agent" });

      // Observe predictions (render inside the chat)
      useCoAgentStateRender<AgentState>({
        name: "sample_agent",
        render: ({ state }) => {
          if (!state.observed_steps?.length) return null;
          return (
            <div>
              <h3>Current Progress:</h3>
              <ul>
                {state.observed_steps.map((step, i) => (
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

### useAgent Hook
- Route: `/microsoft-agent-framework/use-agent-hook`
- Source: `docs/content/docs/integrations/microsoft-agent-framework/use-agent-hook.mdx`
- Description: Access and interact with your Microsoft Agent Framework agent directly from React components

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

## See Also

- [useAgent API Reference](/reference/v1/hooks/useAgent) - Complete API documentation
