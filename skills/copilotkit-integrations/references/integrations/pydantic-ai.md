# PydanticAI Integration

PydanticAI has first-class AG-UI support built into `pydantic-ai-slim[ag-ui]`. The integration is minimal -- the agent exposes itself as an ASGI app with `agent.to_ag_ui()`.

## Prerequisites

- Python 3.12+
- Node.js 20+
- `uv` for Python dependency management
- OpenAI API key

## Python Dependencies

```toml
[project]
dependencies = [
    "uvicorn",
    "pydantic-ai-slim[ag-ui]",
    "pydantic-ai-slim[openai]",
    "python-dotenv",
]
```

## Agent Definition (agent/src/agent.py)

```python
from textwrap import dedent
from pydantic import BaseModel, Field
from pydantic_ai import Agent, RunContext
from pydantic_ai.ag_ui import StateDeps
from ag_ui.core import EventType, StateSnapshotEvent
from pydantic_ai.models.openai import OpenAIResponsesModel
from dotenv import load_dotenv

load_dotenv()

# Define shared state as a Pydantic model
class ProverbsState(BaseModel):
    proverbs: list[str] = Field(
        default_factory=list,
        description='The list of already written proverbs',
    )

# Create the agent with StateDeps for AG-UI state management
agent = Agent(
    model=OpenAIResponsesModel('gpt-4.1-mini'),
    deps_type=StateDeps[ProverbsState],
    system_prompt=dedent("""
        You are a helpful assistant that helps manage and discuss proverbs.
        When discussing proverbs, ALWAYS use the get_proverbs tool first.
    """).strip()
)

# Tools that read state
@agent.tool
def get_proverbs(ctx: RunContext[StateDeps[ProverbsState]]) -> list[str]:
    """Get the current list of proverbs."""
    return ctx.deps.state.proverbs

# Tools that modify state -- return StateSnapshotEvent to sync with frontend
@agent.tool
async def add_proverbs(
    ctx: RunContext[StateDeps[ProverbsState]], proverbs: list[str]
) -> StateSnapshotEvent:
    ctx.deps.state.proverbs.extend(proverbs)
    return StateSnapshotEvent(
        type=EventType.STATE_SNAPSHOT,
        snapshot=ctx.deps.state,
    )

@agent.tool
async def set_proverbs(
    ctx: RunContext[StateDeps[ProverbsState]], proverbs: list[str]
) -> StateSnapshotEvent:
    ctx.deps.state.proverbs = proverbs
    return StateSnapshotEvent(
        type=EventType.STATE_SNAPSHOT,
        snapshot=ctx.deps.state,
    )

@agent.tool
def get_weather(_: RunContext[StateDeps[ProverbsState]], location: str) -> str:
    """Get the weather for a given location."""
    return f"The weather in {location} is sunny."
```

Key patterns:
- Use `StateDeps[YourStateModel]` as the `deps_type` to enable AG-UI shared state
- State-reading tools access `ctx.deps.state` directly
- State-modifying tools return `StateSnapshotEvent` with the updated state -- this triggers a state sync to the frontend
- The `RunContext` provides access to both state and dependencies

## FastAPI Server (agent/src/main.py)

```python
from agent import ProverbsState, StateDeps, agent

app = agent.to_ag_ui(deps=StateDeps(ProverbsState()))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
```

The `agent.to_ag_ui()` call creates a full ASGI application. Pass initial `deps` with default state.

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
    sample_agent: new HttpAgent({ url: "http://localhost:8000/" }),
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

PydanticAI uses the generic `HttpAgent` from `@ag-ui/client`.

## Frontend Usage

The frontend is standard CopilotKit -- `useAgent` for shared state, `useRenderToolCall` for generative UI, `useHumanInTheLoop` for approval flows. See the main SKILL.md for common patterns.
