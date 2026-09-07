import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  A2UI_OPERATIONS_KEY,
  createSurface,
  updateComponents,
  updateDataModel,
} from "@ag-ui/a2ui-toolkit";
import { StrandsAgent } from "@ag-ui/aws-strands";
import type {
  StatePayload,
  StrandsAgentConfig,
  ToolCallContext,
} from "@ag-ui/aws-strands";
import type { RunAgentInput } from "@ag-ui/core";
import { Agent, tool } from "@strands-agents/sdk";
import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import { parse } from "csv-parse/sync";
import dotenv from "dotenv";
import OpenAI from "openai";
import { z } from "zod";

import { forwardingFetch } from "./header-forwarding.js";

const agentDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(agentDir, "../../.env") });
dotenv.config();

const AIMOCK_CONTEXT = "strands-typescript";
const APP_CATALOG_ID = "copilotkit://app-dashboard-catalog";
const FLIGHT_SURFACE_ID = "flight-search-results";
const FLIGHT_SCHEMA = JSON.parse(
  readFileSync(
    resolve(agentDir, "a2ui", "schemas", "flight_schema.json"),
    "utf8",
  ),
) as Array<Record<string, unknown>>;

const SYSTEM_PROMPT = `You are a polished, professional demo assistant. Keep responses to 1-2 sentences.

Tool guidance:

- Flights: call search_flights to show flight cards with a pre-built schema.
- Dashboards & rich UI: call generate_a2ui to create dashboard UIs with metrics,
  charts, tables, and cards. It handles rendering automatically.
- Charts: call query_data first, then render with the chart component.
- Todos: enable app mode first, then manage todos.
- A2UI actions: when you see a log_a2ui_event result (e.g. "view_details"),
  respond with a brief confirmation. The UI already updated on the frontend.`;

export interface StarterState {
  todos?: Todo[];
  messages?: unknown[];
}

interface Todo {
  id: string;
  title: string;
  description: string;
  emoji: string;
  status: "pending" | "completed";
}

const todoSchema = z.object({
  id: z.string().optional(),
  title: z.string(),
  description: z.string(),
  emoji: z.string(),
  status: z.enum(["pending", "completed"]).default("pending"),
});

function normalizeTodos(todos: z.infer<typeof todoSchema>[]): Todo[] {
  return todos.map((todo) => ({
    id: todo.id || randomUUID(),
    title: todo.title,
    description: todo.description,
    emoji: todo.emoji,
    status: todo.status,
  }));
}

function parseToolInput(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function buildStatePrompt(input: RunAgentInput, prompt: string): string {
  const state = (input.state ?? {}) as StarterState;
  if (!state.todos) return prompt;
  return `Current todos list:\n${JSON.stringify(state.todos, null, 2)}\n\nUser request: ${prompt}`;
}

async function todosStateFromArgs(
  context: ToolCallContext,
): Promise<StatePayload | null> {
  const input = parseToolInput(context.toolInput);
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const result = z
    .array(todoSchema)
    .safeParse((input as Record<string, unknown>).todos);
  return result.success ? { todos: normalizeTodos(result.data) } : null;
}

const manageTodos = tool({
  name: "manage_todos",
  description:
    "Replace the current todo list. Always pass the complete list, including unchanged todos.",
  inputSchema: z.object({ todos: z.array(todoSchema) }),
  callback: ({ todos }) =>
    `Updated ${normalizeTodos(todos).length} todo item(s).`,
});

const getTodos = tool({
  name: "get_todos",
  description: "Read the current todo list from the shared state context.",
  inputSchema: z.object({}),
  callback: () => "Read the current todos list from the conversation context.",
});

const dataRows = parse(readFileSync(resolve(agentDir, "db.csv"), "utf8"), {
  columns: true,
  skip_empty_lines: true,
}) as Array<Record<string, string>>;

const queryData = tool({
  name: "query_data",
  description:
    "Query the financial data. Always call this before asking the frontend to render a chart.",
  inputSchema: z.object({ query: z.string() }),
  callback: () => JSON.stringify(dataRows),
});

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
    "Show exactly two flight results as rich cards. Include every requested flight field.",
  inputSchema: z.object({ flights: z.array(flightSchema).length(2) }),
  callback: ({ flights }) =>
    JSON.parse(
      JSON.stringify({
        [A2UI_OPERATIONS_KEY]: [
          createSurface(FLIGHT_SURFACE_ID, APP_CATALOG_ID),
          updateComponents(FLIGHT_SURFACE_ID, FLIGHT_SCHEMA),
          updateDataModel(FLIGHT_SURFACE_ID, { flights }),
        ],
      }),
    ),
});

