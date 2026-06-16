// @region[weather-tool-backend]
import { z } from "zod4";
import { toolDefinition } from "@tanstack/ai";

export const weatherTool = toolDefinition({
  name: "weather",
  description: "Get current weather for a city",
  inputSchema: z.object({
    city: z.string(),
  }),
}).server(async ({ city }) => ({
  city,
  tempF: 72,
  condition: "Partly cloudy",
  humidity: 0.45,
}));
// @endregion[weather-tool-backend]

export const haikuTool = toolDefinition({
  name: "haiku",
  description: "Generate a haiku about a topic",
  inputSchema: z.object({
    topic: z.string(),
  }),
}).server(async ({ topic }) => ({
  topic,
  lines: [
    "Lines on a topic",
    `Eight syllables, on ${topic}`,
    "Then five at the close",
  ],
}));

const FINANCIAL_ROWS = [
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
] as const;

type FinancialRow = (typeof FINANCIAL_ROWS)[number];

type Todo = {
  id?: string;
  title: string;
  description?: string;
  emoji?: string;
  status?: "pending" | "completed";
};

type Flight = {
  airline?: string;
  airlineLogo?: string;
  flightNumber?: string;
  origin?: string;
  destination?: string;
  date?: string;
  departureTime?: string;
  arrivalTime?: string;
  duration?: string;
  status?: string;
  price?: string;
};

type BuiltInAgentState = {
  todos?: Todo[];
};

const todoSchema = z.object({
  id: z.string().optional(),
  title: z.string(),
  description: z.string().optional(),
  emoji: z.string().optional(),
  status: z.enum(["pending", "completed"]).optional(),
});

