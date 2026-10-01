import type { Category, ExpenseReport, Ledger } from "./types";

/** Pure read models over the ledger snapshot, shared by the pages. */

const counted = (r: ExpenseReport) =>
  r.status === "approved" ||
  r.status === "reimbursed" ||
  r.status === "submitted";

export function spendByCostCenter(
  ledger: Ledger,
): Map<string, { committed: number; pending: number; reports: number }> {
  const out = new Map<
    string,
    { committed: number; pending: number; reports: number }
  >();
  for (const cc of ledger.costCenters)
    out.set(cc.id, { committed: 0, pending: 0, reports: 0 });
  for (const r of ledger.reports) {
    if (!counted(r)) continue;
    const row = out.get(r.costCenterId);
    if (!row) continue;
    row.reports += 1;
    if (r.status === "submitted") row.pending += r.total;
    else row.committed += r.total;
  }
  return out;
}

export function spendByCategory(
  ledger: Ledger,
): { label: Category; value: number }[] {
  const m = new Map<Category, number>();
  for (const r of ledger.reports)
    if (counted(r)) m.set(r.category, (m.get(r.category) ?? 0) + r.total);
  return [...m.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

function daysAgo(today: string, iso: string): number {
  return Math.round((Date.parse(today) - Date.parse(iso)) / 86_400_000);
}

/** Submitted spend per week, oldest first, the last six weeks. */
export function weeklySpend(ledger: Ledger): {
  labels: string[];
  values: number[];
} {
  const values = [0, 0, 0, 0, 0, 0];
  for (const r of ledger.reports) {
    if (r.status === "draft") continue;
    const w = Math.floor(daysAgo(ledger.today, r.submittedAt) / 7);
    if (w >= 0 && w < 6) values[5 - w] += r.total;
  }
  return { labels: ["5w", "4w", "3w", "2w", "Last", "This"], values };
}

export function nextPaymentRun(today: string): string {
  const d = new Date(`${today}T12:00:00`);
  const delta = (5 - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function byEmployee(ledger: Ledger) {
  return ledger.employees.map((e) => {
    const own = ledger.reports.filter((r) => r.employeeId === e.id);
    return {
      employee: e,
      reports: own.length,
      awaiting: own.filter((r) => r.status === "submitted").length,
      reimbursed: own
        .filter((r) => r.status === "reimbursed")
        .reduce((a, r) => a + r.total, 0),
      outstanding: own
        .filter((r) => r.status === "submitted" || r.status === "approved")
        .reduce((a, r) => a + r.total, 0),
    };
  });
}

export function compactMoney(n: number): string {
  if (n >= 10_000) return `$${Math.round(n / 1000)}K`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}