let openaiClient: OpenAI | undefined;

function getOpenAIClient(): OpenAI {
  openaiClient ??= new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    ...(process.env.OPENAI_BASE_URL
      ? { baseURL: process.env.OPENAI_BASE_URL }
      : {}),
    defaultHeaders: { "x-aimock-context": AIMOCK_CONTEXT },
    fetch: forwardingFetch,
  });
  return openaiClient;
}

const generateA2ui = tool({
  name: "generate_a2ui",
  description:
    "Design and render a dashboard with A2UI components for the user's request.",
  inputSchema: z.object({ user_intent: z.string() }),
  callback: async ({ user_intent }) => {
    const response = await getOpenAIClient().chat.completions.create({
      model: process.env.MODEL_ID ?? "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "Design an A2UI dashboard. Use a flat component array with root id 'root'. Available components: Card, Column, Row, Text, Metric, PieChart, BarChart, DataTable, StatusBadge, InfoRow, PrimaryButton.",
        },
        { role: "user", content: user_intent },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "render_a2ui",
            description: "Return the dashboard surface definition.",
            parameters: {
              type: "object",
              properties: {
                surfaceId: { type: "string" },
                catalogId: { type: "string" },
                components: {
                  type: "array",
                  items: { type: "object", additionalProperties: true },
                },
                data: { type: "object", additionalProperties: true },
              },
              required: ["surfaceId", "components"],
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "render_a2ui" } },
    });

    const call = response.choices[0]?.message.tool_calls?.[0];
    if (!call || call.type !== "function") {
      throw new Error("The UI model did not return an A2UI surface.");
    }
    const args = JSON.parse(call.function.arguments) as {
      surfaceId?: string;
      catalogId?: string;
      components?: Array<Record<string, unknown>>;
      data?: Record<string, unknown>;
    };
    const surfaceId = args.surfaceId || "dynamic-dashboard";
    const operations = [
      createSurface(surfaceId, args.catalogId || APP_CATALOG_ID),
      updateComponents(surfaceId, args.components ?? []),
    ];
    if (args.data) operations.push(updateDataModel(surfaceId, args.data));
    return JSON.parse(JSON.stringify({ [A2UI_OPERATIONS_KEY]: operations }));
  },
});

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error(
    "OPENAI_API_KEY is required. Add it to the starter's .env file.",
  );
}

const model = new OpenAIModel({
  apiKey,
  modelId: process.env.MODEL_ID ?? "gpt-4o",
  api: "chat",
  clientConfig: {
    ...(process.env.OPENAI_BASE_URL
      ? { baseURL: process.env.OPENAI_BASE_URL }
      : {}),
    defaultHeaders: { "x-aimock-context": AIMOCK_CONTEXT },
    fetch: forwardingFetch,
  },
});

const config: StrandsAgentConfig = {
  stateContextBuilder: buildStatePrompt,
  toolBehaviors: {
    manage_todos: { stateFromArgs: todosStateFromArgs },
  },
};

const strandsAgent = new Agent({
  model,
  systemPrompt: SYSTEM_PROMPT,
  tools: [manageTodos, getTodos, queryData, generateA2ui, searchFlights],
});

export const agent = new StrandsAgent({
  agent: strandsAgent,
  name: "strands_agent",
  description: "CopilotKit AWS Strands TypeScript starter agent",
  config,
});
