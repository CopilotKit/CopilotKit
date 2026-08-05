// @region[backend-render-operations]
// @region[weather-tool-backend]
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
// Use the header-forwarding `openai` so backend tool LLM calls (e.g.
// generateText inside generateA2ui) carry the inbound aimock context
// headers. See `_header_forwarding.ts`.
import { openai } from "@/mastra/_header_forwarding";
import { generateText, tool as aiTool } from "ai";
import {
  getWeatherImpl,
  queryDataImpl,
  scheduleMeetingImpl,
  searchFlightsImpl,
  generateA2uiImpl,
  buildA2uiOperationsFromToolCall,
} from "@copilotkit/showcase-shared-tools";

// `manage_todos` writes the todo list into working memory so the Beautiful
// Chat app-mode canvas (which reads `agent.state.todos`) renders it; `get_todos`
// reads it back. See working-memory.ts / OSS-452.
import {
  writeTodosToWorkingMemory,
  readTodosFromWorkingMemory,
} from "./working-memory";
// Grounds the dynamic `generate_a2ui` render on the catalog schema the bridge
// forwards onto Mastra's request context (the outer model sends it empty).
import { readForwardedA2uiContext } from "./a2ui-context";

// Re-export the dedicated tool sets defined in their own modules so the
// barrel keeps a single import surface for callers under `@/mastra/tools`.
export { setNotesTool } from "./shared-state-read-write";
export { setStepsTool } from "./gen-ui-agent";
export { scheduleMeetingInterruptTool } from "./interrupt";
export { browseWebTool } from "./browse-web";
export { runDeepResearchTool } from "./background-research";
export {
  researchAgentTool,
  writingAgentTool,
  critiqueAgentTool,
} from "./subagents";

export const weatherTool = createTool({
  id: "get_weather",
  description: "Get current weather for a location",
  inputSchema: z.object({
    location: z.string().describe("City name"),
    temperature: z
      .number()
      .optional()
      .describe(
        "Optional scripted temperature (°F); echoed back when provided",
      ),
    conditions: z
      .string()
      .optional()
      .describe("Optional scripted conditions; echoed back when provided"),
    humidity: z
      .number()
      .optional()
      .describe("Optional scripted humidity; echoed back when provided"),
    wind_speed: z
      .number()
      .optional()
      .describe("Optional scripted wind speed; echoed back when provided"),
  }),
  // Optional temperature/conditions/humidity/wind_speed let an aimock fixture
  // script a deterministic snapshot (mirrors get_stock_price's scripted
  // price_usd — e.g. headless-complete pins Tokyo to a fixed "Sunny / 68°F"
  // card matching gold langgraph-python). When omitted, the seeded
  // getWeatherImpl(location) values are used (e.g. tool-rendering's SF pill).
  //
  // Return the OBJECT, not JSON.stringify: the @ag-ui/mastra bridge encodes the
  // tool result exactly once on the way to the frontend, so stringifying here
  // double-encodes it and the typed cards' single-parse (parseJsonResult) reads
  // back a string with undefined fields ("--%"). Single-encode by returning the
  // object (same rule as browse_web / the Mastra capability-map memory).
  execute: async ({
    location,
    temperature,
    conditions,
    humidity,
    wind_speed,
  }) => ({
    ...getWeatherImpl(location),
    ...(typeof temperature === "number" ? { temperature } : {}),
    ...(conditions ? { conditions } : {}),
    ...(typeof humidity === "number" ? { humidity } : {}),
    ...(typeof wind_speed === "number" ? { wind_speed } : {}),
  }),
});
// @endregion[weather-tool-backend]

