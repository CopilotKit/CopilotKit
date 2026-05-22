# Google ADK Integration

Google's Agent Development Kit (ADK) integrates with CopilotKit via the `ag-ui-adk` adapter. The agent runs as a FastAPI server.

## Prerequisites

- Python 3.12+
- Node.js 18+
- Google Makersuite API key (from https://makersuite.google.com/app/apikey)

## Python Dependencies

```toml
[project]
dependencies = [
    "fastapi",
    "uvicorn[standard]",
    "python-dotenv",
    "pydantic",
    "google-adk",
    "google-genai",
    "ag-ui-adk",
]
```

## Agent Definition (agent/main.py)

ADK uses `LlmAgent` with callbacks for state management:

```python
import json
from typing import Dict, Optional

from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint
from dotenv import load_dotenv
from fastapi import FastAPI
from google.adk.agents import LlmAgent
from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.adk.tools import ToolContext
from google.genai import types
from pydantic import BaseModel, Field

load_dotenv()

class ProverbsState(BaseModel):
    proverbs: list[str] = Field(default_factory=list)

# Tools use ToolContext.state for shared state
def set_proverbs(tool_context: ToolContext, new_proverbs: list[str]) -> Dict[str, str]:
    """Set the list of proverbs."""
    tool_context.state["proverbs"] = new_proverbs
    return {"status": "success", "message": "Proverbs updated successfully"}

def get_weather(tool_context: ToolContext, location: str) -> Dict[str, str]:
    """Get the weather for a given location."""
    return {"status": "success", "message": f"The weather in {location} is sunny."}

# Callback to initialize state
def on_before_agent(callback_context: CallbackContext):
    if "proverbs" not in callback_context.state:
        callback_context.state["proverbs"] = []
    return None

# Callback to inject state into system prompt
def before_model_modifier(
    callback_context: CallbackContext, llm_request: LlmRequest
) -> Optional[LlmResponse]:
    if callback_context.agent_name == "ProverbsAgent":
        proverbs_json = json.dumps(callback_context.state.get("proverbs", []), indent=2)
        prefix = f"""You are a helpful assistant for maintaining a list of proverbs.
        Current state: {proverbs_json}
        Use the set_proverbs tool to update the list."""

        original_instruction = llm_request.config.system_instruction or types.Content(
            role="system", parts=[]
        )
        if not isinstance(original_instruction, types.Content):
            original_instruction = types.Content(
                role="system", parts=[types.Part(text=str(original_instruction))]
            )
        if original_instruction.parts:
            original_instruction.parts[0].text = prefix + (original_instruction.parts[0].text or "")
        llm_request.config.system_instruction = original_instruction
    return None

def simple_after_model_modifier(
    callback_context: CallbackContext, llm_response: LlmResponse
) -> Optional[LlmResponse]:
    """Stop consecutive tool calling -- lets the agent yield control back."""
    return None

proverbs_agent = LlmAgent(
    name="ProverbsAgent",
    model="gemini-2.5-flash",
    instruction="...",  # Agent instructions
    tools=[set_proverbs, get_weather],
    before_agent_callback=on_before_agent,
    before_model_callback=before_model_modifier,
    after_model_callback=simple_after_model_modifier,
)

# Wrap with AG-UI adapter
adk_proverbs_agent = ADKAgent(
    adk_agent=proverbs_agent,
    user_id="demo_user",
    session_timeout_seconds=3600,
    use_in_memory_services=True,
)

app = FastAPI()
add_adk_fastapi_endpoint(app, adk_proverbs_agent, path="/")
```

Key patterns:
- State lives in `ToolContext.state` / `CallbackContext.state` (dict-based)
- Use `before_agent_callback` to initialize state
- Use `before_model_callback` to inject current state into the system prompt
- Wrap the ADK agent with `ADKAgent` from `ag-ui-adk`, then use `add_adk_fastapi_endpoint` to mount it
- ADK uses Gemini models by default (`gemini-2.5-flash`)

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

ADK uses the generic `HttpAgent` from `@ag-ui/client`.

## Environment

```bash
export GOOGLE_API_KEY="your-google-api-key-here"
```
