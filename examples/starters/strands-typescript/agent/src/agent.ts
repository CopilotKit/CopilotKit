import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { StrandsAgent } from "@ag-ui/aws-strands";
import type {
  StatePayload,
  StrandsAgentConfig,
  ToolCallContext,
} from "@ag-ui/aws-strands";
import type { RunAgentInput } from "@ag-ui/core";
import { Agent, tool } from "@strands-agents/sdk";
import { parse } from "csv-parse/sync";
import dotenv from "dotenv";
import { z } from "zod";

// Flight data, rendered as generative UI with render_ui
import { searchFlights } from "./flights.js";
import { forwardingFetch } from "./header-forwarding.js";
import { createStrandsModel, resolveAgentModel } from "./model.js";

const agentDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(agentDir, "../../.env") });
dotenv.config();

const AIMOCK_CONTEXT = "strands-typescript";

const SYSTEM_PROMPT = `You are a polished, professional demo assistant. Keep responses to 1-2 sentences.

Tool guidance:

- Flights: call search_flights, then show the flights with render_ui as a Row
  of FlightCard components.
- Dashboards & rich UI: call render_ui to build dashboards with metrics, charts,
  tables, and cards from the generative UI catalog.
- Charts: call query_data first, then render with the chart component.
- Todos: enable app mode first, then manage todos.
- Generative UI actions: a click on a button you rendered (e.g. selecting a
  flight) arrives as a user message. Respond with a brief confirmation.`;

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

/**
 * Render the run's AG-UI `context` for the prompt.
 *
 * The context carries what the page shares (`useAgentContext`) and the
 * runtime's generative UI guide, which tells the model how to call
 * `render_ui`. `@ag-ui/aws-strands` passes a run's AG-UI `context` to hooks
 * only and does not add it to the prompt itself, so without this the model
 * never sees it.
 */
function pageContextText(input: RunAgentInput): string {
  const entries = input.context ?? [];
  if (entries.length === 0) return "";
  const shared = entries
    .map(({ description, value }) => `${description}:\n${value}`)
    .join("\n\n");
  return `Context provided by the application:\n\n${shared}`;
}

function buildStatePrompt(input: RunAgentInput, prompt: string): string {
  const state = (input.state ?? {}) as StarterState;
  const request = state.todos
    ? `Current todos list:\n${JSON.stringify(state.todos, null, 2)}\n\nUser request: ${prompt}`
    : prompt;
  const context = pageContextText(input);
  return context ? `${context}\n\n${request}` : request;
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

// COPILOTKIT_AGENT_MODEL (e.g. "anthropic:claude-sonnet-4-5") picks the model;
// unset, it uses MODEL_ID or gpt-6-luna on OpenAI.
const agentModel = resolveAgentModel();
const clientExtras = {
  defaultHeaders: { "x-aimock-context": AIMOCK_CONTEXT },
  fetch: forwardingFetch,
};

const model = createStrandsModel(agentModel, clientExtras);

const config: StrandsAgentConfig = {
  stateContextBuilder: buildStatePrompt,
  toolBehaviors: {
    manage_todos: { stateFromArgs: todosStateFromArgs },
  },
};

const strandsAgent = new Agent({
  model,
  systemPrompt: SYSTEM_PROMPT,
  tools: [manageTodos, getTodos, queryData, searchFlights],
});

export const agent = new StrandsAgent({
  agent: strandsAgent,
  name: "strands_agent",
  description: "CopilotKit AWS Strands TypeScript starter agent",
  config,
});
