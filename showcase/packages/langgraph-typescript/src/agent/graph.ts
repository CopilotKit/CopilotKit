/**
 * LangGraph TypeScript agent — CopilotKit showcase integration
 *
 * Defines a simple graph with a chat node and weather + queryData tools,
 * wired to CopilotKit via the sdk-js LangGraph adapter so frontend actions
 * and shared state flow seamlessly.
 */

import { z } from "zod";
import { RunnableConfig } from "@langchain/core/runnables";
import { tool } from "@langchain/core/tools";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AIMessage, SystemMessage } from "@langchain/core/messages";
import {
  MemorySaver,
  START,
  StateGraph,
  Annotation,
} from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import {
  convertActionsToDynamicStructuredTools,
  CopilotKitStateAnnotation,
} from "@copilotkit/sdk-js/langgraph";
import { getWeatherImpl, queryDataImpl } from "./shared-tools";

// ---------------------------------------------------------------------------
// 1. Agent state — extends CopilotKit state with a proverbs list
// ---------------------------------------------------------------------------

const AgentStateAnnotation = Annotation.Root({
  ...CopilotKitStateAnnotation.spec,
  proverbs: Annotation<string[]>,
});

export type AgentState = typeof AgentStateAnnotation.State;

// ---------------------------------------------------------------------------
// 2. Tools — shared implementations wrapped for LangChain
// ---------------------------------------------------------------------------

const getWeather = tool(
  async ({ location }) => JSON.stringify(getWeatherImpl(location)),
  {
    name: "get_weather",
    description: "Get current weather for a location",
    schema: z.object({
      location: z.string().describe("City name"),
    }),
  },
);

const queryData = tool(
  async ({ query }) => JSON.stringify(queryDataImpl(query)),
  {
    name: "query_data",
    description: "Query financial database for chart data",
    schema: z.object({
      query: z.string().describe("Natural language query"),
    }),
  },
);

const tools = [getWeather, queryData];

// ---------------------------------------------------------------------------
// 3. Chat node — binds backend + frontend tools, invokes the model
// ---------------------------------------------------------------------------

async function chatNode(state: AgentState, config: RunnableConfig) {
  const model = new ChatOpenAI({ temperature: 0, model: "gpt-4o" });

  const modelWithTools = model.bindTools!([
    ...convertActionsToDynamicStructuredTools(state.copilotkit?.actions ?? []),
    ...tools,
  ]);

  const systemMessage = new SystemMessage({
    content: `You are a helpful assistant. The current proverbs are ${JSON.stringify(state.proverbs)}.`,
  });

  const response = await modelWithTools.invoke(
    [systemMessage, ...state.messages],
    config,
  );

  return { messages: response };
}

// ---------------------------------------------------------------------------
// 4. Routing — send tool calls to tool_node unless they're CopilotKit actions
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 5. Compile the graph
// ---------------------------------------------------------------------------

const workflow = new StateGraph(AgentStateAnnotation)
  .addNode("chat_node", chatNode)
  .addNode("tool_node", new ToolNode(tools))
  .addEdge(START, "chat_node")
  .addEdge("tool_node", "chat_node")
  .addConditionalEdges("chat_node", shouldContinue as any);

const memory = new MemorySaver();

export const graph = workflow.compile({
  checkpointer: memory,
});
