import { readFile } from "node:fs/promises";

const csvPath = new URL("../data/revenue.csv", import.meta.url);
const text = await readFile(csvPath, "utf8");
const rows = parseCsv(text).map((row) => ({
  ...row,
  revenue: Number(row.revenue),
  users: Number(row.users),
}));

const totalRevenue = rows.reduce((sum, row) => sum + row.revenue, 0);
const totalUsers = rows.reduce((sum, row) => sum + row.users, 0);
const byProduct = new Map();

for (const row of rows) {
  byProduct.set(row.product, (byProduct.get(row.product) ?? 0) + row.revenue);
}

console.log(
  JSON.stringify(
    {
      totalRevenue,
      totalUsers,
      averageRevenuePerUser: Number((totalRevenue / totalUsers).toFixed(2)),
      products: Object.fromEntries(byProduct),
    },
    null,
    2,
  ),
);

function parseCsv(csv) {
  const [headerLine, ...lines] = csv.trim().split(/\r?\n/);
  const headers = headerLine.split(",").map((header) => header.trim());

  return lines.map((line) => {
    const values = line.split(",").map((value) => value.trim());
    return Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? ""]),
    );
  });
}
