# Agno Integration

Agno is a Python agent framework with built-in AG-UI support via `AgentOS`. The integration is straightforward -- Agno's `AGUI` interface handles the AG-UI protocol natively.

## Prerequisites

- Python 3.12+
- Node.js 20+
- OpenAI API key

## Python Dependencies

```toml
[project]
dependencies = [
    "agno>=1.7.8",
    "openai>=1.88.0",
    "yfinance>=0.2.63",
    "fastapi>=0.115.13",
    "uvicorn>=0.34.3",
    "ag-ui-protocol>=0.1.8",
    "python-dotenv>=1.0.0",
]
```

## Agent Definition (agent/src/agent.py)

```python
from agno.agent.agent import Agent
from agno.models.openai import OpenAIChat
from agno.tools.yfinance import YFinanceTools
from .tools.backend import get_weather
from .tools.frontend import add_proverb, set_theme_color

agent = Agent(
    model=OpenAIChat(id="gpt-4o"),
    tools=[
        # Backend tools -- executed on the server
        YFinanceTools(),
        get_weather,
        # Frontend tools -- executed on the client
        add_proverb,
        set_theme_color,
    ],
    description="You are a demonstrative agent for Agno and CopilotKit's integration.",
    instructions="Format your response using markdown and use tables to display data where possible.",
)
```

Key patterns:
- Agno has built-in tool collections like `YFinanceTools()` for financial data
- Frontend and backend tools are mixed in the same `tools` list -- the distinction is handled by the AG-UI adapter

## Server (agent/main.py)

```python
import dotenv
from agno.os import AgentOS
from agno.os.interfaces.agui import AGUI
from src.agent import agent

dotenv.load_dotenv()

# Build AgentOS with the AGUI interface
agent_os = AgentOS(agents=[agent], interfaces=[AGUI(agent=agent)])
app = agent_os.get_app()

if __name__ == "__main__":
    agent_os.serve(app="main:app", port=8000, reload=True)
```

Key patterns:
- `AgentOS` is Agno's application container -- it manages agents and interfaces
- `AGUI(agent=agent)` registers the AG-UI interface for the agent
- `agent_os.get_app()` returns a FastAPI/ASGI app
- The AG-UI endpoint is served at `/agui` by default

## Next.js Route (src/app/api/copilotkit/route.ts)

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
    agno_agent: new HttpAgent({ url: "http://localhost:8000/agui" }),
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

Note the URL path is `/agui` -- this is where Agno's `AGUI` interface mounts.

## Environment

```bash
export OPENAI_API_KEY="your-openai-api-key-here"
# Or create agent/.env with the key
```
