# Open Agent Spec Integration

CopilotKit implementation guide for Open Agent Spec.

> For shared CopilotKit concepts (runtime setup, prebuilt components, troubleshooting, etc.), see the topic guides. This file focuses on framework-specific implementation details.

## Guidance
### Tool Rendering
- Route: `/agent-spec/generative-ui/tool-rendering`
- Source: `docs/content/docs/integrations/agent-spec/generative-ui/tool-rendering.mdx`
- Description: Render your agent's tool calls with custom UI components.

```python title="agent.py"

        # Create the agent
        from pyagentspec.agent import Agent
        from pyagentspec.llms import OpenAiCompatibleConfig
        from pyagentspec.property import StringProperty
        from pyagentspec.tools import ServerTool
        from pyagentspec.serialization import AgentSpecSerializer

        llm = OpenAiCompatibleConfig(
            name="my_llm",
            model_id="gpt-5.2-mini",
            url="https://api.openai.com/v1",
        )
        weather_tool = ServerTool( # ServerTool are backend tools in Agent Spec
            name="get_weather",
            description="Get the weather for a given location.",
            inputs=[StringProperty(title="location", description="The location to get the weather forecast. Must be a city/town name.")],
            outputs=[StringProperty(title="weather_result")],
        )
        agent = Agent(
            name="my_agent",
            llm_config=llm,
            system_prompt="Based on the weather forecast result and the user input, write a response to the user",
            tools=[weather_tool],
            human_in_the_loop=True,
        )
        agentspec_json_config = AgentSpecSerializer().to_json(agent)

        async def get_weather(location: str = "Everywhere ever") -> str:
            """Get the weather for a given location. Ensure location is fully spelled out."""
            return f"The weather in {location} is sunny."

        # Start the server
        from fastapi import APIRouter, FastAPI
        from ag_ui_agentspec.agent import AgentSpecAgent
        from ag_ui_agentspec.endpoint import add_agentspec_fastapi_endpoint

        runtime = "langgraph" # you can also choose "wayflow"
        router = APIRouter()
        add_agentspec_fastapi_endpoint(
            app=router,
            agentspec_agent=AgentSpecAgent(
                agentspec_json_config,
                runtime=runtime,
                tool_registry={"get_weather": get_weather},
            ),
            path=f"/{runtime}/path_to_my_agent",
        )
        app = FastAPI(title="Agent-Spec x AG-UI Examples - Backend Tool")
        app.include_router(router)

        if __name__ == "__main__":
            import uvicorn
            uvicorn.run(app, host="0.0.0.0", port=8000)

```
```tsx title="app/page.tsx"
import { useRenderTool } from "@copilotkit/react-core/v2"; // [!code highlight]
// ...

const YourMainContent = () => {
  // ...
  // [!code highlight:12]
  useRenderTool({
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

### Human-in-the-Loop
- Route: `/agent-spec/human-in-the-loop`
- Source: `docs/content/docs/integrations/agent-spec/human-in-the-loop.mdx`
- Description: Create frontend tools and use them within your Agent Spec AI agent for human-in-the-loop interactions.

```tsx title="page.tsx"
        import { useHumanInTheLoop } from "@copilotkit/react-core/v2" // [!code highlight]

        export function Page() {
          // ...

          useHumanInTheLoop({
            name: "offerOptions",
            description: "Give the user a choice between two options and have them select one.",
            parameters: [
              {
                name: "option_1",
                type: "string",
                description: "The first option",
                required: true,
              },
              {
                name: "option_2",
                type: "string",
                description: "The second option",
                required: true,
              },
            ],
            render: ({ args, respond }) => {
              if (!respond) return <></>;
              return (
                <div>
                  {/* [!code highlight:2] */}
                  <button onClick={() => respond(`${args.option_1} was selected`)}>{args.option_1}</button>
                  <button onClick={() => respond(`${args.option_2} was selected`)}>{args.option_2}</button>
                </div>
              );
            },
          });

          // ...
        }
```
```
        Can you show me two good options for a restaurant name?
