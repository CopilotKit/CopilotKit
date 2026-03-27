# Microsoft Agent Framework — Core Setup

Core Setup guide for the Microsoft Agent Framework integration.

> For shared CopilotKit concepts (runtime setup, prebuilt components, troubleshooting, etc.), see the topic guides. This file focuses on framework-specific implementation details.

## Guidance
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
                import { CopilotKit } from "@copilotkit/react-core"; // [!code highlight]
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
