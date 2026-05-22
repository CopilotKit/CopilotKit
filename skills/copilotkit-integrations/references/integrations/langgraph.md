# LangGraph Integration

CopilotKit supports LangGraph in three configurations: Python with self-hosted FastAPI, Python with LangGraph Platform, and JavaScript/TypeScript. All use the AG-UI protocol.

## Python (Self-Hosted FastAPI)

This is the `langgraph-fastapi` example pattern. You run the LangGraph agent as a standalone FastAPI server and connect via `LangGraphHttpAgent`.

### Prerequisites

- Python 3.10+
- Node.js 18+
- OpenAI API key
- `poetry` or `uv` for Python dependency management

### Python Dependencies

```toml
# pyproject.toml
[project]
dependencies = [
    "copilotkit==0.1.74",
    "langchain==1.0.1",
    "langchain-openai==1.0.1",
    "langgraph==1.0.1",
    "fastapi==0.115.12",
    "uvicorn>=0.38.0",
    "python-dotenv>=1.0.0",
    "ag-ui-langgraph==0.0.22",
    "pydantic>=2.0.0,<3.0.0",
]
```

### Agent Definition (agent/src/agent.py)

The agent extends `CopilotKitState` for shared state and uses the standard ReAct pattern:

```python
from copilotkit import CopilotKitState
from langchain.tools import tool
from langchain_core.messages import SystemMessage
from langchain_core.runnables import RunnableConfig
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import StateGraph
from langgraph.prebuilt import ToolNode
from langgraph.types import Command
from typing_extensions import Literal
from src.util import should_route_to_tool_node

class AgentState(CopilotKitState):
    proverbs: list[str]

@tool
def get_weather(location: str):
    """Get the weather for a given location."""
    return f"The weather for {location} is 70 degrees."

tools = [get_weather]

async def chat_node(
    state: AgentState, config: RunnableConfig
) -> Command[Literal["tool_node", "__end__"]]:
    model = ChatOpenAI(model="gpt-4o")
    # Bind both frontend (CopilotKit) actions and backend tools
    fe_tools = state.get("copilotkit", {}).get("actions", [])
    model_with_tools = model.bind_tools([*fe_tools, *tools])

    system_message = SystemMessage(
        content=f"You are a helpful assistant. The current proverbs are {state.get('proverbs', [])}."
    )
    response = await model_with_tools.ainvoke(
        [system_message, *state["messages"]], config,
    )

    tool_calls = response.tool_calls
    if tool_calls and should_route_to_tool_node(tool_calls, fe_tools):
        return Command(goto="tool_node", update={"messages": response})
    return Command(goto="__end__", update={"messages": response})

workflow = StateGraph(AgentState)
workflow.add_node("chat_node", chat_node)
workflow.add_node("tool_node", ToolNode(tools=tools))
workflow.add_edge("tool_node", "chat_node")
workflow.set_entry_point("chat_node")

graph = workflow.compile(checkpointer=MemorySaver())
```

Key pattern: `CopilotKitState` provides the `copilotkit` field containing `actions` (frontend tools). You must bind both frontend actions and backend tools to the model, then route frontend tool calls back to CopilotKit (not the ToolNode).

### FastAPI Server (agent/main.py)

```python
from fastapi import FastAPI
from copilotkit import LangGraphAGUIAgent
from ag_ui_langgraph import add_langgraph_fastapi_endpoint
from src.agent import graph

app = FastAPI()

add_langgraph_fastapi_endpoint(
    app=app,
    agent=LangGraphAGUIAgent(
        name="sample_agent",
        description="An example agent.",
        graph=graph,
    ),
    path="/",
)
```

### Next.js Route (src/app/api/copilotkit/route.ts)

```typescript
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphHttpAgent } from "@copilotkit/runtime/langgraph";
import { NextRequest } from "next/server";

const runtime = new CopilotRuntime({
  agents: {
    sample_agent: new LangGraphHttpAgent({
      url: process.env.AGENT_URL || "http://localhost:8123",
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

Use `LangGraphHttpAgent` (from `@copilotkit/runtime/langgraph`) for self-hosted agents. The default port is 8123.

---

## Python (LangGraph Platform / Monorepo)

This is the `langgraph-python` example pattern. Uses `LangGraphAgent` which connects to a LangGraph deployment (local or cloud).

### Next.js Route

```typescript
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";

