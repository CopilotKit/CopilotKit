/**
 * Query data tool implementation — returns mock financial data.
 *
 * TypeScript equivalent of showcase/shared/python/tools/query_data.py.
 * In the future this could read a CSV, but for TS backend simplicity
 * we use generated mock data matching the Python fallback format.
 */

export interface DataRow {
  date: string;
  category: string;
  subcategory: string;
  amount: string;
  type: string;
  notes: string;
}

// Seeded random for deterministic mock data
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

const MOCK_DATA: DataRow[] = generateMockData();

/**
 * Query the database. Takes natural language.
 *
 * Always call before showing a chart or graph. Returns the full
 * dataset as a list of row objects.
 */
export function queryDataImpl(_query: string): DataRow[] {
  return MOCK_DATA;
}