```

### Overview
- Route: `/agent-spec`
- Source: `docs/content/docs/integrations/agent-spec/index.mdx`
- Description: Bring your Agent‑Spec agents to your users with CopilotKit via AG‑UI.

# Open Agent Spec x CopilotKit

Open Agent Spec (Agent Spec), originally developed by Oracle, is a portable language for defining agentic systems. It defines building blocks for standalone agents and structured agentic workflows as well as common ways of composing them into multi-agent systems.
Agent Spec enables users to author agents once and run them with any compatible runtime. Agent Spec decouples design from execution, helping deliver more predictable behavior across frameworks.

Now, with the CopilotKit integration, you can bring your Agent Spec agents to an interactive UI using CopilotKit and AG‑UI. Use our Next.js starter to connect a CopilotKit UI to your Agent Spec FastAPI endpoint that streams AG‑UI events.

This integration is centered on two components:
- Backend: AG‑UI exporter for Agent Spec (`pyagentspec` Python package) at [the AG-UI GitHub repo](https://github.com/ag-ui-protocol/ag-ui/tree/main/integrations/agent-spec/python). It loads an Agent Spec config (yaml/json) and runs it on your chosen framework via supported Agent Spec adapters (currently LangGraph or WayFlow), translating Agent Spec tracing events into AG‑UI events and sending them to the CopilotKit-powered frontend via a FastAPI endpoint.
- Frontend: CopilotKit UI (Next.js) that consumes AG‑UI events and renders chat, tool calls/results, and generative UI.

Quickly scaffold the UI, then wire your backend endpoint that streams AG‑UI events.

## Quickstart

```bash
npx copilotkit@latest create -f agent-spec
```

Then set your backend endpoint (default `http://localhost:8000/copilotkit`):

```dotenv title=".env.local"
COPILOTKIT_REMOTE_ENDPOINT=http://localhost:8000/copilotkit
```

Run your Agent Spec FastAPI server and start the Next.js app.
For backend installation and endpoint wiring, follow the [Quickstart](/agent-spec/quickstart) and the per‑adapter guides: [LangGraph integration](/agent-spec/langgraph) and [WayFlow integration](/agent-spec/wayflow).

## How it works

- Backend: Your FastAPI endpoint (from the AG-UI Agent Spec integration) emits AG‑UI SSE events.
- Frontend: The Next.js template proxies requests to your backend using CopilotKit Runtime.
- Protocol: AG‑UI spans/events power streaming text, tool calls and results, and run lifecycle.

## Repos and references

- Example FastAPI server: `ag-ui/integrations/agent-spec/python/examples/server.py`
- Endpoint helper: `ag-ui/integrations/agent-spec/python/ag_ui_agentspec/endpoint.py`
- AG‑UI Agent Spec integration (Python): https://github.com/ag-ui-protocol/ag-ui/tree/main/integrations/agent-spec/python
- AG‑UI Agent Spec tutorial (Agent Spec docs): https://oracle.github.io/agent-spec/26.1.0/howtoguides/howto_ag_ui.html

## Learn more about Agent Spec

- Agent Spec docs home: https://oracle.github.io/agent-spec/development/docs_home.html
- Specification overview: https://oracle.github.io/agent-spec/development/agentspec/index.html
- API reference: https://oracle.github.io/agent-spec/development/api/index.html
- Reference sheet: https://oracle.github.io/agent-spec/development/misc/reference_sheet.html

### Agent Spec LangGraph Integration with AG-UI
- Route: `/agent-spec/langgraph`
- Source: `docs/content/docs/integrations/agent-spec/langgraph.mdx`
- Description: Install pyagentspec with the LangGraph adapter and expose a FastAPI endpoint that streams AG‑UI events for CopilotKit.

## What is this?

Wire an Agent Spec agent backed by LangGraph to CopilotKit’s UI via the AG‑UI event protocol. You’ll run a FastAPI endpoint that emits AG‑UI events and point your Next.js app at it.

