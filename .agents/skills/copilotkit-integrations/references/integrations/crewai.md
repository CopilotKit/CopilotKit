# CrewAI Integration

CopilotKit supports two CrewAI patterns: **Crews** (multi-agent task pipelines) and **Flows** (single-agent chat with tool calling). Both run as Python FastAPI servers connected via AG-UI.

## CrewAI Flows

Flows use the `crewai.flow.flow` module for a single conversational agent with tool calling, following the ReAct pattern.

### Prerequisites

- Python 3.10+
- Node.js 18+
- `uv` for Python dependency management
- OpenAI API key

### Agent Definition (agent/src/agent.py)

```python
import json
from ag_ui_crewai.sdk import CopilotKitState, copilotkit_stream
from crewai.flow.flow import Flow, listen, router, start
from litellm import completion

class AgentState(CopilotKitState):
    proverbs: list[str] = []

GET_WEATHER_TOOL = {
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get the current weather in a given location",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {"type": "string", "description": "The city and state"}
            },
            "required": ["location"],
        },
    },
}

tools = [GET_WEATHER_TOOL]

tool_handlers = {
    "get_weather": lambda args: f"The weather for {args['location']} is 70 degrees."
}

class SampleAgentFlow(Flow[AgentState]):

    @start()
    @listen("route_follow_up")
    async def start_flow(self):
        pass

    @router(start_flow)
    async def chat(self):
        system_prompt = f"You are a helpful assistant. The current proverbs are {self.state.proverbs}."

        # Wrap completion in copilotkit_stream for streaming support
        response = await copilotkit_stream(
            completion(
                model="openai/gpt-4o",
                messages=[
                    {"role": "system", "content": system_prompt},
                    *self.state.messages,
                ],
                # Bind both CopilotKit frontend actions AND backend tools
                tools=[*self.state.copilotkit.actions, GET_WEATHER_TOOL],
                parallel_tool_calls=False,
                stream=True,
            )
        )

        message = response.choices[0].message
        self.state.messages.append(message)

        if message.get("tool_calls"):
            tool_call = message["tool_calls"][0]
            tool_call_name = tool_call["function"]["name"]

            # If it's a CopilotKit frontend action, return to end (CopilotKit handles it)
            if tool_call_name in [
                action["function"]["name"] for action in self.state.copilotkit.actions
            ]:
                return "route_end"

            # Otherwise handle the backend tool call
            handler = tool_handlers[tool_call_name]
            result = handler(json.loads(tool_call["function"]["arguments"]))
            self.state.messages.append(
                {"role": "tool", "content": result, "tool_call_id": tool_call["id"]}
            )
            return "route_follow_up"

        return "route_end"

    @listen("route_end")
    async def end(self):
        pass
```

Key patterns:
- Extend `CopilotKitState` from `ag_ui_crewai.sdk` for shared state
- Use `copilotkit_stream()` to wrap `litellm.completion()` for AG-UI streaming
- Frontend actions come from `self.state.copilotkit.actions` -- bind them alongside backend tools
- Route frontend tool calls to `route_end` so CopilotKit handles them client-side
- Route backend tool calls to `route_follow_up` for the next iteration

### FastAPI Server (agent/server.py)

```python
from fastapi import FastAPI
from ag_ui_crewai.endpoint import add_crewai_flow_fastapi_endpoint
from src.agent import SampleAgentFlow

app = FastAPI()
add_crewai_flow_fastapi_endpoint(app, SampleAgentFlow(), "/")
```

### Next.js Route (src/app/api/copilotkit/route.ts)

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

CrewAI Flows use the generic `HttpAgent` from `@ag-ui/client`.

---

## CrewAI Crews

Crews are multi-agent pipelines with defined roles, tasks, and processes.

### Agent Definition

CrewAI Crews use YAML-configured agents and tasks via the `@CrewBase` decorator:

```python
from crewai import Agent, Crew, Process, Task
from crewai.project import CrewBase, agent, crew, task

@CrewBase
class LatestAiDevelopment():
    """LatestAiDevelopment crew"""
    name: str = "LatestAiDevelopment"

    @agent
    def researcher(self) -> Agent:
        return Agent(config=self.agents_config['researcher'], verbose=True)

    @agent
    def reporting_analyst(self) -> Agent:
        return Agent(config=self.agents_config['reporting_analyst'], verbose=True)

    @task
    def research_task(self) -> Task:
        return Task(config=self.tasks_config['research_task'])

    @task
    def reporting_task(self) -> Task:
        return Task(config=self.tasks_config['reporting_task'], output_file='report.md')

    @crew
    def crew(self) -> Crew:
        return Crew(
            name=self.name,
            agents=self.agents,
            tasks=self.tasks,
            process=Process.sequential,
            verbose=True,
            chat_llm="gpt-4o",
        )
```

### FastAPI Server

```python
from fastapi import FastAPI
from ag_ui_crewai.endpoint import add_crewai_crew_fastapi_endpoint
from src.latest_ai_development.crew import LatestAiDevelopment

app = FastAPI()
add_crewai_crew_fastapi_endpoint(app, LatestAiDevelopment(), "/")
```

Note the different function: `add_crewai_crew_fastapi_endpoint` vs `add_crewai_flow_fastapi_endpoint`.

### Next.js Route

```typescript
import { CrewAIAgent } from "@ag-ui/crewai";

const runtime = new CopilotRuntime({
  agents: {
    starterAgent: new CrewAIAgent({ url: "http://localhost:8000/" }),
  },
});
```

CrewAI Crews use `CrewAIAgent` from `@ag-ui/crewai` (not `HttpAgent`).
