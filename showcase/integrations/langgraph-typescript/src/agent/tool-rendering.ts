/**
 * Tool Rendering agent -- TypeScript port of tool_rendering_agent.py.
 *
 * Backs the tool-rendering demos:
 *   - tool-rendering-default-catchall  (no frontend renderers)
 *   - tool-rendering-custom-catchall   (wildcard renderer on frontend)
 *   - tool-rendering                   (per-tool + catch-all on frontend)
 *
 * All cells share this backend -- they differ only in how the frontend
 * renders the same tool calls.
 */

// @region[weather-tool-backend]
import { z } from "zod";
import { RunnableConfig } from "@langchain/core/runnables";
import { tool } from "@langchain/core/tools";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AIMessage, SystemMessage } from "@langchain/core/messages";
import {
  Annotation,
  MemorySaver,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import {
  convertActionsToDynamicStructuredTools,
  CopilotKitStateAnnotation,
} from "@copilotkit/sdk-js/langgraph";

// ---------------------------------------------------------------------------
// 1. Agent state -- extends CopilotKit state annotation
// ---------------------------------------------------------------------------

const AgentStateAnnotation = Annotation.Root({
  ...CopilotKitStateAnnotation.spec,
});

export type AgentState = typeof AgentStateAnnotation.State;

// ---------------------------------------------------------------------------
// 2. System prompt -- matches LGP exactly
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT =
  "You are a travel & lifestyle concierge. Use the mock tools for " +
  "weather, flights, stock prices, or d20 rolls when the user asks; " +
  "otherwise reply in plain text. For flights, default origin to 'SFO' " +
  "if the user only names a destination. Call multiple tools in one " +
  "turn if asked. After tools return, summarize in one short sentence. " +
  "Never fabricate data a tool could provide.";

// ---------------------------------------------------------------------------
// 3. Tools -- aligned with LGP tool definitions
// ---------------------------------------------------------------------------

const getWeather = tool(
  async ({ location }) => ({
    city: location,
    temperature: 68,
    humidity: 55,
    wind_speed: 10,
    conditions: "Sunny",
  }),
  {
    name: "get_weather",
    description: "Get the current weather for a given location.",
    schema: z.object({
      location: z.string().describe("City name"),
    }),
  },
);
// @endregion[weather-tool-backend]

const searchFlights = tool(
  async ({ origin, destination }) => ({
    origin,
    destination,
    flights: [
      {
        airline: "United",
        flight: "UA231",
        depart: "08:15",
        arrive: "16:45",
        price_usd: 348,
      },
      {
        airline: "Delta",
        flight: "DL412",
        depart: "11:20",
        arrive: "19:55",
        price_usd: 312,
      },
      {
        airline: "JetBlue",
        flight: "B6722",
        depart: "17:05",
        arrive: "01:30",
        price_usd: 289,
      },
    ],
  }),
  {
    name: "search_flights",
    description:
      "Search mock flights from an origin airport to a destination airport.",
    schema: z.object({
      origin: z.string().describe("Origin airport code"),
      destination: z.string().describe("Destination airport code"),
    }),
  },
);

const getStockPrice = tool(
  async ({ ticker, price_usd, change_pct }) => {
    const randInt = (lo: number, hi: number) =>
      Math.floor(Math.random() * (hi - lo + 1)) + lo;
    const sign = Math.random() < 0.5 ? -1 : 1;
    return {
      ticker: ticker.toUpperCase(),
      price_usd:
        price_usd != null
          ? Math.round(price_usd * 100) / 100
          : Math.round((100 + randInt(0, 400) + randInt(0, 99) / 100) * 100) /
            100,
      change_pct:
        change_pct != null
          ? Math.round(change_pct * 100) / 100
          : Math.round(sign * (randInt(0, 300) / 100) * 100) / 100,
    };
  },
  {
    name: "get_stock_price",
    description:
      "Get a mock current price for a stock ticker.\n\n" +
      "The optional `price_usd` and `change_pct` arguments let the LLM (or " +
      "aimock fixture) script a deterministic ticker quote for testing -- " +
      "when supplied, the tool echoes them back verbatim. When omitted (or " +
      "null), the tool returns mock random values. Mirrors the " +
      "deterministic-`value` pattern on `roll_d20`.",
    schema: z.object({
      ticker: z.string().describe("Stock ticker symbol"),
      price_usd: z
        .number()
        .optional()
        .describe(
          "Deterministic price override for testing (echoed back verbatim)",
        ),
      change_pct: z
        .number()
        .optional()
        .describe(
          "Deterministic change-pct override for testing (echoed back verbatim)",
        ),
    }),
  },
);

const rollD20 = tool(
  async ({ value }) => {
    const rolled =
      typeof value === "number" && value >= 1 && value <= 20
        ? value
        : Math.floor(Math.random() * 20) + 1;
    return { sides: 20, value: rolled, result: rolled };
  },
  {
    name: "roll_d20",
    description: "Roll a 20-sided die.",
    schema: z.object({
      value: z
        .number()
        .int()
        .optional()
        .describe(
          "Deterministic override for the roll result (used by test fixtures)",
        ),
    }),
  },
);

const tools = [getWeather, searchFlights, getStockPrice, rollD20];

// ---------------------------------------------------------------------------
// 4. Chat node -- binds backend + frontend tools, invokes the model
// ---------------------------------------------------------------------------

async function chatNode(state: AgentState, config: RunnableConfig) {
  const model = new ChatOpenAI({ model: "gpt-5.4" });

  const modelWithTools = model.bindTools!([
    ...convertActionsToDynamicStructuredTools(state.copilotkit?.actions ?? []),
    ...tools,
  ]);

  const systemMessage = new SystemMessage({ content: SYSTEM_PROMPT });

  const response = await modelWithTools.invoke(
    [systemMessage, ...state.messages],
    config,
  );

  return { messages: response };
}

// ---------------------------------------------------------------------------
// 5. Routing -- send tool calls to tool_node unless they're CopilotKit
//    frontend actions.
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
// 6. Compile the graph
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
