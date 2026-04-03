# Microsoft Agent Framework Integration

Microsoft Agent Framework integrates with CopilotKit via `agent-framework-ag-ui` (Python) or `Microsoft.Agents.AI.Hosting.AGUI.AspNetCore` (.NET). Both run as HTTP servers exposing AG-UI endpoints.

## Python

### Prerequisites

- Python 3.12+
- Node.js 20+
- OpenAI API key or Azure OpenAI credentials

### Python Dependencies

```toml
[project]
dependencies = [
    "agent-framework-ag-ui>=1.0.0b251117",
    "python-dotenv",
]
```

The `agent-framework-ag-ui` package pulls in the core `agent-framework` package.

### Agent Definition (agent/agent.py)

```python
from __future__ import annotations
from textwrap import dedent
from typing import Annotated

from agent_framework import ChatAgent, ChatClientProtocol, ai_function
from agent_framework_ag_ui import AgentFrameworkAgent
from pydantic import Field

# State schema for AG-UI shared state
STATE_SCHEMA: dict[str, object] = {
    "proverbs": {
        "type": "array",
        "items": {"type": "string"},
        "description": "Ordered list of the user's saved proverbs.",
    }
}

# Maps tool names to state fields for predictive state updates
PREDICT_STATE_CONFIG: dict[str, dict[str, str]] = {
    "proverbs": {
        "tool": "update_proverbs",
        "tool_argument": "proverbs",
    }
}

@ai_function(
    name="update_proverbs",
    description="Replace the entire list of proverbs with the provided values.",
)
def update_proverbs(
    proverbs: Annotated[
        list[str],
        Field(description="The complete source of truth for the user's proverbs."),
    ],
) -> str:
    return f"Proverbs updated. Tracking {len(proverbs)} item(s)."

@ai_function(
    name="get_weather",
    description="Share a quick weather update for a location.",
)
def get_weather(
    location: Annotated[str, Field(description="The city or region to describe.")],
) -> str:
    return f"The weather in {location.strip().title()} is mild with a light breeze."

@ai_function(
    name="go_to_moon",
    description="Request human-in-the-loop confirmation before launching.",
    approval_mode="always_require",
)
def go_to_moon() -> str:
    return "Mission control requested. Awaiting human approval."

def create_agent(chat_client: ChatClientProtocol) -> AgentFrameworkAgent:
    base_agent = ChatAgent(
        name="proverbs_agent",
        instructions=dedent("..."),  # Agent instructions
        chat_client=chat_client,
        tools=[update_proverbs, get_weather, go_to_moon],
    )
    return AgentFrameworkAgent(
        agent=base_agent,
        name="CopilotKitMicrosoftAgentFrameworkAgent",
        description="Manages proverbs, weather, and moon launches.",
        state_schema=STATE_SCHEMA,
        predict_state_config=PREDICT_STATE_CONFIG,
        require_confirmation=False,
    )
```

Key patterns:
- `@ai_function` decorator defines tools with `name`, `description`, and optional `approval_mode`
- `approval_mode="always_require"` enables human-in-the-loop approval
- `STATE_SCHEMA` defines the AG-UI shared state structure
- `PREDICT_STATE_CONFIG` maps state fields to tool names/arguments for predictive updates -- when a tool is called, the framework can predict the state change without waiting for execution
- `AgentFrameworkAgent` wraps the base `ChatAgent` for AG-UI compatibility

### Server (agent/main.py)

```python
from agent_framework.openai import OpenAIChatClient
from agent_framework_ag_ui import add_agent_framework_fastapi_endpoint
from fastapi import FastAPI

chat_client = OpenAIChatClient(
    model_id=os.getenv("OPENAI_CHAT_MODEL_ID", "gpt-4o-mini"),
    api_key=os.getenv("OPENAI_API_KEY"),
)
my_agent = create_agent(chat_client)

app = FastAPI()
add_agent_framework_fastapi_endpoint(app=app, agent=my_agent, path="/")
```

For Azure OpenAI:

```python
from agent_framework.azure import AzureOpenAIChatClient
from azure.identity import DefaultAzureCredential

chat_client = AzureOpenAIChatClient(
    credential=DefaultAzureCredential(),
    deployment_name=os.getenv("AZURE_OPENAI_CHAT_DEPLOYMENT_NAME", "gpt-4o-mini"),
    endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
)
```

### Environment

OpenAI:
```
OPENAI_API_KEY=sk-...
OPENAI_CHAT_MODEL_ID=gpt-4o-mini
```

Azure OpenAI:
```
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_CHAT_DEPLOYMENT_NAME=gpt-4o-mini
```

---

## .NET (C#)

### Prerequisites

- .NET 9.0 SDK
- Node.js 20+
- GitHub Personal Access Token (for GitHub Models API)

### Agent Definition (agent/Program.cs)

```csharp
using Microsoft.Agents.AI;
using Microsoft.Agents.AI.Hosting.AGUI.AspNetCore;
using Microsoft.Extensions.AI;

WebApplicationBuilder builder = WebApplication.CreateBuilder(args);
builder.Services.AddAGUI();

WebApplication app = builder.Build();

var agentFactory = new ProverbsAgentFactory(builder.Configuration, ...);
app.MapAGUI("/", agentFactory.CreateProverbsAgent());

await app.RunAsync();

public class ProverbsState
{
    public List<string> Proverbs { get; set; } = [];
}

public class ProverbsAgentFactory
{
    public AIAgent CreateProverbsAgent()
    {
        var chatClient = _openAiClient.GetChatClient("gpt-4o-mini").AsIChatClient();
        var chatClientAgent = new ChatClientAgent(
            chatClient,
            name: "ProverbsAgent",
            description: "...",
            tools: [
                AIFunctionFactory.Create(GetProverbs, ...),
                AIFunctionFactory.Create(AddProverbs, ...),
                AIFunctionFactory.Create(SetProverbs, ...),
                AIFunctionFactory.Create(GetWeather, ...),
            ]);
        return new SharedStateAgent(chatClientAgent, _jsonSerializerOptions);
    }
}
```

Key .NET patterns:
- `builder.Services.AddAGUI()` registers AG-UI services
- `app.MapAGUI("/", agent)` maps the AG-UI endpoint
- `SharedStateAgent` wraps `ChatClientAgent` for state management
- Tools are created via `AIFunctionFactory.Create()`
- Uses GitHub Models API (free tier) via OpenAI client with custom endpoint

### Setup

```bash
cd agent
dotnet user-secrets set GitHubToken "$(gh auth token)"
```

---

## Next.js Route (both Python and .NET)

```typescript
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";
import { NextRequest } from "next/server";

const runtime = new CopilotRuntime({
  agents: {
    my_agent: new HttpAgent({ url: "http://localhost:8000/" }),
  },
});

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter: new ExperimentalEmptyAdapter(),
    endpoint: "/api/copilotkit",
  });
  return handleRequest(req);
};
```

Both Python and .NET variants use `HttpAgent` from `@ag-ui/client`.
