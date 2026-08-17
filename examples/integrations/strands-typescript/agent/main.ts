/**
 * Strands AG-UI Integration Example (TypeScript).
 *
 * Demonstrates a Strands agent integrated with AG-UI, featuring:
 * - Shared state management between agent and UI (todos)
 * - Backend tool execution (query_data, manage_todos, search_flights)
 * - Generative UI rendering (generate_a2ui)
 */

import { Agent, tool } from "@strands-agents/sdk";
import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import { StrandsAgent } from "@ag-ui/aws-strands";
import type { StrandsAgentConfig } from "@ag-ui/aws-strands";
import { createStrandsApp } from "@ag-ui/aws-strands/server";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { parse } from "csv-parse/sync";
import { v4 as uuidv4 } from "uuid";

import "dotenv/config";

// ---------------------------------------------------------------------------
// Shared state schema: todos
// ---------------------------------------------------------------------------

const todoSchema = z.object({
  id: z.string().default(""),
  title: z.string(),
  description: z.string(),
  emoji: z.string(),
  status: z.string().default("pending"),
});

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const manageTodos = tool({
  name: "manage_todos",
  description:
    "Manage the current todos. IMPORTANT: Always pass the full todo list, not just new items. " +
    "Each todo should have a title, description, emoji, and status (pending/completed).",
  inputSchema: z.object({
    todos: z.array(todoSchema),
  }),
  callback({ todos }) {
    for (const todo of todos) {
      if (!todo.id) {
        todo.id = uuidv4();
      }
    }
    return "Successfully updated todos";
  },
});

const getTodos = tool({
  name: "get_todos",
  description:
    "Get the current todos. Returns a JSON string of the current todos list. " +
    "The list is injected into the prompt via the state context builder, but this " +
    "tool is still useful when the model wants to re-confirm state.",
  callback() {
    return "See the current todos list already provided in the conversation context.";
  },
});

const csvPath = path.join(__dirname, "src", "db.csv");
const csvContent = fs.readFileSync(csvPath, "utf-8");
const cachedData = parse(csvContent, {
  columns: true,
  relax_column_count: true,
});

const queryData = tool({
  name: "query_data",
  description:
    "Query the database with a natural-language query. " +
    "Always call this before rendering a chart so the UI has data to plot.",
  inputSchema: z.object({
    query: z.string(),
  }),
  callback() {
    return JSON.stringify(cachedData);
  },
});

// ---------------------------------------------------------------------------
// A2UI tools
// ---------------------------------------------------------------------------

const flightSchemaPath = path.join(
  __dirname,
  "src",
  "a2ui",
  "schemas",
  "flight_schema.json",
);
const FLIGHT_SCHEMA = JSON.parse(fs.readFileSync(flightSchemaPath, "utf-8"));
const CATALOG_ID = "copilotkit://app-dashboard-catalog";
const FLIGHT_SURFACE_ID = "flight-search-results";

function a2uiRender(operations: object[]): string {
  return JSON.stringify({ a2ui_operations: operations });
}

const flightSchema = z.object({
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
  statusIcon: z.string(),
  price: z.string(),
});

const searchFlights = tool({
  name: "search_flights",
  description:
    "Search for flights and display the results as rich cards. " +
    "Return exactly 2 flights. Each flight must have: id, airline, airlineLogo " +
    "(Google favicon API URL for the airline domain), flightNumber, origin, " +
    'destination, date (e.g. "Tue, Mar 18" - use near-future dates), ' +
    'departureTime, arrivalTime, duration (e.g. "4h 25m"), status (e.g. ' +
    '"On Time" or "Delayed"), statusIcon (colored dot URL: ' +
    "https://placehold.co/12/22c55e/22c55e.png for On Time, " +
    "https://placehold.co/12/eab308/eab308.png for Delayed, " +
    "https://placehold.co/12/ef4444/ef4444.png for Cancelled), and price " +
    '(e.g. "$289").',
  inputSchema: z.object({
    flight_list: z.object({
      flights: z.array(flightSchema),
    }),
  }),
  callback({ flight_list }) {
    return a2uiRender([
      {
        type: "create_surface",
        surfaceId: FLIGHT_SURFACE_ID,
        catalogId: CATALOG_ID,
      },
      {
        type: "update_components",
        surfaceId: FLIGHT_SURFACE_ID,
        components: FLIGHT_SCHEMA,
      },
      {
        type: "update_data_model",
        surfaceId: FLIGHT_SURFACE_ID,
        data: { flights: flight_list.flights },
      },
    ]);
  },
});

