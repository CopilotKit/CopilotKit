/**
 * LangGraph TypeScript agent backing the Headless Chat (Complete) demo.
 *
 * The cell exists to prove that every CopilotKit rendering surface works
 * when the chat UI is composed manually (no <CopilotChatMessageView /> or
 * <CopilotChatAssistantMessage />). To exercise those surfaces we give
 * this agent:
 *
 *   - three mock backend tools (get_weather, get_stock_price,
 *     get_revenue_chart) — render via app-registered `useRenderTool`
 *     renderers on the frontend,
 *   - access to a frontend-registered `useComponent` tool
 *     (`highlight_note`) — the agent "calls" it and the UI flows through
 *     the same `useRenderToolCall` path,
 *   - MCP Apps wired through the runtime — the agent can invoke Excalidraw
 *     MCP tools and the middleware emits activity events that
 *     `useRenderActivityMessage` picks up.
 *
 * The system prompt nudges the model toward the right surface per user
 * question and falls back to plain text otherwise.
 */

import { z } from "zod";
import type { RunnableConfig } from "@langchain/core/runnables";
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

const SYSTEM_PROMPT = `You are a helpful, concise assistant wired into a headless chat surface that demonstrates CopilotKit's full rendering stack. Pick the right surface for each user question and fall back to plain text when none of the tools fit.

Routing rules:
  - If the user asks about weather for a place, call \`get_weather\` with the location.
  - If the user asks about a stock or ticker (AAPL, TSLA, MSFT, ...), call \`get_stock_price\` with the ticker.
  - If the user asks for a chart, graph, or visualization of revenue, sales, or other metrics over time, call \`get_revenue_chart\`.
  - If the user asks you to highlight, flag, or mark a short note or phrase, call the frontend \`highlight_note\` tool with the text and a color (yellow, pink, green, or blue). Do NOT ask the user for the color — pick a sensible one if they didn't say.
  - If the user asks to draw, sketch, or diagram something, use the Excalidraw MCP tools that are available to you.
  - Otherwise, reply in plain text.

After a tool returns, write one short sentence summarizing the result. Never fabricate data a tool could provide.`;

const AgentStateAnnotation = Annotation.Root({
  ...CopilotKitStateAnnotation.spec,
});

type AgentState = typeof AgentStateAnnotation.State;

const getWeather = tool(
  async ({ location }) =>
    JSON.stringify({
      city: location,
      temperature: 68,
      humidity: 55,
      wind_speed: 10,
      conditions: "Sunny",
    }),
  {
    name: "get_weather",
    description:
      "Get the current weather for a given location. Returns a mock payload with city, temperature in Fahrenheit, humidity, wind speed, and conditions.",
    schema: z.object({
      location: z.string().describe("City or location name"),
    }),
  },
);

const getStockPrice = tool(
  async ({ ticker }) =>
    JSON.stringify({
      ticker: ticker.toUpperCase(),
      price_usd: 189.42,
      change_pct: 1.27,
    }),
  {
    name: "get_stock_price",
    description:
      "Get a mock current price for a stock ticker. Returns a payload with the ticker symbol (uppercased), price in USD, and percentage change for the day.",
    schema: z.object({
      ticker: z.string().describe("Stock ticker symbol"),
    }),
  },
);

const getRevenueChart = tool(
  async () =>
    JSON.stringify({
      title: "Quarterly revenue",
      subtitle: "Last six months · USD thousands",
      data: [
        { label: "Jan", value: 38 },
        { label: "Feb", value: 47 },
        { label: "Mar", value: 52 },
        { label: "Apr", value: 49 },
        { label: "May", value: 63 },
        { label: "Jun", value: 71 },
      ],
    }),
  {
    name: "get_revenue_chart",
    description:
      "Get a mock six-month revenue series for a chart visualization. Returns a title, subtitle, and an array of {label, value} points. Use this whenever the user asks for a chart, graph, or visualization of revenue, sales, or other quarterly/monthly metrics.",
    schema: z.object({}),
  },
);

const tools = [getWeather, getStockPrice, getRevenueChart];

/**
 * Normalize an AIMessage so that tool_calls in additional_kwargs are promoted
 * to the top-level tool_calls array.  @langchain/openai streaming sometimes
 * places tool_calls only in additional_kwargs when the response also carries
 * content text, which causes shouldContinue to miss them.
 */
function normalizeResponse(msg: AIMessage): AIMessage {
  if (msg.tool_calls?.length) return msg;

  const kw = msg.additional_kwargs as {
    tool_calls?: Array<{
      id?: string;
      type?: string;
      function?: { name: string; arguments: string };
    }>;
  };
  if (!kw?.tool_calls?.length) return msg;

  const toolCalls = kw.tool_calls.map((tc) => ({
    name: tc.function?.name ?? "",
    args: tc.function?.arguments ? JSON.parse(tc.function.arguments) : {},
    id: tc.id,
    type: "tool_call" as const,
  }));

  return new AIMessage({
    content: msg.content,
    additional_kwargs: msg.additional_kwargs,
    tool_calls: toolCalls,
    response_metadata: msg.response_metadata,
    id: msg.id,
  });
}

async function chatNode(state: AgentState, config: RunnableConfig) {
  const model = new ChatOpenAI({ temperature: 0, model: "gpt-4o-mini" });

  const modelWithTools = model.bindTools!([
    ...convertActionsToDynamicStructuredTools(state.copilotkit?.actions ?? []),
    ...tools,
  ]);

  const response = await modelWithTools.invoke(
    [new SystemMessage({ content: SYSTEM_PROMPT }), ...state.messages],
    config,
  );

  return { messages: normalizeResponse(response as AIMessage) };
}

function shouldContinue({ messages, copilotkit }: AgentState) {
  const lastMessage = messages[messages.length - 1] as AIMessage;

  if (lastMessage.tool_calls?.length) {
    const actions = copilotkit?.actions;
    const toolCallName = lastMessage.tool_calls[0].name;

    if (!actions || actions.every((action) => action.name !== toolCallName)) {
      return "tool_node";
    }
  }

  return "__end__";
}

const workflow = new StateGraph(AgentStateAnnotation)
  .addNode("chat_node", chatNode)
  .addNode("tool_node", new ToolNode(tools))
  .addEdge(START, "chat_node")
  .addEdge("tool_node", "chat_node")
  .addConditionalEdges("chat_node", shouldContinue as any);

const memory = new MemorySaver();

export const graph = workflow.compile({ checkpointer: memory });
