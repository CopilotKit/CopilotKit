# Strands Integration

AWS Strands Agents integrates with CopilotKit via `ag_ui_strands`. It features explicit control over tool behaviors including state extraction from tool arguments and prompt injection.

## Prerequisites

- Python 3.12+ (< 3.14)
- Node.js 20+
- OpenAI API key

## Python Dependencies

```toml
[project]
dependencies = [
    "ag-ui-protocol>=0.1.5",
    "fastapi>=0.115.12",
    "uvicorn>=0.34.3",
    "strands-agents[OpenAI]>=1.15.0",
    "strands-agents-tools>=0.2.14",
    "ag_ui_strands~=0.1.0",
]
```

## Agent Definition (agent/main.py)

```python
import json
import os
from typing import List

from ag_ui_strands import (
    StrandsAgent,
    StrandsAgentConfig,
    ToolBehavior,
    create_strands_app,
)
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from strands import Agent, tool
from strands.models.openai import OpenAIModel

load_dotenv()

class ProverbsList(BaseModel):
    proverbs: List[str] = Field(description="The complete list of proverbs")

@tool
def get_weather(location: str):
    """Get the weather for a location."""
    return json.dumps({"location": "70 degrees"})

@tool
def set_theme_color(theme_color: str):
    """Change the theme color of the UI. Frontend tool -- returns None."""
    return None

@tool
def update_proverbs(proverbs_list: ProverbsList):
    """Update the complete list of proverbs. Always provide the entire list."""
    return "Proverbs updated successfully"

# Prompt builder injects current state into the user message
def build_proverbs_prompt(input_data, user_message: str) -> str:
    state_dict = getattr(input_data, "state", None)
    if isinstance(state_dict, dict) and "proverbs" in state_dict:
        proverbs_json = json.dumps(state_dict["proverbs"], indent=2)
        return f"Current proverbs list:\n{proverbs_json}\n\nUser request: {user_message}"
    return user_message

# Extract state from tool arguments for state snapshot emission
async def proverbs_state_from_args(context):
    try:
        tool_input = context.tool_input
        if isinstance(tool_input, str):
            tool_input = json.loads(tool_input)
        proverbs_data = tool_input.get("proverbs_list", tool_input)
        if isinstance(proverbs_data, dict):
            return {"proverbs": proverbs_data.get("proverbs", [])}
        return {"proverbs": []}
    except Exception:
        return None

# Configure AG-UI behaviors per tool
shared_state_config = StrandsAgentConfig(
    state_context_builder=build_proverbs_prompt,
    tool_behaviors={
        "update_proverbs": ToolBehavior(
            skip_messages_snapshot=True,
            state_from_args=proverbs_state_from_args,
        )
    },
)

model = OpenAIModel(
    client_args={"api_key": os.getenv("OPENAI_API_KEY", "")},
    model_id="gpt-4o",
)

strands_agent = Agent(
    model=model,
    system_prompt="You are a helpful assistant that manages proverbs.",
    tools=[update_proverbs, get_weather, set_theme_color],
)

# Wrap with AG-UI integration
agui_agent = StrandsAgent(
    agent=strands_agent,
    name="proverbs_agent",
    description="A proverbs assistant",
    config=shared_state_config,
)

# Create the FastAPI app
app = create_strands_app(agui_agent, os.getenv("AGENT_PATH", "/"))
```

Key patterns:
- `StrandsAgentConfig` controls AG-UI behavior:
  - `state_context_builder` -- function that injects state into the prompt
  - `tool_behaviors` -- per-tool configuration for state extraction and message handling
- `ToolBehavior` options:
  - `skip_messages_snapshot=True` -- skip message snapshot after this tool (for state-only tools)
  - `state_from_args` -- async function to extract state from tool arguments for `STATE_SNAPSHOT` events
- Frontend tools return `None` -- actual execution happens on the client
- `create_strands_app()` builds a complete FastAPI application

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
    strands_agent: new HttpAgent({
      url: process.env.STRANDS_AGENT_URL || "http://localhost:8000",
    }),
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

Strands uses the generic `HttpAgent` from `@ag-ui/client`.
