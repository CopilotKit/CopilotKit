/**
 * Pure tool implementations shared by the Strands showcase agent.
 *
 * Mirrors the langgraph-typescript `shared-tools/*` impls (which in turn
 * mirror `showcase/shared/python/tools/*.py`). Kept framework-agnostic —
 * the Strands `tool()` wrappers in `tools.ts` call these.
 */

// ---- Types ---------------------------------------------------------------

export type SalesStage =
  | "prospect"
  | "qualified"
  | "proposal"
  | "negotiation"
  | "closed-won"
  | "closed-lost";

export interface SalesTodo {
  id: string;
  title: string;
  stage: SalesStage;
  value: number;
  dueDate: string;
  assignee: string;
  completed: boolean;
}

export interface Flight {
  airline: string;
  airlineLogo: string;
  flightNumber: string;
  origin: string;
  destination: string;
  date: string;
  departureTime: string;
  arrivalTime: string;
  duration: string;
  status: string;
  statusColor: string;
  price: string;
  currency: string;
}

export interface WeatherResult {
  city: string;
  temperature: number;
  humidity: number;
  wind_speed: number;
  feels_like: number;
  conditions: string;
}

// ---- get_weather ---------------------------------------------------------

const CONDITIONS = [
  "Sunny",
  "Partly Cloudy",
  "Cloudy",
  "Overcast",
  "Light Rain",
  "Heavy Rain",
  "Thunderstorm",
  "Snow",
  "Foggy",
  "Windy",
];

/** Deterministic mulberry32 PRNG so a city always yields the same weather. */
function seededRandom(seed: number): () => number {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let v = Math.imul(t ^ (t >>> 15), 1 | t);
    v = (v + Math.imul(v ^ (v >>> 7), 61 | v)) ^ v;
    return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (Math.imul(31, hash) + s.charCodeAt(i)) | 0;
  }
  return hash;
}

function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function randChoice<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

export function getWeatherImpl(city: string): WeatherResult {
  const rng = seededRandom(hashString(city.toLowerCase()));
  const temperature = randInt(rng, 20, 95);
  return {
    city,
    temperature,
    humidity: randInt(rng, 30, 90),
    wind_speed: randInt(rng, 2, 30),
    feels_like: temperature + randInt(rng, -5, 5),
    conditions: randChoice(rng, CONDITIONS),
  };
}

// ---- query_data (mock financial data) ------------------------------------

export interface DataRow {
  date: string;
  category: string;
  subcategory: string;
  amount: string;
  type: string;
  notes: string;
}

function seededLcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function generateMockData(): DataRow[] {
  const rand = seededLcg(42);
  const categories: Array<{
    category: string;
    subcategory: string;
    type: string;
  }> = [
    {
      category: "Revenue",
      subcategory: "Enterprise Subscriptions",
      type: "income",
    },
    { category: "Revenue", subcategory: "Pro Tier Upgrades", type: "income" },
    { category: "Revenue", subcategory: "API Usage Overages", type: "income" },
    { category: "Revenue", subcategory: "Consulting Services", type: "income" },
    { category: "Revenue", subcategory: "Marketplace Sales", type: "income" },
    {
      category: "Expenses",
      subcategory: "Engineering Salaries",
      type: "expense",
    },
    { category: "Expenses", subcategory: "Product Team", type: "expense" },
    {
      category: "Expenses",
      subcategory: "AWS Infrastructure",
      type: "expense",
    },
    { category: "Expenses", subcategory: "Marketing", type: "expense" },
    { category: "Expenses", subcategory: "Customer Success", type: "expense" },
    { category: "Expenses", subcategory: "AI Model Costs", type: "expense" },
  ];

  const notes: Record<string, string> = {
    "Enterprise Subscriptions": "3 new enterprise customers",
    "Pro Tier Upgrades": "31 upgrades + reduced churn",
    "API Usage Overages": "Heavy usage from top-10 accounts",
    "Consulting Services": "2 implementation projects",
    "Marketplace Sales": "Partner integrations revenue",
    "Engineering Salaries": "7 engineers + 2 contractors",
    "Product Team": "PM + designers + QA",
    "AWS Infrastructure": "Compute + storage + bandwidth",
    Marketing: "Paid ads + content + events",
    "Customer Success": "3 CSMs + tooling",
    "AI Model Costs": "OpenAI + Anthropic API spend",
  };

  const rows: DataRow[] = [];
  const months = ["01", "02", "03", "04", "05", "06"];
  for (const month of months) {
    for (const cat of categories) {
      const baseAmount =
        cat.type === "income"
          ? 15000 + Math.floor(rand() * 35000)
          : 8000 + Math.floor(rand() * 40000);
      const day = String(1 + Math.floor(rand() * 28)).padStart(2, "0");
      rows.push({
        date: `2026-${month}-${day}`,
        category: cat.category,
        subcategory: cat.subcategory,
        amount: String(baseAmount),
        type: cat.type,
        notes: notes[cat.subcategory] ?? "",
      });
    }
  }
  return rows;
}

const MOCK_DATA: DataRow[] = generateMockData();

export function queryDataImpl(_query: string): DataRow[] {
  return MOCK_DATA;
}

// ---- search_flights ------------------------------------------------------

export function searchFlightsImpl(flights: Flight[]): {
  flights: Flight[];
  schema: Record<string, unknown>;
} {
  return { flights, schema: {} };
}

// ---- sales todos ---------------------------------------------------------

export const INITIAL_SALES_TODOS: SalesTodo[] = [
  {
    id: "st-001",
    title: "Follow up with Acme Corp on enterprise proposal",
    stage: "proposal",
    value: 85000,
    dueDate: "2026-04-15",
    assignee: "Sarah Chen",
    completed: false,
  },
  {
    id: "st-002",
    title: "Qualify lead from TechFlow demo request",
    stage: "prospect",
    value: 42000,
    dueDate: "2026-04-18",
    assignee: "Mike Johnson",
    completed: false,
  },
  {
    id: "st-003",
    title: "Send contract to DataViz Inc for final review",
    stage: "negotiation",
    value: 120000,
    dueDate: "2026-04-20",
    assignee: "Sarah Chen",
    completed: false,
  },
];

export function manageSalesTodosImpl(todos: Partial<SalesTodo>[]): SalesTodo[] {
  return todos.map((todo) => ({
    id: todo.id || crypto.randomUUID(),
    title: todo.title ?? "",
    stage: todo.stage ?? "prospect",
    value: todo.value ?? 0,
    dueDate: todo.dueDate ?? "",
    assignee: todo.assignee ?? "",
    completed: todo.completed ?? false,
  }));
}

// ---- roll_dice -----------------------------------------------------------

export interface RollDiceResult {
  sides: number;
  result: number;
}

export function rollDiceImpl(sides: number): RollDiceResult {
  return { sides, result: 1 + Math.floor(Math.random() * sides) };
}

// ---- schedule_meeting (HITL gated) ---------------------------------------

export interface ScheduleMeetingResult {
  status: "pending_approval";
  reason: string;
  duration_minutes: number;
  message: string;
}

export function scheduleMeetingImpl(
  reason: string,
  durationMinutes = 30,
): ScheduleMeetingResult {
  return {
    status: "pending_approval",
    reason,
    duration_minutes: durationMinutes,
    message: `Meeting request: ${reason} (${durationMinutes} min). Awaiting user time selection.`,
  };
}
