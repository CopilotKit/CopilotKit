/**
 * LangGraph TypeScript agent — CopilotKit showcase integration
 *
 * Defines a graph with a chat node and all showcase tools,
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
import { getA2UITools } from "@ag-ui/langgraph";
import { makeChatOpenAI } from "./openai-headers";
import {
  convertActionsToDynamicStructuredTools,
  CopilotKitStateAnnotation,
} from "@copilotkit/sdk-js/langgraph";
import {
  getWeatherImpl,
  queryDataImpl,
  manageSalesTodosImpl,
  getSalesTodosImpl,
  scheduleMeetingImpl,
  searchFlightsImpl,
} from "../../shared-tools";

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

const manageSalesTodos = tool(
  async ({ todos }) => JSON.stringify(manageSalesTodosImpl(todos)),
  {
    name: "manage_sales_todos",
    description: "Create or update the sales todo list",
    schema: z.object({
      todos: z
        .array(
          z.object({
            id: z.string().optional(),
            title: z.string(),
            stage: z.string().optional(),
            value: z.number().optional(),
            dueDate: z.string().optional(),
            assignee: z.string().optional(),
            completed: z.boolean().optional(),
          }),
        )
        .describe("Array of sales todo items"),
    }),
  },
);

const getSalesTodos = tool(
  async ({ currentTodos }) => JSON.stringify(getSalesTodosImpl(currentTodos)),
  {
    name: "get_sales_todos",
    description: "Get the current sales todo list",
    schema: z.object({
      currentTodos: z
        .array(
          z.object({
            id: z.string().optional(),
            title: z.string().optional(),
            stage: z.string().optional(),
            value: z.number().optional(),
            dueDate: z.string().optional(),
            assignee: z.string().optional(),
            completed: z.boolean().optional(),
          }),
        )
        .optional()
        .nullable()
        .describe("Current todos if any"),
    }),
  },
);

const scheduleMeeting = tool(
  async ({ reason, durationMinutes }) =>
    JSON.stringify(scheduleMeetingImpl(reason, durationMinutes)),
  {
    name: "schedule_meeting",
    description: "Schedule a meeting (requires user approval via HITL)",
    schema: z.object({
      reason: z.string().describe("Reason for the meeting"),
      durationMinutes: z.number().optional().describe("Duration in minutes"),
    }),
  },
);

const searchFlights = tool(
  async ({ flights }) => JSON.stringify(searchFlightsImpl(flights)),
  {
    name: "search_flights",
    description: "Search for available flights",
    schema: z.object({
      flights: z
        .array(
          z.object({
            airline: z.string(),
            airlineLogo: z.string().optional(),
            flightNumber: z.string(),
            origin: z.string(),
            destination: z.string(),
            date: z.string(),
            departureTime: z.string(),
            arrivalTime: z.string(),
            duration: z.string(),
            status: z.string(),
            statusColor: z.string().optional(),
            price: z.string(),
            currency: z.string().optional(),
          }),
        )
        .describe("Array of flight results"),
    }),
  },
);

// Dynamic A2UI via the canonical ag-ui factory (same as beautiful_chat /
// a2ui_dynamic). A secondary LLM designs the surface; the factory forces the
// host catalog and emits the a2ui_operations envelope. Replaces the prior
// hand-rolled generate_a2ui tool.
const generateA2ui = getA2UITools({
  model: new ChatOpenAI({ model: "gpt-4.1" }),
  defaultCatalogId: "copilotkit://app-dashboard-catalog",
});

const tools = [
  getWeather,
  queryData,
  manageSalesTodos,
  getSalesTodos,
  scheduleMeeting,
  searchFlights,
  generateA2ui,
];

// ---------------------------------------------------------------------------
// 3. Chat node — binds backend + frontend tools, invokes the model
// ---------------------------------------------------------------------------

async function chatNode(state: AgentState, config: RunnableConfig) {
  const model = makeChatOpenAI(config, { temperature: 0, model: "gpt-4o" });

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
