import { COST_CENTERS } from "./seed";
import type { ExpenseReport, PolicyDoc } from "./types";

/**
 * What the agent sees of a report, the same in-app and over MCP. Holds carry
 * their CODE and status only: the policy engine's explanation is rendered in
 * the report page's Policy panel and is not part of any API the agent reads.
 */
export function agentReport(r: ExpenseReport) {
  const cc = COST_CENTERS.find((c) => c.id === r.costCenterId);
  return {
    id: r.id,
    title: r.title,
    employee: r.employeeName,
    department: r.department,
    category: r.category,
    submittedAt: r.submittedAt,
    total: r.total,
    currency: "USD",
    status: r.status,
    costCenter: { id: r.costCenterId, name: cc?.name ?? r.costCenterId },
    holds: r.holds.map((h) => ({
      code: h.code,
      status: h.status,
      label: "allocation required",
    })),
    lines: r.lines.map((l) => ({
      lineId: l.id,
      costCenter: {
        id: l.costCenterId,
        name:
          COST_CENTERS.find((c) => c.id === l.costCenterId)?.name ??
          l.costCenterId,
      },
      date: l.date,
      merchant: l.merchant,
      description: l.description,
      amount: l.amount,
      receipt: l.receipt,
    })),
    notes: r.notes.map((n) => ({ author: n.author, text: n.text })),
    reimbursement: r.reimbursement ?? null,
  };
}

/** Cost centers as the agent sees them: id, name and owner. No budget types. */
export function agentCostCenters() {
  return {
    costCenters: COST_CENTERS.map((c) => ({
      id: c.id,
      name: c.name,
      owner: c.owner,
    })),
  };
}

/** A recode as the agent sees it: the new coding and whether the hold is still open. Never why. */
export function agentRecode(r: ExpenseReport) {
  const v = agentReport(r);
  return {
    id: v.id,
    lines: v.lines.map((l) => ({
      lineId: l.lineId,
      description: l.description,
      costCenter: l.costCenter,
    })),
    holds: v.holds,
  };
}

export function agentReportRow(r: ExpenseReport) {
  return {
    id: r.id,
    title: r.title,
    employee: r.employeeName,
    category: r.category,
    total: r.total,
    status: r.status,
    submittedAt: r.submittedAt,
    openHolds: r.holds.filter((h) => h.status === "open").map((h) => h.code),
  };
}

export function agentPolicies(out: {
  query: string;
  results: PolicyDoc[];
  note?: string;
}) {
  return {
    query: out.query,
    results: out.results.map((d) => ({
      id: d.id,
      title: d.title,
      section: d.section,
      summary: d.summary,
    })),
    ...(out.note ? { note: out.note } : {}),
  };
}

/** The refusal body for a held approval: names the code, never the fix. */
export function holdRefusal(reportId: string, code: string) {
  return {
    error: "POLICY_HOLD",
    code,
    reportId,
    message: `${reportId} cannot be approved: policy hold ${code} (allocation required) is open.`,
  };
}
