/**
 * Beautiful Chat — LangGraph TypeScript agent backing the flagship showcase cell.
 *
 * Ported from langgraph-python/src/agents/beautiful_chat.py. The Python version
 * uses LangChain's create_agent + CopilotKitMiddleware + StateStreamingMiddleware;
 * this port stays closer to the showcase's existing TS pattern (single
 * StateGraph with chat + tool_node, CopilotKit state annotation) so it fits the
 * kitchen-sink layout already established in graph.ts.
 *
 * Local tools:
 *   - query_data           — natural-language query over beautiful-chat-data/db.csv
 *   - manage_todos         — create/update todo list with auto-assigned ids
 *   - get_todos            — read current todos from agent state
 *   - search_flights       — fixed-schema A2UI flight search (2 flights)
 *
 * Dynamic A2UI uses the AG-UI generation tool and its bounded validation/retry
 * loop, with the runtime-provided catalog and usage guide.
 *
 * Data files: ./beautiful-chat-data/db.csv + schemas/flight_schema.json
 */

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { RunnableConfig } from "@langchain/core/runnables";
import { tool } from "@langchain/core/tools";
import type { ToolRunnableConfig } from "@langchain/core/tools";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import type { AIMessage } from "@langchain/core/messages";
import { SystemMessage, ToolMessage } from "@langchain/core/messages";
import {
  Annotation,
  Command,
  getCurrentTaskInput,
  MemorySaver,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { makeChatOpenAI } from "./openai-headers";
import { getA2UITools } from "@ag-ui/langgraph";
import { a2uiContext } from "../../_shared/a2ui/context";
import {
  convertActionsToDynamicStructuredTools,
  copilotkitEmitState,
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
  "ag-ui": Annotation<Record<string, unknown>>,
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
  const schema: unknown[] = JSON.parse(raw);
  cachedFlightSchema = schema;
  return schema;
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
  async ({ todos }, config: ToolRunnableConfig) => {
    const toolCallId = config.toolCall?.id;
    if (typeof toolCallId !== "string" || toolCallId.length === 0) {
      throw new Error(
        "manage_todos: missing tool_call_id — tool was invoked outside a " +
          "ToolNode context.",
      );
    }

    const withIds = todos.map((t) => ({
      ...t,
      id: t.id && t.id.length > 0 ? t.id : randomUUID(),
    }));

    // Emit state to the frontend immediately so the canvas updates.
    // The Command below updates the graph's internal state, but the
    // CopilotKit AG-UI pipeline only picks up state from explicit
    // copilotkit_emit_state events (like Python's StateStreamingMiddleware
    // does). Without this, useAgent().state.todos stays empty.
    await copilotkitEmitState(config, { todos: withIds });

    return new Command({
      update: {
        todos: withIds,
        messages: [
          new ToolMessage({
            content: "Successfully updated todos",
            name: "manage_todos",
            id: randomUUID(),
            tool_call_id: toolCallId,
          }),
        ],
      },
    });
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
  async (_input, config: ToolRunnableConfig) => {
    const state = getCurrentTaskInput<BeautifulChatState>(config);
    return JSON.stringify(state.todos ?? []);
  },
  {
    name: "get_todos",
    description: "Get the current todos.",
    schema: z.object({}),
  },
);

const CATALOG_ID = "copilotkit://app-dashboard-catalog";
const FLIGHT_SURFACE_ID = "flight-search-results";

// All fields optional (matching Python's total=False) so the LLM/aimock
// fixture can omit auxiliary fields without tripping zod validation.
const FlightSchema = z.object({
  airline: z.string().optional(),
  airlineLogo: z.string().optional(),
  flightNumber: z.string().optional(),
  origin: z.string().optional(),
  destination: z.string().optional(),
  date: z.string().optional(),
  departureTime: z.string().optional(),
  arrivalTime: z.string().optional(),
  duration: z.string().optional(),
  status: z.string().optional(),
  price: z.string().optional(),
});

const searchFlights = tool(
  async ({ flights }) => {
    const schema = await loadFlightSchema();
    const ops = [
      {
        version: "v0.9",
        createSurface: {
          surfaceId: FLIGHT_SURFACE_ID,
          catalogId: CATALOG_ID,
        },
      },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: FLIGHT_SURFACE_ID,
          components: schema,
        },
      },
      {
        version: "v0.9",
        updateDataModel: {
          surfaceId: FLIGHT_SURFACE_ID,
          path: "/",
          value: { flights },
        },
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

// Backend tools remain local; toolsForRun adds catalog-bound UI generation.
const tools = [queryData, manageTodos, getTodos, searchFlights];

// Keep generation in the graph so malformed output gets the toolkit's bounded
// validate/retry loop and terminal failure envelope, rather than a synthetic
// "rendered" result for an unvalidated frontend action.
function toolsForRun(state: BeautifulChatState, config: RunnableConfig) {
  const context = a2uiContext(state);
  const actions = Array.isArray(context.properties.actions)
    ? context.properties.actions
    : [];
  const renderName =
    typeof context.properties.inject_a2ui_tool === "string"
      ? context.properties.inject_a2ui_tool
      : "render_a2ui";
  const enabled =
    context.properties.inject_a2ui_tool ??
    actions.some(
      (action) => (action.function?.name ?? action.name) === renderName,
    );
  if (!enabled) return { context, actions, localTools: tools };
  const generator = getA2UITools({
    model: makeChatOpenAI(config, { model: "gpt-5-mini", temperature: 0 }),
    defaultCatalogId: context.catalogId ?? CATALOG_ID,
    catalog: context.catalog,
  });
  const generationTool = tool(
    async (input, toolConfig: ToolRunnableConfig) => {
      if (!context.catalog || !context.catalogId) {
        return JSON.stringify({
          code: "a2ui_recovery_exhausted",
          error:
            "The frontend A2UI component schema is missing. Enable catalog schema context before requesting a dashboard.",
          attempts: [],
        });
      }
      const runtimeConfig = { ...toolConfig, state: context.state };
      return generator.invoke(input, runtimeConfig);
    },
    {
      name: generator.name,
      description: generator.description,
      schema: generator.schema,
    },
  );
  return {
    context,
    actions: actions.filter(
      (action) => (action.function?.name ?? action.name) !== renderName,
    ),
    localTools: [...tools, generationTool],
  };
}

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
- If UI generation reports exhausted recovery, explain the failure briefly;
  do not claim it rendered or start another generation attempt automatically.
`;

async function chatNode(state: BeautifulChatState, config: RunnableConfig) {
  const model = makeChatOpenAI(config, {
    model: "gpt-5-mini",
    modelKwargs: { parallel_tool_calls: false },
  });

  const { context, actions, localTools } = toolsForRun(state, config);
  const modelWithTools = model.bindTools!([
    ...convertActionsToDynamicStructuredTools(actions),
    ...localTools,
  ]);

  const systemMessage = new SystemMessage({
    content: `${SYSTEM_PROMPT}\n\n${context.prompt}`,
  });

  const response = await modelWithTools.invoke(
    [systemMessage, ...state.messages],
    config,
  );

  return { messages: response };
}

// ---------------------------------------------------------------------------
// 5. Routing
// ---------------------------------------------------------------------------

function shouldContinue(state: BeautifulChatState) {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1] as AIMessage;
  if (lastMessage.tool_calls?.length) {
    const actions = a2uiContext(state).properties.actions;
    const toolCallName = lastMessage.tool_calls![0].name;
    if (
      toolCallName === "generate_a2ui" ||
      !Array.isArray(actions) ||
      actions.every(
        (action) => (action.function?.name ?? action.name) !== toolCallName,
      )
    ) {
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
  .addNode("tool_node", (state, config) =>
    new ToolNode(toolsForRun(state, config).localTools).invoke(state, config),
  )
  .addEdge(START, "chat_node")
  .addEdge("tool_node", "chat_node")
  .addConditionalEdges("chat_node", shouldContinue as any);

const memory = new MemorySaver();

export const graph = workflow.compile({
  checkpointer: memory,
});
