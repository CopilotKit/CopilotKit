/**
 * Ledgerline's expense domain. Shared by the server store, the REST routes,
 * the MCP server and the client pages. No React, no Node APIs.
 */

export const REPORT_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "reimbursed",
  "rejected",
] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const CATEGORIES = [
  "Travel",
  "Meals",
  "Client entertainment",
  "Team event",
  "Software",
  "Training",
  "Office supplies",
  "Equipment",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const BUDGET_TYPES = [
  "ops",
  "product",
  "engineering",
  "sales",
  "marketing",
  "events",
  "travel",
  "customer",
  "people",
] as const;
export type BudgetType = (typeof BUDGET_TYPES)[number];

export interface CostCenter {
  id: string;
  name: string;
  owner: string;
  /**
   * The kind of spend this budget absorbs. Only an "events" budget satisfies
   * POL-114, and only the Cost centers page shows this.
   */
  budgetType: BudgetType;
  /** This quarter's budget for expense reports, USD. */
  quarterBudget: number;
}

export interface Activity {
  id: string;
  at: string;
  actor: string;
  kind:
    | "submitted"
    | "approved"
    | "reimbursed"
    | "allocated"
    | "recoded"
    | "note"
    | "hold"
    | "rejected";
  reportId: string;
  text: string;
}

export interface LineItem {
  id: string;
  date: string;
  merchant: string;
  description: string;
  amount: number;
  receipt: boolean;
  /** The cost center this line is charged to (its "coding"). */
  costCenterId: string;
  /** Event spend (venue, catering) as opposed to travel or supplies. */
  eventCost: boolean;
}

export interface Note {
  id: string;
  at: string;
  author: string;
  text: string;
}

/**
 * A hold the policy engine placed on a report. The engine returns a CODE and a
 * status only; the human-readable explanation is rendered by the report page's
 * Policy panel (see `pages/report-detail.tsx`) and is never part of the API.
 */
export interface PolicyHold {
  code: string;
  status: "open" | "resolved";
  raisedAt: string;
  resolvedAt?: string;
}

export interface Employee {
  id: string;
  name: string;
  title: string;
  department: string;
  homeCostCenterId: string;
}

export interface ExpenseReport {
  id: string;
  title: string;
  employeeId: string;
  employeeName: string;
  department: string;
  category: Category;
  submittedAt: string;
  total: number;
  status: ReportStatus;
  costCenterId: string;
  lines: LineItem[];
  notes: Note[];
  holds: PolicyHold[];
  approvedAt?: string;
  approvedBy?: string;
  reimbursement?: { scheduledFor: string; method: "ACH"; reference: string };
}

export interface PolicyDoc {
  id: string;
  title: string;
  section: string;
  updatedAt: string;
  summary: string;
  body: string;
}

export interface Ledger {
  today: string;
  company: string;
  currentUser: { id: string; name: string; title: string };
  employees: Employee[];
  costCenters: CostCenter[];
  reports: ExpenseReport[];
  activity: Activity[];
  version: number;
}

export const EVENTS_THRESHOLD = 2500;
export const HOLD_TEAM_EVENT = "POL-114";