Key pieces:
- Backend endpoint: `ag-ui/integrations/agent-spec/python/ag_ui_agentspec/endpoint.py`
- Example server: `ag-ui/integrations/agent-spec/python/examples/server.py`
- Template UI: `npx copilotkit@latest create -f agent-spec`

## When should I use this?

Use this integration when you already have a LangGraph-based agent described by an Agent Spec and want a turnkey UI that streams assistant text, tool calls/results, and run lifecycle with minimal wiring.

## Prerequisites

- Python 3.10–3.14
- Node.js 20+
- An Agent Spec config JSON/YAML file (or Python code via `pyagentspec`)

## Install the Agent Spec AG-UI integration

From the AG‑UI repo’s Agent Spec integration package:

```bash
git clone https://github.com/ag-ui-protocol/ag-ui.git
cd ag-ui/integrations/agent-spec/python
uv pip install -e .[langgraph]
```

Note that this installs `pyagentspec` from source. Alternatively, you may install it with pip:

```bash
pip install pyagentspec[langgraph]
```

## Steps

### 1. Start a FastAPI endpoint (minimal example)

Use the LangGraph runtime to execute your Agent Spec and stream AG‑UI events.

```python
from fastapi import FastAPI
from ag_ui_agentspec.agent import AgentSpecAgent
from ag_ui_agentspec.endpoint import add_agentspec_fastapi_endpoint

agentspec_json = <loaded json/yaml string of your Agent Spec config> 

app = FastAPI()
agent = AgentSpecAgent(agentspec_json, runtime="langgraph")
add_agentspec_fastapi_endpoint(app, agentspec_agent=agent, path="/")
```

Run locally:

```bash
uvicorn backend.app:app --reload --port 8000
```

### 2. Scaffold and connect the UI

You'll need to run your agent and connect it to CopilotKit before proceeding.

If you don't already have CopilotKit and your agent connected, choose one of the following options:

    You can follow the instructions in the [quickstart](/agent-spec/quickstart) guide.
    Run the following command to create a brand new project with a pre-configured agent:

```bash
    npx copilotkit@latest create -f agent-spec
```

If you already have the starter, make sure your agent runs on port 8000.

Then run the app (for example with `pnpm dev`) and open `http://localhost:3000`.

## How it works

- `AgentSpecAgent(runtime="langgraph")` executes your Agent Spec agent with the LangGraph framework.
- In the `AgentSpecAgent` wrapper, `AgUiSpanProcessor` maps Agent Spec tracing spans to AG‑UI events on a per‑request queue (`EVENT_QUEUE`).
- The FastAPI endpoint streams those events as SSE for CopilotKit to render:
  - assistant text: `TEXT_MESSAGE_START/CONTENT/END`
  - tool calls: `TOOL_CALL_START/ARGS/END` and `TOOL_CALL_RESULT`
  - lifecycle: `RUN_STARTED/RUN_FINISHED`

## Troubleshooting

- The endpoint path must match your UI’s expected agent endpoint (port 8000 in our starter repo).
- The endpoint asserts a queue is bound. If you get queue errors, check that requests go through the provided FastAPI route.
- If you are not receiving any events, make sure the agent is running and did not crash.

## Next steps

- Build richer UIs with agentic chat and generative UI.
- Pass full chat history between turns. The adapter and processor handle messages and tool‑call lifecycle for you.
- Check out the [WayFlow runtime](/agent-spec/wayflow)

Starter template: https://github.com/CopilotKit/with-agent-spec (see the README for installation options)

## Learn more

- AG-UI docs: https://docs.ag-ui.com/introduction
- Agent Spec docs home: https://oracle.github.io/agent-spec/development/docs_home.html
- Specification overview: https://oracle.github.io/agent-spec/development/agentspec/index.html
- Agent Spec tracing docs: https://oracle.github.io/agent-spec/26.1.0/agentspec/tracing.html
- Agent Spec LangGraph adapter docs: https://oracle.github.io/agent-spec/26.1.0/adapters/langgraph/index.html

