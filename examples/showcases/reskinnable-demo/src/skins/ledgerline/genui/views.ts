/**
 * The data shapes Ledgerline's chat cards render. They are exactly what the
 * agent's tools return (`data/agent-view.ts`), so one shape feeds the in-app
 * render, the agent and the MCP app's `structuredContent`.
 */
import type { agentReport, agentReportRow } from "../data/agent-view";

export type ReportView = ReturnType<typeof agentReport>;
export type ReportRowView = ReturnType<typeof agentReportRow>;

export interface ReportTableView {
  kind: "report-table";
  title: string;
  count: number;
  total: number;
  reports: ReportRowView[];
}

export interface ReportCardView {
  kind: "report-card";
  report: ReportView;
}

export interface ApproveCardView {
  kind: "approve-card";
  report: ReportView;
  paymentRun: string;
}

/** What an approve-and-reimburse confirmation came back as. */
export interface ApproveOutcome {
  ok: boolean;
  summary: string;
  error?: string;
  code?: string;
  reimbursement?: { scheduledFor: string; reference: string } | null;
}
