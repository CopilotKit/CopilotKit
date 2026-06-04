export type RevenueRow = {
  month: string;
  product: string;
  revenue: number;
  users: number;
  region: string;
};

export type RevenueSummary = {
  totalRevenue: number;
  totalUsers: number;
  averageRevenuePerUser: number;
  topProduct: string;
  regions: string[];
};

export function parseCsv(text: string): Record<string, string>[] {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  const headers = lines[0].split(",").map((header) => header.trim());

  return lines.slice(1).map((line) => {
    const values = line.split(",").map((value) => value.trim());
    return Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? ""]),
    );
  });
}

export function parseRevenueCsv(text: string): RevenueRow[] {
  return parseCsv(text).map((row) => ({
    month: row.month ?? "",
    product: row.product ?? "",
    revenue: toNumber(row.revenue, "revenue"),
    users: toNumber(row.users, "users"),
    region: row.region ?? "",
  }));
}

export function summarizeRevenue(rows: RevenueRow[]): RevenueSummary {
  const totalRevenue = rows.reduce((sum, row) => sum + row.revenue, 0);
  const totalUsers = rows.reduce((sum, row) => sum + row.users, 0);
  const productTotals = new Map<string, number>();

  for (const row of rows) {
    productTotals.set(
      row.product,
      (productTotals.get(row.product) ?? 0) + row.revenue,
    );
  }

  const [topProduct = "n/a"] =
    [...productTotals.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];

  return {
    totalRevenue,
    totalUsers,
    averageRevenuePerUser:
      totalUsers === 0 ? 0 : Number((totalRevenue / totalUsers).toFixed(2)),
    topProduct,
    regions: [...new Set(rows.map((row) => row.region))].sort(),
  };
}

function toNumber(value: string | undefined, field: string): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(
      `Invalid numeric value for ${field}: ${value ?? "<missing>"}`,
    );
  }

  return parsed;
}
