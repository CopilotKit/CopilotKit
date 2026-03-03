# Microsoft Agent Framework Integration

CopilotKit implementation guide for Microsoft Agent Framework.

> For shared CopilotKit concepts (runtime setup, prebuilt components, troubleshooting, etc.), see the topic guides. This file focuses on framework-specific implementation details.

## Guidance
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