const beautifulChatFlightSchema = z.object({
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

const A2UI_OPERATIONS_KEY = "a2ui_operations";
const BEAUTIFUL_CHAT_CATALOG_ID = "copilotkit://app-dashboard-catalog";
const BEAUTIFUL_CHAT_FLIGHT_SURFACE_ID = "flight-search-results";

const BEAUTIFUL_CHAT_DEMO_FLIGHTS: Flight[] = [
  {
    airline: "United Airlines",
    airlineLogo:
      "https://www.google.com/s2/favicons?domain=united.com&sz=128",
    flightNumber: "UA123",
    origin: "SFO",
    destination: "JFK",
    date: "Tue, Apr 15",
    departureTime: "08:00",
    arrivalTime: "16:30",
    duration: "5h 30m",
    status: "On Time",
    price: "$349",
  },
  {
    airline: "Delta",
    airlineLogo:
      "https://www.google.com/s2/favicons?domain=delta.com&sz=128",
    flightNumber: "DL456",
    origin: "SFO",
    destination: "JFK",
    date: "Tue, Apr 15",
    departureTime: "10:15",
    arrivalTime: "18:45",
    duration: "5h 30m",
    status: "On Time",
    price: "$289",
  },
];

const BEAUTIFUL_CHAT_LEARNING_TODOS: Todo[] = [
  {
    id: "todo-cpk-1",
    title: "Read the CopilotKit docs",
    description: "Start with the quickstart and explore the core hooks.",
    emoji: "📚",
    status: "pending",
  },
  {
    id: "todo-cpk-2",
    title: "Build a CopilotKit prototype",
    description: "Wire up a basic chat and register a frontend tool.",
    emoji: "🚀",
    status: "pending",
  },
  {
    id: "todo-cpk-3",
    title: "Explore shared agent state",
    description: "Watch the canvas re-render as the agent writes to state.",
    emoji: "🎯",
    status: "pending",
  },
];

function aggregateBySubcategory(category: FinancialRow["category"]) {
  const totals = new Map<string, number>();

  for (const row of FINANCIAL_ROWS) {
    if (row.category !== category) continue;
    totals.set(
      row.subcategory,
      (totals.get(row.subcategory) ?? 0) + Number(row.amount),
    );
  }

  return Array.from(totals, ([label, value]) => ({ label, value }));
}

function aggregateRevenueByMonth() {
  const monthNames = new Map([
    ["01", "January"],
    ["02", "February"],
    ["03", "March"],
  ]);
  const totals = new Map<string, number>();

  for (const row of FINANCIAL_ROWS) {
    if (row.category !== "Revenue") continue;
    const month = monthNames.get(row.date.slice(5, 7)) ?? row.date.slice(0, 7);
    totals.set(month, (totals.get(month) ?? 0) + Number(row.amount));
  }

  return Array.from(totals, ([label, value]) => ({ label, value }));
}

const FINANCIAL_CHART_DATA = {
  revenueByCategory: aggregateBySubcategory("Revenue"),
  expensesByCategory: aggregateBySubcategory("Expenses"),
  revenueByMonth: aggregateRevenueByMonth(),
} as const;

function createTodoId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `todo-${Date.now()}`;
}

function normalizeTodo(todo: Todo): Required<Todo> {
  return {
    id: todo.id || createTodoId(),
    title: todo.title,
    description: todo.description ?? "",
    emoji: todo.emoji ?? "•",
    status: todo.status ?? "pending",
  };
}

function normalizeBeautifulChatTodos(todos: Todo[]): Required<Todo>[] {
  const titles = todos.map((todo) => todo.title.toLowerCase());
  const isLearningTodosPrompt =
    titles.some((title) => title.includes("copilotkit docs")) &&
    titles.some((title) => title.includes("prototype")) &&
    titles.some((title) => title.includes("agent state"));

  if (isLearningTodosPrompt) {
    return BEAUTIFUL_CHAT_LEARNING_TODOS.map(normalizeTodo);
  }

  return todos.map(normalizeTodo);
}

function getStateTodos(state: unknown): Todo[] {
  if (!state || typeof state !== "object" || !("todos" in state)) return [];
  const todos = (state as BuiltInAgentState).todos;
  return Array.isArray(todos) ? todos : [];
}

function createSurfaceOp(surfaceId: string, catalogId: string) {
  return {
    version: "v0.9",
    createSurface: { surfaceId, catalogId },
  };
}

function updateComponentsOp(surfaceId: string, components: unknown[]) {
  return {
    version: "v0.9",
    updateComponents: { surfaceId, components },
  };
}

function renderA2uiOperations(operations: unknown[]) {
  return { [A2UI_OPERATIONS_KEY]: operations };
}

function buildBeautifulChatFlightComponents(flights: Flight[]) {
  const flightCardIds: string[] = [];
  const components: Array<Record<string, unknown>> = [];

  flights.forEach((flight, index) => {
    const cardId = `flight-card-${index}`;
    flightCardIds.push(cardId);
    components.push({
      id: cardId,
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

  return [
    {
      id: "root",
      component: "Row",
      children: flightCardIds,
      gap: 16,
    },
    ...components,
  ];
}

// @region[query-data-tool-backend]
export const queryDataTool = toolDefinition({
  name: "query_data",
  description:
    "Query the financial demo database using natural language. Always call before showing a chart, graph, dashboard, or revenue/expense visualization. The result includes raw rows and chart-ready numeric aggregates.",
  inputSchema: z.object({
    query: z.string(),
  }),
}).server(async () => ({
  rows: FINANCIAL_ROWS,
  chartData: FINANCIAL_CHART_DATA,
}));
// @endregion[query-data-tool-backend]

// @region[beautiful-chat-todo-tools-backend]
export const manageTodosTool = toolDefinition({
  name: "manage_todos",
  description:
    "Replace the current todo list with the full updated list. Use when the user asks to add, edit, complete, or remove todos.",
  inputSchema: z.object({
    todos: z.array(todoSchema),
  }),
}).server(async ({ todos }) => ({
  success: true,
  todos: normalizeBeautifulChatTodos(todos),
}));

export function createGetTodosTool(state: unknown) {
  return toolDefinition({
    name: "get_todos",
    description: "Get the current todos from shared agent state.",
    inputSchema: z.object({}),
  }).server(async () => getStateTodos(state));
}
// @endregion[beautiful-chat-todo-tools-backend]

// @region[headless-chart-tool-backend]
export const getRevenueChartTool = toolDefinition({
  name: "get_revenue_chart",
  description:
    "Get a mock six-month revenue series for a chart visualization.",
  inputSchema: z.object({}),
}).server(async () => ({
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
}));
// @endregion[headless-chart-tool-backend]

// @region[shared-state-document-tool-backend]
export const writeDocumentTool = toolDefinition({
  name: "write_document",
  description:
    "Write the full document text into shared state. Built-in Agent emits a document state update after the tool finishes.",
  inputSchema: z.object({
    document: z.string(),
  }),
}).server(async ({ document }) => ({ success: true, document }));
// @endregion[shared-state-document-tool-backend]

// Mock travel-and-lifestyle tools used by the tool-rendering demos
// (default-catchall, custom-catchall). They return fake data so the LLM
// can chain them liberally to surface multiple tool-call cards per turn.

export const getWeatherTool = toolDefinition({
  name: "get_weather",
  description:
    "Get the current weather for a given location. Pairs naturally " +
    "with search_flights — when a city is mentioned, also consider " +
    "looking up flights there.",
  inputSchema: z.object({
    location: z.string(),
  }),
}).server(async ({ location }) => ({
  city: location,
  temperature: 68,
  humidity: 55,
  wind_speed: 10,
  conditions: "Sunny",
}));

export const searchFlightsTool = toolDefinition({
  name: "search_flights",
  description:
    "Search mock flights from an origin airport to a destination " +
    "airport. When the user mentions a city without a matching origin, " +
    "default the origin to 'SFO'.",
  inputSchema: z.object({
    origin: z.string(),
    destination: z.string(),
  }),
}).server(async ({ origin, destination }) => ({
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
}));

export const getStockPriceTool = toolDefinition({
  name: "get_stock_price",
  description:
    "Get a mock current price for a stock ticker. Consider also " +
    "pulling a related ticker for comparison context.",
  inputSchema: z.object({
    ticker: z.string(),
    price_usd: z.number().nullable().optional(),
    change_pct: z.number().nullable().optional(),
  }),
}).server(async ({ ticker, price_usd, change_pct }) => {
  return {
    ticker: ticker.toUpperCase(),
    price_usd: price_usd ?? 338.37,
    change_pct: change_pct ?? -2.96,
  };
});

// Headless-complete only needs a ticker for its stock card. Keeping this
// schema narrow prevents
// the model from treating the deterministic tool-rendering fields as
// required user-supplied data in the headless demo.
export const getHeadlessStockPriceTool = toolDefinition({
  name: "get_stock_price",
  description: "Get a mock current price for a stock ticker.",
  inputSchema: z.object({
    ticker: z.string(),
  }),
}).server(async ({ ticker }) => ({
  ticker: ticker.toUpperCase(),
  price_usd: 189.42,
  change_pct: 1.27,
}));

export const rollD20Tool = toolDefinition({
  name: "roll_d20",
  description:
    "Roll one twenty-sided die. If a value is provided by a deterministic fixture, echo it back.",
  inputSchema: z.object({
    value: z.number().int().min(1).max(20).nullable().optional(),
  }),
}).server(async ({ value }) => ({
  value: value ?? Math.floor(Math.random() * 20) + 1,
}));

export const rollDiceTool = toolDefinition({
  name: "roll_dice",
  description: "Roll a single die with the given number of sides.",
  inputSchema: z.object({
    sides: z.number().int().min(2).default(6),
  }),
}).server(async ({ sides }) => {
  const safeSides = Math.max(2, sides ?? 6);
  return {
    sides: safeSides,
    result: Math.floor(Math.random() * safeSides) + 1,
  };
});

// Tool for the shared-state-read-write demo. The `set_notes` tool
// updates the `notes` slot in shared state. The actual state mutation
// happens client-side when the tool result is returned; here we echo the
// notes back so the runtime/frontend can handle it.
export const setNotesTool = toolDefinition({
  name: "set_notes",
  description:
    "Replace the notes array in shared state with the full updated list. " +
    "Use this tool whenever the user asks you to 'remember' something, or " +
    "when you have an observation about the user worth surfacing in the " +
    "UI's notes panel. Always pass the FULL notes list (existing notes + " +
    "any new ones), not a diff. Keep each note short (< 120 chars).",
  inputSchema: z.object({
    notes: z.array(z.string()).describe("The complete updated list of notes"),
  }),
}).server(async ({ notes }) => ({ success: true, notes }));

// @region[beautiful-chat-a2ui-flight-tool-backend]
export const beautifulChatSearchFlightsTool = toolDefinition({
  name: "search_flights",
  description:
    "Search for flights and display the results as rich A2UI flight cards. Return exactly two flights.",
  inputSchema: z.object({
    flights: z.array(beautifulChatFlightSchema).optional(),
  }),
}).server(async () =>
  renderA2uiOperations([
    createSurfaceOp(BEAUTIFUL_CHAT_FLIGHT_SURFACE_ID, BEAUTIFUL_CHAT_CATALOG_ID),
    updateComponentsOp(
      BEAUTIFUL_CHAT_FLIGHT_SURFACE_ID,
      buildBeautifulChatFlightComponents(BEAUTIFUL_CHAT_DEMO_FLIGHTS),
    ),
  ]),
);
// @endregion[beautiful-chat-a2ui-flight-tool-backend]

type BaseServerToolOptions = {
  searchFlightsMode?: "generic" | "beautiful-chat-a2ui";
  stockPriceMode?: "generic" | "headless-complete";
};

export function buildBaseServerTools(
  options: BaseServerToolOptions = {},
) {
  return [
    weatherTool,
    haikuTool,
    queryDataTool,
    manageTodosTool,
    getWeatherTool,
    options.searchFlightsMode === "beautiful-chat-a2ui"
      ? beautifulChatSearchFlightsTool
      : searchFlightsTool,
    options.stockPriceMode === "headless-complete"
      ? getHeadlessStockPriceTool
      : getStockPriceTool,
    rollD20Tool,
    rollDiceTool,
    getRevenueChartTool,
    writeDocumentTool,
    setNotesTool,
  ];
}

export function buildStatefulServerTools(state: unknown) {
  return [createGetTodosTool(state)];
}

export const baseServerTools = buildBaseServerTools();

export const beautifulChatServerTools = buildBaseServerTools({
  searchFlightsMode: "beautiful-chat-a2ui",
});

export const serverToolAudit = [
  "weather",
  "haiku",
  "query_data",
  "manage_todos",
  "get_todos",
  "get_revenue_chart",
  "write_document",
  "roll_d20",
  "roll_dice",
  "get_weather",
  "search_flights",
  "get_stock_price",
  "set_notes",
] as const;
