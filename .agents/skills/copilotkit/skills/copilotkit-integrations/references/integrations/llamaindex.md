# LlamaIndex Integration

LlamaIndex integrates with CopilotKit via the `llama-index-protocols-ag-ui` package, which provides a FastAPI router for AG-UI-compatible workflows.

## Prerequisites

- Python 3.9+ (< 3.14)
- Node.js 18+
- `uv` for Python dependency management
- OpenAI API key

## Python Dependencies

```toml
[project]
dependencies = [
    "llama-index-core>=0.14,<0.15",
    "llama-index-llms-openai>=0.5.0,<0.6.0",
    "llama-index-protocols-ag-ui>=0.2.2",
    "uvicorn>=0.27.0",
    "fastapi>=0.100.0",
    "python-dotenv>=1.0.0",
]
```

## Agent Definition (agent/src/agent.py)

LlamaIndex uses `get_ag_ui_workflow_router` to create a FastAPI router with frontend and backend tools:

```python
from typing import Annotated
from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router

# Frontend tool -- executed on the client, agent just sees the return string
def change_theme_color(
    theme_color: Annotated[str, "The hex color value. i.e. '#123456'"],
) -> str:
    """Change the background color of the chat."""
    return f"Changing background to {theme_color}"

async def add_proverb(
    proverb: Annotated[str, "The proverb to add. Make it witty, short and concise."],
) -> str:
    """Add a proverb to the list of proverbs."""
    return f"Added proverb: {proverb}"

# Backend tool -- executed on the server
async def get_weather(
    location: Annotated[str, "The location to get the weather for."],
) -> str:
    """Get the weather for a given location."""
    return f"The weather in {location} is sunny and 70 degrees."

agentic_chat_router = get_ag_ui_workflow_router(
    llm=OpenAI(model="gpt-4.1"),
    frontend_tools=[change_theme_color, add_proverb],
    backend_tools=[get_weather],
    system_prompt="You are a helpful assistant that can add proverbs, get weather, and change the background color.",
    initial_state={
        "proverbs": ["CopilotKit may be new, but its the best thing since sliced bread."],
    },
)
```

Key patterns:
- `get_ag_ui_workflow_router()` creates a complete FastAPI router with AG-UI support
- Tools are split into `frontend_tools` (executed client-side, agent sees the return string as a placeholder) and `backend_tools` (executed server-side)
- `initial_state` sets the starting shared state
- Tools use Python type annotations (`Annotated[str, "description"]`) for parameter descriptions -- no separate schema definitions needed

## FastAPI Server (agent/main.py)

```python
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI
from src.agent import agentic_chat_router

app = FastAPI()
app.include_router(agentic_chat_router)

def main():
    load_dotenv()
    uvicorn.run("main:app", host="127.0.0.1", port=9000, reload=True)

if __name__ == "__main__":
    main()
```

Note: LlamaIndex defaults to port **9000** (not 8000).

## Next.js Route (src/app/api/copilotkit/route.ts)

```typescript
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LlamaIndexAgent } from "@ag-ui/llamaindex";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const runtime = new CopilotRuntime({
    agents: {
      sample_agent: new LlamaIndexAgent({
        url: "http://127.0.0.1:9000/run",
      }),
    },
  });

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter: new ExperimentalEmptyAdapter(),
    endpoint: `/api/copilotkit`,
  });
  return handleRequest(request);
}
```

LlamaIndex uses `LlamaIndexAgent` from `@ag-ui/llamaindex`. Note the URL path is `/run` (appended to the base URL).

## Environment

```bash
export OPENAI_API_KEY="your-openai-api-key-here"
```