// Mock stock-price tool used by the headless-complete demo to exercise the
// manual `useRenderTool` path alongside `get_weather`. Returns a fixed
// payload so the StockCard renders deterministically without a real market
// data API.
export const stockPriceTool = createTool({
  id: "get-stock-price",
  description: "Get a mock current price for a stock ticker",
  inputSchema: z.object({
    ticker: z.string().describe("Stock ticker symbol, e.g. AAPL"),
    price_usd: z
      .number()
      .optional()
      .describe("Optional scripted price; echoed back verbatim when provided"),
    change_pct: z
      .number()
      .optional()
      .describe(
        "Optional scripted percentage change; echoed back verbatim when provided",
      ),
  }),
  // Optional price_usd / change_pct let the LLM (or an aimock fixture) script a
  // deterministic quote — mirrors gold tool_rendering_agent.py get_stock_price.
  // When omitted, fall back to the fixed mock values. Object (single-encode) —
  // see weatherTool.
  execute: async ({ ticker: rawTicker, price_usd, change_pct }) => {
    const ticker = (rawTicker ?? "").toUpperCase();
    return {
      ticker,
      price_usd: typeof price_usd === "number" ? price_usd : 189.42,
      change_pct: typeof change_pct === "number" ? change_pct : 1.27,
    };
  },
});

