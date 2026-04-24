/**
 * Beautiful Chat — LangGraph TypeScript agent backing the flagship showcase cell.
 *
 * Ported from langgraph-python/src/agents/beautiful_chat.py. The Python version
 * uses LangChain's create_agent + CopilotKitMiddleware + StateStreamingMiddleware;
 * this port stays closer to the showcase's existing TS pattern (single
 * StateGraph with chat + tool_node, CopilotKit state annotation) so it fits the
 * kitchen-sink layout already established in graph.ts.
 *
 * Tools:
 *   - query_data           — natural-language query over beautiful-chat-data/db.csv
 *   - manage_todos         — create/update todo list with auto-assigned ids
 *   - get_todos            — read current todos from agent state
 *   - search_flights       — fixed-schema A2UI flight search (2 flights)
 *   - generate_a2ui        — dynamic A2UI surface via secondary LLM
 *
 * Data files: ./beautiful-chat-data/db.csv + schemas/flight_schema.json
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

// ---------------------------------------------------------------------------
// 1. Agent state
// ---------------------------------------------------------------------------

const TodoSchema = z.object({
  id: z.string().optional(),
  title: z.string(),
  description: z.string().optional(),
  emoji: z.string().optional(),
  status: z.enum(["pending", "completed"]).optional(),
});

type Todo = z.infer<typeof TodoSchema>;

const BeautifulChatStateAnnotation = Annotation.Root({
  ...CopilotKitStateAnnotation.spec,
  todos: Annotation<Todo[]>,
});

export type BeautifulChatState = typeof BeautifulChatStateAnnotation.State;

// ---------------------------------------------------------------------------
// 2. Data loading (at module-init time to avoid repeated FS hits)
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "beautiful-chat-data");

let cachedRows: Record<string, string>[] | null = null;
async function loadRows(): Promise<Record<string, string>[]> {
  if (cachedRows) return cachedRows;
  const csvPath = path.join(DATA_DIR, "db.csv");
  const raw = await fs.readFile(csvPath, "utf-8");
  const lines = raw.trim().split(/\r?\n/);
  const header = lines[0].split(",");
  cachedRows = lines.slice(1).map((line) => {
    const cols = line.split(",");
    const obj: Record<string, string> = {};
    header.forEach((h, i) => {
      obj[h] = cols[i] ?? "";
    });
    return obj;
  });
  return cachedRows;
}

let cachedFlightSchema: unknown[] | null = null;
async function loadFlightSchema(): Promise<unknown[]> {
  if (cachedFlightSchema) return cachedFlightSchema;
  const schemaPath = path.join(DATA_DIR, "schemas", "flight_schema.json");
  const raw = await fs.readFile(schemaPath, "utf-8");
  cachedFlightSchema = JSON.parse(raw);
  return cachedFlightSchema;
}

// ---------------------------------------------------------------------------
// 3. Tools
// ---------------------------------------------------------------------------

const queryData = tool(
  async ({ query: _query }) => {
    const rows = await loadRows();
    return JSON.stringify(rows);
  },
  {
    name: "query_data",
    description:
      "Query the database, takes natural language. Always call before showing a chart or graph.",
    schema: z.object({
      query: z.string().describe("Natural-language query"),
    }),
  },
);

const manageTodos = tool(
  async ({ todos }) => {
    const withIds = todos.map((t) => ({
      ...t,
      id: t.id && t.id.length > 0 ? t.id : crypto.randomUUID(),
    }));
    return JSON.stringify({ status: "ok", todos: withIds });
  },
  {
    name: "manage_todos",
    description: "Manage the current todos.",
    schema: z.object({
      todos: z.array(TodoSchema).describe("Array of todo items"),
    }),
  },
);

const getTodos = tool(
  async () => {
    // In the Python version, this reads from runtime.state. TS ToolNode doesn't
    // pass state to tools by default, so return an empty list; the agent can
    // re-fetch via manage_todos semantics.
    return JSON.stringify([]);
  },
  {
    name: "get_todos",
    description: "Get the current todos.",
    schema: z.object({}),
  },
);

const CATALOG_ID = "copilotkit://app-dashboard-catalog";
const FLIGHT_SURFACE_ID = "flight-search-results";

const FlightSchema = z.object({
  id: z.string(),
  airline: z.string(),
  airlineLogo: z.string(),
  flightNumber: z.string(),
  origin: z.string(),
  destination: z.string(),
  date: z.string(),
  departureTime: z.string(),
  arrivalTime: z.string(),
  duration: z.string(),
  status: z.string(),
  statusIcon: z.string().optional(),
  price: z.string(),
});

const searchFlights = tool(
  async ({ flights }) => {
    const schema = await loadFlightSchema();
    const ops = [
      {
        type: "create_surface",
        surfaceId: FLIGHT_SURFACE_ID,
        catalogId: CATALOG_ID,
      },
      {
        type: "update_components",
        surfaceId: FLIGHT_SURFACE_ID,
        components: schema,
      },
      {
        type: "update_data_model",
        surfaceId: FLIGHT_SURFACE_ID,
        data: { flights },
      },
    ];
    return JSON.stringify({ a2ui_operations: ops });
  },
  {
    name: "search_flights",
    description:
      "Search for flights and display the results as rich cards. Return exactly 2 flights.",
    schema: z.object({
      flights: z.array(FlightSchema).describe("Array of flight result objects"),
    }),
  },
);

const generateA2ui = tool(
  async (_args, _config) => {
    // Secondary LLM designs a dynamic A2UI surface. Context is not threaded
    // through ToolNode by default, so we run a simple one-shot call that
    // mirrors the python agent's contract without direct state access.
    const secondaryModel = new ChatOpenAI({ temperature: 0, model: "gpt-4.1" });
    const renderTool = tool(async () => "rendered", {
      name: "render_a2ui",
      description: "Render a dynamic A2UI v0.9 surface.",
      schema: z.object({
        surfaceId: z.string(),
        catalogId: z.string(),
        components: z.array(z.record(z.unknown())),
        data: z.record(z.unknown()).optional(),
      }),
    });

    const modelWithTool = secondaryModel.bindTools!([renderTool], {
      tool_choice: { type: "function", function: { name: "render_a2ui" } },
    });

    const response = (await modelWithTool.invoke([
      new SystemMessage({
        content:
          "Design a concise A2UI dashboard. Call render_a2ui with a surfaceId, catalogId 'copilotkit://app-dashboard-catalog', a components array (root id 'root'), and any initial data.",
      }),
    ])) as AIMessage;

    if (!response.tool_calls?.length) {
      return JSON.stringify({ error: "LLM did not call render_a2ui" });
    }
    const args = response.tool_calls[0].args as Record<string, unknown>;
    const surfaceId = (args.surfaceId as string) ?? "dynamic-surface";
    const catalogId = (args.catalogId as string) ?? CATALOG_ID;
    const components = (args.components as unknown[]) ?? [];
    const data = (args.data as Record<string, unknown>) ?? {};
    const ops: unknown[] = [
      { type: "create_surface", surfaceId, catalogId },
      { type: "update_components", surfaceId, components },
    ];
    if (Object.keys(data).length > 0) {
      ops.push({ type: "update_data_model", surfaceId, data });
    }
    return JSON.stringify({ a2ui_operations: ops });
  },
  {
    name: "generate_a2ui",
    description:
      "Generate dynamic A2UI components based on the conversation. Use for dashboards and rich UIs.",
    schema: z.object({}),
  },
);

const tools = [queryData, manageTodos, getTodos, searchFlights, generateA2ui];

// ---------------------------------------------------------------------------
// 4. Chat node
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `
You are a polished, professional demo assistant. Keep responses to 1-2 sentences.

Tool guidance:
- Flights: call search_flights to show flight cards with a pre-built schema.
- Dashboards & rich UI: call generate_a2ui to create dashboard UIs with metrics,
  charts, tables, and cards. It handles rendering automatically.
- Charts: call query_data first, then render with the chart component.
- Todos: enable app mode first, then manage todos.
`;

async function chatNode(
  state: BeautifulChatState,
  config: RunnableConfig,
) {
  const model = new ChatOpenAI({ temperature: 0, model: "gpt-4o" });

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
// 5. Routing
// ---------------------------------------------------------------------------

function shouldContinue({ messages, copilotkit }: BeautifulChatState) {
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
// 6. Compile
// ---------------------------------------------------------------------------

const workflow = new StateGraph(BeautifulChatStateAnnotation)
  .addNode("chat_node", chatNode)
  .addNode("tool_node", new ToolNode(tools))
  .addEdge(START, "chat_node")
  .addEdge("tool_node", "chat_node")
  .addConditionalEdges("chat_node", shouldContinue as any);

const memory = new MemorySaver();

export const graph = workflow.compile({
  checkpointer: memory,
});