### Quickstart
- Route: `/agent-spec/quickstart`
- Source: `docs/content/docs/integrations/agent-spec/quickstart.mdx`
- Description: Set up Agent Spec + AG‑UI and connect a CopilotKit UI. Includes per‑adapter install steps and a minimal endpoint.

## Prerequisites

- Node.js 20+
- Python 3.10–3.13

## 1) Install the Agent Spec AG‑UI adapter (backend)

The AG‑UI integration for Agent Spec lives in `ag-ui/integrations/agent-spec/python`. Here's how to install it:

```bash
# Clone the adapter and move into the Python package
git clone https://github.com/ag-ui-protocol/ag-ui.git
cd ag-ui/integrations/agent-spec/python
```

As this integration package uses `uv` as the package manager, you can easily install it with:

```bash
uv sync
```

Agent Spec is a specification language that declares the structure of your agents and workflows. Agent Spec agents can be run on various agent frameworks. Currently, we support LangGraph and WayFlow (Oracle's reference agent framework, with native support for Agent Spec).
Here are the different installation options depending on which agent framework you want to execute your Agent Spec agent on:

```bash
uv sync --extra langgraph                         # for LangGraph
uv sync --extra wayflow                           # for WayFlow
uv sync --extra langgraph --extra wayflow         # for both
```

Alternatively, you can use `pip`:

```bash
pip install -e .[wayflow]
pip install -e .[langgraph]
pip install -e .[wayflow,langgraph]
```

Note: these commands would install [`pyagentspec`](https://github.com/oracle/agent-spec) and [`wayflowcore`](https://github.com/oracle/wayflow) packages from source (i.e. the respective GitHub repos).
Instead, you can install these packages from PyPI separately:

```bash
pip install pyagentspec[langgraph]
pip install wayflowcore
```

Environment:

```bash
export OPENAI_API_KEY=...
export OPENAI_MODEL=gpt-5.2
```

Note that these environment variables can point to any OpenAI-compatible LLM provider (e.g., local vLLM server, Together AI), but the variable names need to be `OPENAI_API_KEY` and `OPENAI_MODEL`.

Reference: Agent Spec docs AG‑UI tutorial at https://oracle.github.io/agent-spec/26.1.0/howtoguides/howto_ag_ui.html.

## 2) Scaffold the UI

Start from our starter template:

```bash
npx copilotkit@latest create -f agent-spec
```

Or use the full starter repo template: https://github.com/CopilotKit/with-agent-spec. It includes an example definition of an Agent Spec agent [here](https://github.com/CopilotKit/with-agent-spec/blob/main/agent/src/agentspec_agent.py).

Note that the `npx` command automatically installs the AG-UI Agent Spec integration at https://github.com/ag-ui-protocol/ag-ui/tree/main/integrations/agent-spec/python, which install `pyagentspec` and optional runtime adapter dependencies as explained above.

### Minimal starter Agent Spec agent definition

```python agentspec_agent.py
from pyagentspec.agent import Agent
from pyagentspec.llms import OpenAiCompatibleConfig
from pyagentspec.serialization import AgentSpecSerializer

agentspec_agent = Agent(
    name="AgentSpecAgent",
    description="A starter Agent that can call tools.",
    system_prompt="You are a helpful assistant, named Specky, that speaks a lot.",
    llm_config=OpenAiCompatibleConfig(
        name="my-llm",
        model_id="gpt-5.2",
        url="https://api.openai.com/v1",
    ),
)

agent_spec_config = AgentSpecSerializer().to_json(agentspec_agent)
```

## 3) Add a minimal FastAPI endpoint (backend)

Create a FastAPI app that loads your Agent Spec file and exposes an AG‑UI FastAPI endpoint. Replace the `runtime` to match your adapter (`langgraph` or `wayflow`).

```python src/main.py
from fastapi import FastAPI
from ag_ui_agentspec.agent import AgentSpecAgent
from ag_ui_agentspec.endpoint import add_agentspec_fastapi_endpoint

agent_spec_config = <loaded json/yaml string of your Agent Spec agent>
runtime = "langgraph"  # or "wayflow"

app = FastAPI()
agent = AgentSpecAgent(agent_spec_config=agent_spec_config, runtime=runtime)
add_agentspec_fastapi_endpoint(app, agentspec_agent=agent, path="/")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
```

Here, we use the `add_agentspec_fastapi_endpoint` utility from the integration pacakge. It sets up the endpoint and the wiring of Agent Spec Tracing events to AG-UI events.

To run the backend agent:

```bash
uv run src/main.py
```

## 4) Connect the UI to your frontend server

Make sure the frontend UI server knows what host/port the backend agent is running on. In this tutorial, we use http://localhost:8000/ as the host/port.

## 5) Run Next.js

From the root directory of [our starter repo](https://github.com/sonleoracle/with-agent-spec/), run:

```bash
pnpm dev
# or npm run dev / yarn dev / bun dev
```

Note that this command also launches the agent backend in `agent/src`. Now, open http://localhost:3000 and start chatting with your agent.

## Tools and tool registry

If your Agent Spec includes server-side tools that execute in the same environment as the agent, map them by name to Python callables in a dictionary `tool_registry` when loading `AgentSpecAgent`.

```python title="Bind backend tools by name"
from __future__ import annotations
from fastapi import FastAPI
from ag_ui_agentspec.agent import AgentSpecAgent
from ag_ui_agentspec.endpoint import add_agentspec_fastapi_endpoint

def get_weather(city: str) -> Dict[str, Any]:
    return {"city": city, "temp_c": 22}

tool_registry = {"get_weather": get_weather}

app = FastAPI()
agent = AgentSpecAgent(
    agent_spec_config=<json/yaml string of your Agent Spec Agent>,
    runtime="langgraph",  # or "wayflow"
    tool_registry=tool_registry,
)
add_agentspec_fastapi_endpoint(app, agentspec_agent=agent, path="/")
```

Frontend tools (corresponding to Agent Spec `ClientTool`) run in the browser and don't need to be added to the tool registry — see [Generative UI Frontend Tools](/agent-spec/frontend-tools) for details.

## What is happening under the hood

Agent Spec, and the `pyagentspec` SDK, helps you define agents and workflows in a readable and portable config object/JSON file.
The different adapters, LangGraph and WayFlow, loads your Agent Spec configs into framework-specific objects and executes them. In other words, Agent Spec is the "compiler", and the frameworks are the "runtimes".
During this conversion process, the adapter configures the loaded object so that it would emit Agent Spec Tracing events. These are standardized across runtimes.
Finally, the AG-UI Agent Spec integration listens to Agent Spec Tracing events and exports them to AG-UI events. These include agent execution, tool calls, messages being sent by the agent, etc.
In other words, if the agent emits an event during execution (this is runtime-dependent), a corresponding AG-UI event will be created.
In the frontend, CopilotKit converts and renders AG-UI events into the UI.

## Next steps

Follow per-adapter tutorials: [LangGraph integration](/agent-spec/langgraph) and [WayFlow integration](/agent-spec/wayflow).

## Learn more

- AG-UI docs: https://docs.ag-ui.com/introduction
- Agent Spec docs: https://oracle.github.io/agent-spec/development/docs_home.html
- Agent Spec x AG-UI tutorial: https://oracle.github.io/agent-spec/26.1.0/howtoguides/howto_ag_ui.html
- Agent Spec Tracing: https://oracle.github.io/agent-spec/development/agentspec/tracing.html

### Agent Spec WayFlow Integration with AG-UI
- Route: `/agent-spec/wayflow`
- Source: `docs/content/docs/integrations/agent-spec/wayflow.mdx`
- Description: Connect an Agent Spec (WayFlow runtime) to CopilotKit via the AG‑UI endpoint and stream agent runs to the UI.

## What is this?

Wire an Agent Spec agent backed by WayFlow to CopilotKit’s UI via the AG‑UI event protocol. You’ll run a FastAPI endpoint that emits AG‑UI events and point your Next.js app at it.

Key pieces:
- Backend endpoint: `ag-ui/integrations/agent-spec/python/ag_ui_agentspec/endpoint.py`
- Example server: `ag-ui/integrations/agent-spec/python/examples/server.py`
- Template UI: `npx copilotkit@latest create -f agent-spec`

## When should I use this?

Use this integration when you already have a WayFlow-based agent described by an Agent Spec and want a turnkey UI that streams assistant text, tool calls/results, and run lifecycle with minimal wiring.

## Prerequisites

- Python 3.10–3.14
- Node.js 20+
- An Agent Spec config JSON/YAML file (or Python code via `pyagentspec`)

## Install runtime adapter

From the AG‑UI repo’s Agent Spec adapter package:

```bash
git clone https://github.com/ag-ui-protocol/ag-ui.git
cd ag-ui/integrations/agent-spec/python
uv pip install -e .[wayflow]
```

Note that this installs `wayflowcore` from source. Alternatively, you may install it with pip:

```bash
pip install wayflowcore
```

## Steps

### 1. Start a FastAPI endpoint (minimal example)

Use the WayFlow runtime to execute your Agent Spec and stream AG‑UI events.

```python
from fastapi import FastAPI
from ag_ui_agentspec.agent import AgentSpecAgent
from ag_ui_agentspec.endpoint import add_agentspec_fastapi_endpoint

agentspec_json = <loaded json/yaml of your Agent Spec config>

app = FastAPI()
agent = AgentSpecAgent(agentspec_json, runtime="wayflow")
add_agentspec_fastapi_endpoint(app, agentspec_agent=agent, path="/")
```

Run locally:

```bash
uvicorn backend.app:app --reload --port 8000
```

### 2. Scaffold and connect the UI

You'll need to run your agent and connect it to CopilotKit before proceeding.

If you don't already have CopilotKit and your agent connected, choose one of the following options:

    You can follow the instructions in the [quickstart](/agent-spec/quickstart) guide.
    Run the following command to create a brand new project with a pre-configured agent:

```bash
    npx copilotkit@latest create -f agent-spec
```

If you already have the starter, make sure your agent runs on port 8000.

Then run the app (for example with `pnpm dev`) and open `http://localhost:3000`.

## How it works

- `AgentSpecAgent(runtime="wayflow")` executes your Agent Spec agent with the WayFlow framework.
- `AgUiSpanProcessor` maps Agent Spec tracing spans to AG‑UI events on a per‑request queue (`EVENT_QUEUE`).
- The FastAPI endpoint streams those events as SSE for CopilotKit to render:
  - assistant text: `TEXT_MESSAGE_START/CONTENT/END`
  - tool calls: `TOOL_CALL_START/ARGS/END` and `TOOL_CALL_RESULT`
  - lifecycle: `RUN_STARTED/RUN_FINISHED`

## Troubleshooting

- The endpoint path must match your UI’s expected agent endpoint (port 8000 in our starter repo).
- The endpoint asserts a queue is bound. If you get queue errors, check that requests go through the provided FastAPI route.
- If you are not receiving any events, make sure the agent is running and did not crash.

## Next steps

- Build richer UIs with agentic chat and generative UI.
- Pass full chat history between turns. The adapter and processor handle messages and tool‑call lifecycle for you.
- Check out the [LangGraph runtime](/agent-spec/langgraph)

Starter template: https://github.com/CopilotKit/with-agent-spec (see the README for installation options)

## Learn more

- AG-UI docs: https://docs.ag-ui.com/introduction
- Agent Spec docs home: https://oracle.github.io/agent-spec/development/docs_home.html
- Specification overview: https://oracle.github.io/agent-spec/development/agentspec/index.html
- Agent Spec tracing docs: https://oracle.github.io/agent-spec/26.1.0/agentspec/tracing.html
- Agent Spec WayFlow adapter docs: https://oracle.github.io/agent-spec/26.1.0/adapters/wayflow/index.html