// Mock six-month revenue series for the headless-complete ChartCard. Mirrors
// the langgraph-python `get_revenue_chart` tool (headless_complete.py) — returns
// a title/subtitle + {label,value} points. Object (single-encode) — see
// weatherTool; the ChartCard/useRenderTool reads { title, subtitle, data }.
export const revenueChartTool = createTool({
  id: "get-revenue-chart",
  description:
    "Get a mock six-month revenue series for a chart visualization. Use whenever the user asks for a chart, graph, or visualization of revenue, sales, or other quarterly/monthly metrics.",
  inputSchema: z.object({}),
  execute: async () => ({
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
});

// Mock dice-roll tool used by the tool-rendering-reasoning-chain demo. Mirrors
// the langgraph-python `roll_dice` tool so the shared aimock fixtures can
// script a deterministic d20 → d6 chain. Rendered by the catch-all renderer.
export const rollDiceTool = createTool({
  id: "roll-dice",
  description: "Roll a single die with the given number of sides",
  inputSchema: z.object({
    sides: z
      .number()
      .optional()
      .describe("Number of sides on the die (default 6)"),
  }),
  execute: async ({ sides }) => {
    const s = typeof sides === "number" && sides > 1 ? Math.floor(sides) : 6;
    // Return an object (single-encode) — see weatherTool. The catchall
    // renderers (default/custom/reasoning-chain) JSON.parse once, so this also
    // renders cleanly there instead of an escaped double-encoded string.
    return {
      sides: s,
      result: Math.floor(Math.random() * s) + 1,
    };
  },
});

// Deterministic 20-sided die used by the tool-rendering demo. Mirrors gold
// tool_rendering_agent.py roll_d20: the optional `value` lets an aimock fixture
// script the exact roll (1-20) the e2e sequence asserts; otherwise a random
// natural roll. Object (single-encode) — see weatherTool.
export const rollD20Tool = createTool({
  id: "roll_d20",
  description: "Roll a 20-sided die",
  inputSchema: z.object({
    value: z
      .number()
      .optional()
      .describe(
        "Optional scripted roll (1-20); echoed back verbatim when provided",
      ),
  }),
  execute: async ({ value }) => {
    const rolled =
      typeof value === "number" && value >= 1 && value <= 20
        ? Math.floor(value)
        : Math.floor(Math.random() * 20) + 1;
    return { sides: 20, value: rolled, result: rolled };
  },
});

export const queryDataTool = createTool({
  id: "query-data",
  description: "Query financial database for chart data",
  inputSchema: z.object({
    query: z.string().describe("Natural language query"),
  }),
  // Return the object (single-encode) — see weatherTool.
  execute: async ({ query }) => queryDataImpl(query),
});

// Beautiful Chat task-manager tools. Ports langgraph-python's
// `manage_todos` / `get_todos` (src/agents/beautiful_chat.py) — the shared
// beautiful-chat frontend reads `agent.state.todos` (shape
// {id,title,description,emoji,status}) and the north-star uses these exact tool
// names. `manage_todos` WRITES the list into working memory so the @ag-ui/mastra
// adapter emits a STATE_SNAPSHOT and the app-mode canvas renders it — returning
// the JSON alone leaves the data only in the tool result, which never reaches
// agent state (OSS-452). Mastra previously shipped a mismatched sales-CRM tool
// (`manage_sales_todos`, shape {stage,value,completed}) that the frontend could
// not render and the recorded fixtures did not call.
const todoItemSchema = z.object({
  id: z.string().optional(),
  title: z.string(),
  description: z.string().optional(),
  emoji: z.string().optional(),
  status: z.enum(["pending", "completed"]).optional(),
});

/** Fill missing ids and default the frontend-required fields. */
function normalizeTodos(
  todos: Array<z.infer<typeof todoItemSchema>>,
): Array<Record<string, unknown>> {
  return todos.map((t, i) => ({
    id: t.id && t.id.length > 0 ? t.id : `todo-${Date.now()}-${i}`,
    title: t.title,
    description: t.description ?? "",
    emoji: t.emoji ?? "📝",
    status: t.status ?? "pending",
  }));
}

export const manageTodosTool = createTool({
  id: "manage_todos",
  description:
    "Create or update the task-manager todo list. Pass the FULL updated list " +
    "of todos; each todo has a title and optionally a description, emoji, and " +
    "status ('pending' or 'completed').",
  inputSchema: z.object({
    todos: z.array(todoItemSchema).describe("Full updated todo list"),
  }),
  execute: async (inputData, executionContext) => {
    const todos = normalizeTodos(inputData.todos ?? []);
    await writeTodosToWorkingMemory(executionContext, todos);
    return JSON.stringify({ todos, updated: true as const });
  },
});

export const getTodosTool = createTool({
  id: "get_todos",
  description: "Get the current task-manager todo list.",
  inputSchema: z.object({}),
  execute: async (_inputData, executionContext) => {
    const todos = await readTodosFromWorkingMemory(executionContext);
    return JSON.stringify({ todos });
  },
});

export const scheduleMeetingTool = createTool({
  id: "schedule-meeting",
  description: "Schedule a meeting (requires user approval via HITL)",
  inputSchema: z.object({
    reason: z.string().describe("Reason for the meeting"),
    durationMinutes: z.number().optional().describe("Duration in minutes"),
  }),
  execute: async ({ reason, durationMinutes }) =>
    JSON.stringify(scheduleMeetingImpl(reason, durationMinutes)),
});

export const searchFlightsTool = createTool({
  id: "search-flights",
  description: "Search for available flights from an origin to a destination",
  // Gold parity (tool_rendering_agent.py search_flights): accept `origin` +
  // `destination` and GENERATE a deterministic flights list rather than having
  // the caller pass the flights array. Returns mastra-shaped flight objects so
  // the existing flight-list renderer is unchanged. Object (single-encode) —
  // see weatherTool.
  inputSchema: z.object({
    origin: z.string().optional().describe("Origin airport or city"),
    destination: z.string().optional().describe("Destination airport or city"),
    // Legacy shape: some D5 harness probes still pass a pre-built flights
    // array. Accept it so those keep rendering; the gold path below is the
    // origin/destination generator that tool-rendering + reasoning-chain use.
    flights: z
      .array(z.record(z.any()))
      .optional()
      .describe("Pre-built flight list (legacy caller-supplied shape)"),
  }),
  execute: async ({ origin, destination, flights: provided }) => {
    if (Array.isArray(provided) && provided.length > 0) {
      // Legacy passthrough — caller already built the list.
      return searchFlightsImpl(provided as never);
    }
    const from = origin ?? "SFO";
    const to = destination ?? "JFK";
    const flights = [
      {
        airline: "United",
        airlineLogo:
          "https://www.google.com/s2/favicons?domain=united.com&sz=128",
        flightNumber: "UA231",
        origin: from,
        destination: to,
        date: "Tue, May 6",
        departureTime: "08:15",
        arrivalTime: "16:45",
        duration: "5h 30m",
        status: "On Time",
        statusColor: "#22c55e",
        price: "$348",
        currency: "USD",
      },
      {
        airline: "Delta",
        airlineLogo:
          "https://www.google.com/s2/favicons?domain=delta.com&sz=128",
        flightNumber: "DL412",
        origin: from,
        destination: to,
        date: "Tue, May 6",
        departureTime: "11:20",
        arrivalTime: "19:55",
        duration: "5h 35m",
        status: "On Time",
        statusColor: "#22c55e",
        price: "$312",
        currency: "USD",
      },
      {
        airline: "JetBlue",
        airlineLogo:
          "https://www.google.com/s2/favicons?domain=jetblue.com&sz=128",
        flightNumber: "B6722",
        origin: from,
        destination: to,
        date: "Tue, May 6",
        departureTime: "17:05",
        arrivalTime: "01:30",
        duration: "5h 25m",
        status: "On Time",
        statusColor: "#22c55e",
        price: "$289",
        currency: "USD",
      },
    ];
    return searchFlightsImpl(flights);
  },
});

// The `generate-a2ui` tool runs a secondary LLM call with a forced
// `render_a2ui` tool, then converts that tool call's args into the
// A2UI `a2ui_operations` container that the middleware forwards to
// the frontend renderer. Mastra returns the operations as a JSON
// string from the tool body; the catalog resolves component names to
// React renderers on the client.
export const generateA2uiTool = createTool({
  id: "generate-a2ui",
  description: "Generate dynamic A2UI surface components",
  inputSchema: z.object({
    messages: z.array(z.record(z.unknown())).describe("Chat messages"),
    contextEntries: z
      .array(z.record(z.unknown()))
      .optional()
      .describe("Context entries"),
  }),
  execute: async ({ messages, contextEntries }, executionContext) => {
    // The outer model leaves `contextEntries` empty — it has no basis to hand
    // the catalog schema back through a tool arg — so on a live LLM the inner
    // `render_a2ui` subagent would run with an EMPTY system prompt: ungrounded,
    // it emits invalid/misnamed components (or none), and the surface fails to
    // render, varying run to run. (aimock hides it: the recorded fixture
    // returns a valid envelope regardless of the empty context.) The bridge
    // already forwards the catalog schema + generation guidelines onto the
    // request context, so read them server-side and ground the render there
    // rather than trusting the model-supplied arg.
    const forwardedContext = readForwardedA2uiContext(executionContext);
    const prep = generateA2uiImpl({
      messages,
      contextEntries:
        forwardedContext.length > 0 ? forwardedContext : contextEntries,
    });

    // Normalize each incoming message role to the `user`/`assistant` pair
    // `generateText` accepts here. An unsound `as "user" | "assistant"` cast
    // would let a `system`/`tool` role slip through mis-typed (the `??` only
    // guards null/undefined), so map explicitly: anything that is not
    // `assistant` collapses to `user`.
    const toRole = (role: unknown): "user" | "assistant" =>
      role === "assistant" ? "assistant" : "user";

    const result = await generateText({
      model: openai("gpt-4.1"),
      system: prep.systemPrompt,
      messages: prep.messages.map((m) => ({
        role: toRole(m.role),
        content: (m.content as string) ?? "",
      })),
      tools: {
        render_a2ui: aiTool({
          description: "Render a dynamic A2UI v0.9 surface.",
          // AI SDK v5 renamed the tool schema key from `parameters` to
          // `inputSchema`; under v5 a `parameters` key is ignored, so the
          // render_a2ui schema would never reach the model.
          inputSchema: z.object({
            surfaceId: z.string().describe("Unique surface identifier."),
            catalogId: z.string().describe("The catalog ID."),
            components: z
              .array(z.record(z.unknown()))
              .describe("A2UI v0.9 component array."),
            data: z
              .record(z.unknown())
              .optional()
              .describe("Optional initial data model."),
          }),
        }),
      },
      toolChoice: { type: "tool", toolName: "render_a2ui" },
    });

    const toolCall = result.toolCalls?.[0];
    if (!toolCall) {
      // The forced `render_a2ui` tool was not called, so there are no
      // operations to forward. Returning a `{ error }` JSON string would look
      // like a successful tool result to the frontend/runtime, which cannot
      // then distinguish it from a real A2UI payload. Throw instead so the
      // Mastra runtime surfaces this as a genuine tool error.
      const message = "generate-a2ui: LLM did not call render_a2ui";
      console.error(message, { finishReason: result.finishReason });
      throw new Error(message);
    }

    // AI SDK v5 renamed the typed tool-call arguments from `.args` to
    // `.input` (the `ai` v4 shape was `toolCall.args`). Read `.input` so the
    // a2ui builder gets the render_a2ui arguments instead of `undefined`.
    return JSON.stringify(
      buildA2uiOperationsFromToolCall(
        toolCall.input as Record<string, unknown>,
      ),
    );
  },
});
// @endregion[backend-render-operations]

// @region[beautiful-chat-fixed-flights]
// Fixed-schema A2UI flight search for the Beautiful Chat cell. Mirrors
// langgraph-python `beautiful_chat.py::search_flights`: the tool RESULT is a
// complete `a2ui_operations` envelope (a flat Row of literal FlightCards on the
// `app-dashboard-catalog`), so the A2UI middleware paints the cards directly —
// no dynamic `generate_a2ui` round-trip. Distinct from the shared
// `searchFlightsTool` (plain `{ flights }`) that the tool-rendering cells render
// via their own frontend `FlightListCard`.
const FLIGHT_SURFACE_ID = "flight-search-results";
const FLIGHT_CATALOG_ID = "copilotkit://app-dashboard-catalog";

// Flat tree: one literal FlightCard per flight + a Row referencing them by id.
// Inlining the values (rather than the structural `Row.children = { componentId,
// path }` template) sidesteps the GenericBinder template path and renders
// identically — matches `beautiful_chat.py::_build_flight_components`.
function buildFlightCardComponents(
  flights: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const cardIds: string[] = [];
  const cards = flights.map((flight, index) => {
    const id = `flight-card-${index}`;
    cardIds.push(id);
    const str = (key: string) =>
      typeof flight[key] === "string" ? (flight[key] as string) : "";
    return {
      id,
      component: "FlightCard",
      airline: str("airline"),
      airlineLogo: str("airlineLogo"),
      flightNumber: str("flightNumber"),
      origin: str("origin"),
      destination: str("destination"),
      date: str("date"),
      departureTime: str("departureTime"),
      arrivalTime: str("arrivalTime"),
      duration: str("duration"),
      status: str("status"),
      price: str("price"),
    };
  });
  return [
    { id: "root", component: "Row", children: cardIds, gap: 16 },
    ...cards,
  ];
}

export const searchFlightsA2uiTool = createTool({
  id: "search-flights-a2ui",
  description:
    'Search for flights and display the results as rich A2UI cards. Return ' +
    'exactly 2 flights. Each flight must have: airline (e.g. "United ' +
    'Airlines"), airlineLogo (Google favicon API, e.g. ' +
    '"https://www.google.com/s2/favicons?domain=united.com&sz=128"), ' +
    'flightNumber, origin, destination, date (short readable, near-future, ' +
    'e.g. "Tue, Mar 18"), departureTime, arrivalTime, duration (e.g. ' +
    '"5h 30m"), status (e.g. "On Time"), and price (e.g. "$289").',
  inputSchema: z.object({
    flights: z
      .array(z.record(z.unknown()))
      .describe("The flights to display as A2UI FlightCard components."),
  }),
  // Return the OBJECT (not a JSON string): the @ag-ui/mastra bridge encodes the
  // tool result once for the wire, so a single-encoded `a2ui_operations`
  // container is what the A2UI middleware detects and paints.
  execute: async ({ flights }) =>
    buildA2uiOperationsFromToolCall({
      surfaceId: FLIGHT_SURFACE_ID,
      catalogId: FLIGHT_CATALOG_ID,
      components: buildFlightCardComponents(flights),
    }),
});
// @endregion[beautiful-chat-fixed-flights]