const generateA2ui = tool({
  name: "generate_a2ui",
  description:
    "Generate dynamic A2UI components based on the conversation. " +
    "A secondary LLM designs the UI schema and data. The result is returned " +
    "as an a2ui_operations container for the middleware to detect and render.",
  inputSchema: z.object({
    user_intent: z.string(),
  }),
  async callback({ user_intent }, context) {
    const { default: OpenAI } = await import("openai");
    const openai = new OpenAI();

    // Seed the secondary LLM with catalog/component schema context from CopilotKit
    let contextText = "";
    try {
      const agent = context?.agent as any;
      const contextEntries =
        agent?.state?.get?.("agui_context") ?? agent?.state?.agui_context ?? [];
      if (Array.isArray(contextEntries)) {
        contextText = contextEntries
          .filter((e: any) => typeof e === "object" && e !== null && e.value)
          .map((e: any) => e.value)
          .join("\n\n");
      }
    } catch {
      // Context not available — proceed without it
    }

    const prompt = contextText
      ? `${contextText}\n\n${user_intent}`
      : user_intent;

    let response;
    try {
      response = await openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [{ role: "user", content: prompt }],
        tools: [
          {
            type: "function",
            function: {
              name: "render_a2ui",
              description: "Render a dynamic A2UI v0.9 surface.",
              parameters: {
                type: "object",
                properties: {
                  surfaceId: { type: "string" },
                  catalogId: { type: "string" },
                  components: { type: "array", items: { type: "object" } },
                  data: { type: "object" },
                },
                required: ["surfaceId", "catalogId", "components"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "render_a2ui" } },
      });
    } catch (err) {
      return JSON.stringify({
        error: `dynamic-a2ui LLM call failed: ${err}`,
      });
    }

    const toolCall = response.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.type !== "function") {
      return JSON.stringify({ error: "LLM did not call render_a2ui" });
    }

    let args: Record<string, unknown>;
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch {
      return JSON.stringify({ error: "Failed to parse render_a2ui arguments" });
    }

    const surfaceId = (args.surfaceId as string) || "dynamic-surface";
    const catalogId = (args.catalogId as string) || CATALOG_ID;
    const components = (args.components as object[]) || [];
    const data = (args.data as Record<string, unknown>) || {};

    const ops: object[] = [
      { type: "create_surface", surfaceId, catalogId },
      { type: "update_components", surfaceId, components },
    ];
    if (data && Object.keys(data).length > 0) {
      ops.push({ type: "update_data_model", surfaceId, data });
    }

    return a2uiRender(ops);
  },
});

// ---------------------------------------------------------------------------
// Shared-state config
// ---------------------------------------------------------------------------

const sharedStateConfig: StrandsAgentConfig = {
  stateContextBuilder: (input: any, userMessage: string) => {
    const stateDict = input?.state;
    if (stateDict && typeof stateDict === "object" && "todos" in stateDict) {
      const todosJson = JSON.stringify(stateDict.todos || [], null, 2);
      return `Current todos list:\n${todosJson}\n\nUser request: ${userMessage}`;
    }
    return userMessage;
  },
  toolBehaviors: {
    manage_todos: {
      stateFromArgs: async (context: any) => {
        try {
          let toolInput = context.toolInput;
          if (typeof toolInput === "string") {
            toolInput = JSON.parse(toolInput);
          }
          const todos = toolInput?.todos || [];
          return { todos };
        } catch {
          return undefined;
        }
      },
      predictState: [
        {
          stateKey: "todos",
          tool: "manage_todos",
          toolArgument: "todos",
        },
      ],
    },
  },
};

// ---------------------------------------------------------------------------
// Agent wiring
// ---------------------------------------------------------------------------

const apiKey = process.env.OPENAI_API_KEY || "";
const baseURL = process.env.OPENAI_BASE_URL;

const model = new OpenAIModel({
  apiKey,
  modelId: "gpt-5.4",
  params: { parallel_tool_calls: false },
  ...(baseURL ? { clientConfig: { baseURL } } : {}),
});

const systemPrompt =
  "You are a polished, professional demo assistant. Keep responses to 1-2 sentences.\n\n" +
  "Tool guidance:\n" +
  "- Flights: call search_flights to show flight cards with a pre-built schema.\n" +
  "- Dashboards & rich UI: call generate_a2ui to create dashboard UIs with metrics,\n" +
  "  charts, tables, and cards. It handles rendering automatically.\n" +
  "- Charts: call query_data first, then render with the chart component.\n" +
  "- Todos: enable app mode first, then manage todos.\n" +
  "- Diagrams (Excalidraw): when MCP Excalidraw tools are exposed (e.g. create_view),\n" +
  "  call create_view ONCE with 3-5 elements (shapes + arrows + optional title text).\n" +
  "  Include ONE cameraUpdate at the end to frame the diagram. Do NOT call read_me\n" +
  "  even if it appears in the toolset - you already know the basic shape API.\n" +
  '- A2UI actions: when you see a log_a2ui_event result (e.g. "view_details"),\n' +
  "  respond with a brief confirmation. The UI already updated on the frontend.";

const strandsAgent = new Agent({
  model,
  systemPrompt,
  tools: [manageTodos, getTodos, queryData, generateA2ui, searchFlights],
});

const aguiAgent = new StrandsAgent({
  agent: strandsAgent,
  name: "todo_demo_agent",
  description:
    "A polished demo assistant for the todo / charts / a2ui / flights " +
    "showcase, running on Strands (TypeScript).",
  config: sharedStateConfig,
});

const agentPath = process.env.AGENT_PATH || "/";

async function main() {
  const app = await createStrandsApp(aguiAgent, { path: agentPath });

  app.get("/health", (_req: any, res: any) => {
    res.json({ status: "ok" });
  });

  const port = Number(process.env.AGENT_PORT ?? 8000);
  app.listen(port, () => {
    console.log(`Strands AG-UI agent listening on http://localhost:${port}`);
  });
}

void main();
