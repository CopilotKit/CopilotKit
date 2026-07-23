export interface DataRow {
  date: string;
  category: string;
  subcategory: string;
  amount: string;
  type: string;
  notes: string;
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

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function generateMockData(): DataRow[] {
  const rand = seededRandom(42);
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

const MOCK_DATA = generateMockData();

export function queryDataImpl(_query: string): DataRow[] {
  return MOCK_DATA;
}

const CATALOG_ID = "copilotkit://app-dashboard-catalog";
const FLIGHT_SURFACE_ID = "flight-search-results";

function buildFlightComponents(
  flights: Flight[],
): Array<Record<string, unknown>> {
  const cardIds: string[] = [];
  const cards = flights.map((flight, index) => {
    const id = `flight-card-${index}`;
    cardIds.push(id);
    return {
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
      statusColor: flight.statusColor ?? "",
      price: flight.price ?? "",
    };
  });

  return [
    {
      id: "root",
      component: "Row",
      children: cardIds,
      gap: 16,
    },
    ...cards,
  ];
}

export function renderFlightsImpl(flights: Flight[]): {
  a2ui_operations: Array<Record<string, unknown>>;
} {
  return {
    a2ui_operations: [
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
          components: buildFlightComponents(flights),
        },
      },
    ],
  };
}
