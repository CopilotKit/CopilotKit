import { BuiltInAgent, convertInputToTanStackAI } from "@copilotkit/runtime/v2";
import { EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { chat, toolDefinition } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
import { z } from "zod";
import { jsonSchemaToZod } from "./tanstack-factory";
// Custom fetch that injects ALS-bound inbound x-* headers (e.g.
// x-aimock-context) onto every outbound OpenAI call. Required so aimock
// can match fixtures by integration context. See ../header-forwarding.ts
// for the full rationale; mirrors the Mastra precedent.
import { forwardingFetch } from "../header-forwarding";

// ─── Constants ──────────────────────────────────────────────────────

// Catalog + surface ids MUST match what the frontend registers. The
// beautiful-chat page registers its A2UI catalog with catalogId
// "copilotkit://app-dashboard-catalog" (see
// src/app/demos/beautiful-chat/declarative-generative-ui/renderers.tsx) and
// the runtime's `a2ui.defaultCatalogId` is pinned to the same value in the
// route. Fixed-schema flight cards render onto their own surface.
const CATALOG_ID = "copilotkit://app-dashboard-catalog";
const FLIGHT_SURFACE_ID = "flight-search-results";
const A2UI_OPERATIONS_KEY = "a2ui_operations";

// ─── Data (query_data) ──────────────────────────────────────────────

// Financial sales data. Inlined as a TS const (mirrors a2ui-fixed-schema's
// inlined FLIGHT_SCHEMA) so it ships into the Next.js route bundle without
// runtime fs access — the LGP reference reads this from
// `beautiful_chat_data/db.csv` at module load. Values are kept as strings to
// match Python's `csv.DictReader` result shape (`query_data` returns the raw
// rows and the model derives chart data from them).
interface SalesRow {
  date: string;
  category: string;
  subcategory: string;
  amount: string;
  type: string;
  notes: string;
}

const SALES_DATA: SalesRow[] = [
  {
    date: "2026-01-05",
    category: "Revenue",
    subcategory: "Enterprise Subscriptions",
    amount: "28000",
    type: "income",
    notes: "3 new enterprise customers (Acme Corp, TechFlow, DataViz Inc)",
  },
  {
    date: "2026-01-05",
    category: "Revenue",
    subcategory: "Pro Tier Upgrades",
    amount: "18000",
    type: "income",
    notes: "24 users upgraded from free to pro",
  },
  {
    date: "2026-01-08",
    category: "Revenue",
    subcategory: "API Usage Overages",
    amount: "9500",
    type: "income",
    notes: "High API usage from top 5 customers",
  },
  {
    date: "2026-01-10",
    category: "Expenses",
    subcategory: "Engineering Salaries",
    amount: "42000",
    type: "expense",
    notes: "7 engineers + 2 contractors",
  },
  {
    date: "2026-01-10",
    category: "Expenses",
    subcategory: "Product Team",
    amount: "18000",
    type: "expense",
    notes: "PM and 2 designers",
  },
  {
    date: "2026-01-12",
    category: "Expenses",
    subcategory: "AWS Infrastructure",
    amount: "8200",
    type: "expense",
    notes: "Increased compute for new AI features",
  },
  {
    date: "2026-01-15",
    category: "Expenses",
    subcategory: "Marketing - Paid Ads",
    amount: "12000",
    type: "expense",
    notes: "Google Ads and LinkedIn campaigns",
  },
  {
    date: "2026-01-18",
    category: "Revenue",
    subcategory: "Consulting Services",
    amount: "14500",
    type: "income",
    notes: "Custom integration for Acme Corp",
  },
  {
    date: "2026-01-20",
    category: "Expenses",
    subcategory: "Customer Success",
    amount: "15000",
    type: "expense",
    notes: "3 CSMs + support tools (Intercom)",
  },
  {
    date: "2026-01-22",
    category: "Expenses",
    subcategory: "AI Model Costs",
    amount: "4200",
    type: "expense",
    notes: "OpenAI API usage for product features",
  },
  {
    date: "2026-01-25",
    category: "Revenue",
    subcategory: "Marketplace Sales",
    amount: "12800",
    type: "income",
    notes: "Template and plugin sales",
  },
  {
    date: "2026-01-28",
    category: "Expenses",
    subcategory: "Office & Equipment",
    amount: "3500",
    type: "expense",
    notes: "New laptops and coworking spaces",
  },
  {
    date: "2026-02-03",
    category: "Revenue",
    subcategory: "Enterprise Subscriptions",
    amount: "31000",
    type: "income",
    notes: "2 new customers + expansion from TechFlow",
  },
  {
    date: "2026-02-03",
    category: "Revenue",
    subcategory: "Pro Tier Upgrades",
    amount: "22500",
    type: "income",
    notes: "31 upgrades + reduced churn",
  },
  {
    date: "2026-02-05",
    category: "Revenue",
    subcategory: "API Usage Overages",
    amount: "11800",
    type: "income",
    notes: "DataViz Inc heavy API usage spike",
  },
  {
    date: "2026-02-07",
    category: "Expenses",
    subcategory: "Engineering Salaries",
    amount: "42000",
    type: "expense",
    notes: "Same headcount as January",
  },
  {
    date: "2026-02-07",
    category: "Expenses",
    subcategory: "Product Team",
    amount: "18000",
    type: "expense",
    notes: "No changes to product team",
  },
  {
    date: "2026-02-10",
    category: "Expenses",
    subcategory: "AWS Infrastructure",
    amount: "9500",
    type: "expense",
    notes: "Traffic spike from viral social post",
  },
  {
    date: "2026-02-12",
    category: "Expenses",
    subcategory: "Marketing - Paid Ads",
    amount: "15000",
    type: "expense",
    notes: "Increased ad spend for Q1 push",
  },
  {
    date: "2026-02-14",
    category: "Revenue",
    subcategory: "Consulting Services",
    amount: "18000",
    type: "income",
    notes: "2 custom projects (TechFlow + new client)",
  },
  {
    date: "2026-02-18",
    category: "Expenses",
    subcategory: "Customer Success",
    amount: "16500",
    type: "expense",
    notes: "Hired 1 additional CSM",
  },
  {
    date: "2026-02-20",
    category: "Expenses",
    subcategory: "AI Model Costs",
    amount: "5800",
    type: "expense",
    notes: "Increased usage from new AI features launch",
  },
  {
    date: "2026-02-22",
    category: "Revenue",
    subcategory: "Marketplace Sales",
    amount: "14200",
    type: "income",
    notes: "Top template hit featured list",
  },
  {
    date: "2026-02-25",
    category: "Expenses",
    subcategory: "Conference & Travel",
    amount: "4500",
    type: "expense",
    notes: "Team attended SaaS Conference 2026",
  },
  {
    date: "2026-02-27",
    category: "Revenue",
    subcategory: "Partnership Revenue",
    amount: "11500",
    type: "income",
    notes: "Referral fees from integration partners",
  },
  {
    date: "2026-03-02",
    category: "Revenue",
    subcategory: "Enterprise Subscriptions",
    amount: "35000",
    type: "income",
    notes: "Major win: Fortune 500 customer signed",
  },
  {
    date: "2026-03-02",
    category: "Revenue",
    subcategory: "Pro Tier Upgrades",
    amount: "26000",
    type: "income",
    notes: "42 upgrades - best month yet",
  },
  {
    date: "2026-03-05",
    category: "Revenue",
    subcategory: "API Usage Overages",
    amount: "13200",
    type: "income",
    notes: "Consistent high usage across top tier",
  },
  {
    date: "2026-03-08",
    category: "Expenses",
    subcategory: "Engineering Salaries",
    amount: "48000",
    type: "expense",
    notes: "Hired 1 senior engineer for AI team",
  },
  {
    date: "2026-03-08",
    category: "Expenses",
    subcategory: "Product Team",
    amount: "21000",
    type: "expense",
    notes: "Promoted designer to senior level",
  },
  {
    date: "2026-03-10",
    category: "Expenses",
    subcategory: "AWS Infrastructure",
    amount: "11000",
    type: "expense",
    notes: "Scaled infrastructure for enterprise client",
  },
  {
    date: "2026-03-12",
    category: "Expenses",
    subcategory: "Marketing - Paid Ads",
    amount: "18000",
    type: "expense",
    notes: "Doubled down on successful campaigns",
  },
  {
    date: "2026-03-14",
    category: "Revenue",
    subcategory: "Consulting Services",
    amount: "21500",
    type: "income",
    notes: "Fortune 500 onboarding + 2 other projects",
  },
  {
    date: "2026-03-16",
    category: "Expenses",
    subcategory: "Customer Success",
    amount: "19500",
    type: "expense",
    notes: "Hired dedicated enterprise CSM",
  },
  {
    date: "2026-03-18",
    category: "Expenses",
    subcategory: "AI Model Costs",
    amount: "7200",
    type: "expense",
    notes: "Fortune 500 client heavy AI usage",
  },
  {
    date: "2026-03-20",
    category: "Revenue",
    subcategory: "Marketplace Sales",
    amount: "15800",
    type: "income",
    notes: "3 new templates in top 10",
  },
  {
    date: "2026-03-22",
    category: "Expenses",
    subcategory: "Sales & BD",
    amount: "12000",
    type: "expense",
    notes: "Hired first sales rep for enterprise",
  },
  {
    date: "2026-03-24",
    category: "Revenue",
    subcategory: "Partnership Revenue",
    amount: "14200",
    type: "income",
    notes: "New integration partnerships launched",
  },
  {
    date: "2026-03-26",
    category: "Expenses",
    subcategory: "Security & Compliance",
    amount: "6500",
    type: "expense",
    notes: "SOC 2 audit and security tools",
  },
  {
    date: "2026-03-28",
    category: "Revenue",
    subcategory: "Training & Workshops",
    amount: "10200",
    type: "income",
    notes: "Conducted 2 customer training sessions",
  },
];

// ─── Todo state ─────────────────────────────────────────────────────

// Mirrors LGP's `Todo` TypedDict. The frontend (todo-list.tsx) reads exactly
// these fields off `agent.state.todos`.
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
  status: z.enum(["pending", "completed"]),
});