const defaultAgent = new LangGraphAgent({
  deploymentUrl: process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8123",
  graphId: "sample_agent",
  langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
});

const runtime = new CopilotRuntime({
  agents: { default: defaultAgent },
  a2ui: { injectA2UITool: true },
  mcpApps: {
    servers: [
      {
        type: "http",
        url: process.env.MCP_SERVER_URL || "https://mcp.excalidraw.com",
        serverId: "example_mcp_app",
      },
    ],
  },
});
```

Key difference from self-hosted: `LangGraphAgent` uses `deploymentUrl` and `graphId` (and optionally `langsmithApiKey`), while `LangGraphHttpAgent` uses a plain `url`.

---

## JavaScript / TypeScript

This is the `langgraph-js` example pattern. The agent is a TypeScript LangGraph graph running in a separate Node.js process.

### Agent Definition (apps/agent/src/agent.ts)

```typescript
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AIMessage, SystemMessage } from "@langchain/core/messages";
import { MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import {
  convertActionsToDynamicStructuredTools,
  CopilotKitStateAnnotation,
} from "@copilotkit/sdk-js/langgraph";
import { Annotation } from "@langchain/langgraph";

const AgentStateAnnotation = Annotation.Root({
  ...CopilotKitStateAnnotation.spec,
  proverbs: Annotation<string[]>,
});

export type AgentState = typeof AgentStateAnnotation.State;

const getWeather = tool(
  (args) => `The weather for ${args.location} is 70 degrees.`,
  {
    name: "getWeather",
    description: "Get the weather for a given location.",
    schema: z.object({ location: z.string() }),
  },
);

const tools = [getWeather];

async function chat_node(state: AgentState, config) {
  const model = new ChatOpenAI({ temperature: 0, model: "gpt-4o" });
  const modelWithTools = model.bindTools!([
    ...convertActionsToDynamicStructuredTools(state.copilotkit?.actions ?? []),
    ...tools,
  ]);

  const systemMessage = new SystemMessage({
    content: `You are a helpful assistant. The current proverbs are ${JSON.stringify(state.proverbs)}.`,
  });
  const response = await modelWithTools.invoke(
    [systemMessage, ...state.messages], config,
  );
  return { messages: response };
}

function shouldContinue({ messages, copilotkit }: AgentState) {
  const lastMessage = messages[messages.length - 1] as AIMessage;
  if (lastMessage.tool_calls?.length) {
    const actions = copilotkit?.actions;
    const toolCallName = lastMessage.tool_calls![0].name;
    if (!actions || actions.every((action) => action.name !== toolCallName)) {
      return "tool_node";
    }
  }
  return "__end__";
}

const workflow = new StateGraph(AgentStateAnnotation)
  .addNode("chat_node", chat_node)
  .addNode("tool_node", new ToolNode(tools))
  .addEdge(START, "chat_node")
  .addEdge("tool_node", "chat_node")
  .addConditionalEdges("chat_node", shouldContinue);

export const graph = workflow.compile({ checkpointer: new MemorySaver() });
```

Key JS-specific patterns:
- Use `CopilotKitStateAnnotation` from `@copilotkit/sdk-js/langgraph` to include CopilotKit state
- Use `convertActionsToDynamicStructuredTools()` to convert frontend actions to LangChain tools
- Check `copilotkit.actions` to determine whether a tool call should route to `tool_node` (backend) or `__end__` (frontend)

### Next.js Route

Same as the Platform pattern -- uses `LangGraphAgent` with `deploymentUrl` and `graphId`.

## Monorepo Structure (JS)

The JS variant uses a Turborepo monorepo:

```
apps/
  web/          # Next.js frontend
  agent/        # LangGraph agent (Node.js)
pnpm-workspace.yaml
turbo.json
```

Run `pnpm dev` to start both apps via Turborepo.