// ─── A2UI operation helpers (mirror a2ui.render / create_surface /
//     update_components from the Python SDK) ─────────────────────────

function createSurfaceOp(surfaceId: string, catalogId: string) {
  return { version: "v0.9", createSurface: { surfaceId, catalogId } };
}

function updateComponentsOp(surfaceId: string, components: unknown[]) {
  return { version: "v0.9", updateComponents: { surfaceId, components } };
}

function renderA2uiOperations(operations: unknown[]) {
  return { [A2UI_OPERATIONS_KEY]: operations };
}

// Flight card props — all optional so the model can omit auxiliary fields
// (e.g. statusColor) without tripping tool-arg validation. Mirrors LGP's
// `Flight` TypedDict (total=False).
const flightSchema = z.object({
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
type Flight = z.infer<typeof flightSchema>;

/**
 * Build a flat A2UI component tree with one literal FlightCard per flight.
 *
 * Mirrors LGP's `_build_flight_components`: inline the values per-flight so we
 * avoid the structural-children template form (Row.children = { componentId,
 * path }), which only expands for STRUCTURAL-children schemas. The frontend
 * FlightCard renderer resolves these literal props directly.
 */
function buildFlightComponents(flights: Flight[]): unknown[] {
  const cardIds: string[] = [];
  const components: unknown[] = [];
  flights.forEach((flight, index) => {
    const id = `flight-card-${index}`;
    cardIds.push(id);
    components.push({
      id,
      component: "FlightCard",
      airline: flight.airline ?? "",
      airlineLogo: flight.airlineLogo ?? "",
      flightNumber: flight.flightNumber ?? "",
      origin: flight.origin ?? "",
      destination: flight.destination ?? "",
      date: flight.date ?? "",
      departureTime: flight.departureTime ?? "",
      arrivalTime: flight.arrivalTime ?? "",
      duration: flight.duration ?? "",
      status: flight.status ?? "",
      price: flight.price ?? "",
    });
  });
  const root = { id: "root", component: "Row", children: cardIds, gap: 16 };
  return [root, ...components];
}

// ─── System prompt (ported from beautiful_chat.py) ──────────────────

const SYSTEM_PROMPT = `\
You are a polished, professional demo assistant. Keep responses to 1-2 sentences.

Tool guidance:
- Charts: call \`query_data\` FIRST to fetch the data, then render it with the
  \`pieChart\` or \`barChart\` component (part-of-whole → pieChart; comparison
  across categories → barChart).
- Dashboards & rich UI: call \`render_a2ui\` to create dashboard UIs with
  metrics, charts, tables, and cards. It handles rendering automatically. Call
  \`query_data\` first when the dashboard should reflect real data.
- Flights: call \`search_flights\` to show flight cards with a pre-built schema.
  Return exactly 2 flights.
- Sandboxed apps (calculators, mini-tools): call \`generateSandboxedUi\`.
- Diagrams: use the Excalidraw MCP tool (\`create_view\`) to draw diagrams.
- Scheduling: call \`scheduleTime\` (human-in-the-loop) so the user can pick a time.
- Theme: call \`toggleTheme\` to switch light/dark.
- Todos: call \`enableAppMode\` first, then \`manage_todos\` to create/update the
  task board; use \`get_todos\` to read the current list.
- A2UI actions: when you see a log_a2ui_event result (e.g. "view_details"),
  respond with a brief confirmation. The UI already updated on the frontend.`;

// Server-tool names owned by this agent — used to filter them out of the
// frontend/injected tool declarations below so they are not double-declared.
const SERVER_TOOL_NAMES = new Set([
  "query_data",
  "manage_todos",
  "get_todos",
  "search_flights",
]);

// ─── Server tools ───────────────────────────────────────────────────

/**
 * Build the beautiful-chat server tools per-request so `get_todos` can close
 * over the inbound frontend state (`input.state.todos`) — the built-in agent
 * has no persistent per-agent state schema, so the current todo list arrives
 * on each run via AG-UI state (the frontend calls `agent.setState`).
 */
function buildServerTools(input: RunAgentInput) {
  const queryData = toolDefinition({
    name: "query_data",
    description:
      "Query the database, takes natural language. Always call before " +
      "showing a chart or graph.",
    inputSchema: z.object({
      query: z
        .string()
        .describe("Natural-language description of the data to fetch"),
    }),
  }).server(async () => SALES_DATA);

  const manageTodos = toolDefinition({
    name: "manage_todos",
    description: "Manage the current todos. Pass the FULL updated list.",
    inputSchema: z.object({
      todos: z.array(todoSchema),
    }),
  }).server(async ({ todos }) => {
    // Ensure every todo has a stable unique id (mirrors LGP).
    const withIds: Todo[] = todos.map((t) => ({
      ...t,
      id: t.id && t.id.length > 0 ? t.id : crypto.randomUUID(),
    }));
    // Return `{ todos }` — the converter detects `manage_todos` results and
    // emits a STATE_DELTA that populates `/todos` on the agent state, which
    // the frontend `useAgent` subscriber renders in the todo board.
    return { todos: withIds };
  });

  const getTodos = toolDefinition({
    name: "get_todos",
    description: "Get the current todos.",
    inputSchema: z.object({}),
  }).server(async () => {
    const state = input.state as { todos?: Todo[] } | undefined;
    return state?.todos ?? [];
  });

  const searchFlights = toolDefinition({
    name: "search_flights",
    description:
      "Search for flights and display the results as rich cards. Return " +
      'exactly 2 flights. Each flight must have: airline (e.g. "United ' +
      'Airlines"), airlineLogo (use the Google favicon API: ' +
      "https://www.google.com/s2/favicons?domain={airline_domain}&sz=128 — " +
      'e.g. "https://www.google.com/s2/favicons?domain=united.com&sz=128"), ' +
      "flightNumber, origin, destination, date (short readable format like " +
      '"Tue, Mar 18"), departureTime, arrivalTime, duration (e.g. "4h 25m"), ' +
      'status (e.g. "On Time" or "Delayed"), and price (e.g. "$289").',
    inputSchema: z.object({
      flights: z.array(flightSchema),
    }),
  }).server(async ({ flights }) =>
    // Returns an `a2ui_operations` container directly. The runtime's A2UI
    // middleware detects this shape in the tool result and forwards the
    // operations to the frontend renderer (parity with LGP's
    // `a2ui.render(...)`). `injectA2UITool: true` on the route does NOT affect
    // this — it only controls whether the middleware also injects its own
    // dynamic `generate_a2ui` tool.
    renderA2uiOperations([
      createSurfaceOp(FLIGHT_SURFACE_ID, CATALOG_ID),
      updateComponentsOp(FLIGHT_SURFACE_ID, buildFlightComponents(flights)),
    ]),
  );

  return [queryData, manageTodos, getTodos, searchFlights];
}

// ─── TanStack → AG-UI stream converter ──────────────────────────────

function randomUUID(): string {
  return crypto.randomUUID();
}

/**
 * Convert a TanStack AI stream to AG-UI events for the beautiful-chat agent.
 *
 * Same shape as the base built-in agent's converter (multi-turn safe: does NOT
 * stop after the first RUN_FINISHED, dedupes re-emitted tool-call chunks) plus
 * one beautiful-chat-specific behaviour: a `manage_todos` tool result is
 * translated into a STATE_DELTA on `/todos` so the frontend todo board updates
 * (mirrors LGP's StateStreamingMiddleware for the `todos` state key).
 */
async function* convertStream(
  stream: AsyncIterable<unknown>,
  abortSignal: AbortSignal,
): AsyncGenerator<BaseEvent> {
  const messageId = randomUUID();
  const completedToolCalls = new Set<string>();
  const toolNamesById = new Map<string, string>();

  for await (const chunk of stream) {
    if (abortSignal.aborted) break;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = chunk as any;
    const type = raw.type as string;

    if (type === "RUN_FINISHED") continue;

    if (type === "TEXT_MESSAGE_CONTENT" && raw.delta != null) {
      yield {
        type: EventType.TEXT_MESSAGE_CHUNK,
        role: "assistant",
        messageId,
        delta: raw.delta as string,
      };
    } else if (type === "TOOL_CALL_START") {
      const toolCallId = raw.toolCallId as string;
      if (completedToolCalls.has(toolCallId)) continue;
      toolNamesById.set(toolCallId, raw.toolCallName as string);
      yield {
        type: EventType.TOOL_CALL_START,
        parentMessageId: messageId,
        toolCallId,
        toolCallName: raw.toolCallName as string,
      };
    } else if (type === "TOOL_CALL_ARGS") {
      const toolCallId = raw.toolCallId as string;
      if (completedToolCalls.has(toolCallId)) continue;
      yield {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId,
        delta: raw.delta as string,
      };
    } else if (type === "TOOL_CALL_END") {
      const toolCallId = raw.toolCallId as string;
      if (completedToolCalls.has(toolCallId)) continue;
      completedToolCalls.add(toolCallId);
      yield { type: EventType.TOOL_CALL_END, toolCallId };
    } else if (type === "TOOL_CALL_RESULT") {
      const toolCallId = raw.toolCallId as string;
      const toolName = toolNamesById.get(toolCallId);
      const rawPayload = raw.content ?? raw.result;
      const parsedContent =
        typeof rawPayload === "string" ? safeParseJSON(rawPayload) : rawPayload;

      // `manage_todos` → STATE_DELTA on `/todos`. Use RFC-6902 `add` (not
      // `replace`): the agent's initial state may be `{}` with no preceding
      // STATE_SNAPSHOT, and `fast-json-patch` strict mode rejects `replace` on
      // an unresolvable path. `add` creates `/todos` on first emission and
      // overwrites idempotently afterwards.
      if (
        toolName === "manage_todos" &&
        parsedContent &&
        typeof parsedContent === "object" &&
        "todos" in parsedContent
      ) {
        yield {
          type: EventType.STATE_DELTA,
          delta: [
            {
              op: "add",
              path: "/todos",
              value: (parsedContent as { todos: unknown }).todos,
            },
          ],
        };
      }

      let serializedContent: string;
      if (typeof rawPayload === "string") {
        serializedContent = rawPayload;
      } else {
        try {
          serializedContent = JSON.stringify(rawPayload ?? null);
        } catch {
          serializedContent = "[Unserializable tool result]";
        }
      }

      yield {
        type: EventType.TOOL_CALL_RESULT,
        role: "tool",
        messageId: randomUUID(),
        toolCallId,
        content: serializedContent,
      };
    }
  }
}

function safeParseJSON(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// ─── Agent ──────────────────────────────────────────────────────────

/**
 * Built-in (TanStack) agent backing the Beautiful Chat flagship showcase cell.
 *
 * Faithful port of `beautiful_chat.py`. Owns four server tools (query_data,
 * manage_todos, get_todos, search_flights) and declares — declaration-only —
 * every frontend tool AND every runtime-injected tool it receives on
 * `input.tools`:
 *   - frontend: pieChart, barChart, scheduleTime, toggleTheme, enableAppMode,
 *     enableChatMode
 *   - runtime-injected: render_a2ui (A2UI middleware, injectA2UITool: true —
 *     the default injected tool name), generateSandboxedUi (Open Generative
 *     UI), and the Excalidraw MCP tools (MCP Apps middleware)
 * The respective middleware executes the injected tools; declaring them here
 * is what lets the model actually CALL them (otherwise it replies with plain
 * text / raw code blocks and nothing renders).
 *
 * Uses `type: "custom"` so the multi-turn agent loop survives (server tool →
 * result → follow-up model turn); the runtime's built-in tanstack converter
 * halts after the first RUN_FINISHED and would break query_data→chart chains.
 */
export function createBeautifulChatAgent() {
  return new BuiltInAgent({
    type: "custom",
    factory: ({ input, abortController }) => {
      const { messages, systemPrompts } = convertInputToTanStackAI(input);

      const serverTools = buildServerTools(input);

      // Declare frontend + runtime-injected tools (declaration-only, no
      // executor) so the model can call them. Skip any that collide with our
      // server tools.
      const declaredTools = (input.tools ?? [])
        .filter((t) => !SERVER_TOOL_NAMES.has(t.name))
        .map((t) =>
          toolDefinition({
            name: t.name,
            description: t.description ?? "",
            inputSchema: jsonSchemaToZod(t.parameters),
          }),
        );

      const stream = chat({
        adapter: openaiText("gpt-5.4", { fetch: forwardingFetch }),
        messages,
        systemPrompts: [SYSTEM_PROMPT, ...systemPrompts],
        tools: [...serverTools, ...declaredTools],
        abortController,
      });

      return convertStream(stream, abortController.signal);
    },
  });
}
