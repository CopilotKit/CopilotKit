/**
 * The data shapes Ledgerline's chat cards render. They are exactly what the
 * agent's tools return (`data/agent-view.ts`), so one shape feeds the in-app
 * render, the agent and the MCP app's `structuredContent`.
 */

import type { ResolutionView } from "../data/recon-client";
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

/** The month-end close review card: what `reviewMatches` returns. */
export interface ReviewView {
  kind: "review-card";
  sessionId: string;
  card: {
    id: string;
    holder: string;
    last4: string;
    period: string;
    periodLabel: string;
  };
  status: "open" | "closed";
  pairs: {
    transaction: {
      id: string;
      postedAt: string;
      descriptor: string;
      amount: number;
      glAccount?: string;
    };
    /** Set on an exception charge: which workflow cleared it, and how. */
    exception?: "split" | "reclass" | "personal" | "missing_receipt" | null;
    resolution?: ResolutionView | null;
    receipts: import("../data/recon-seed").Receipt[];
    adjustment: {
      kind: string;
      amount?: number;
      currency?: string;
      receiptAmount?: number;
      rate?: number;
    } | null;
  }[];
}

/** What the review card's Confirm came back as. */
export interface ReviewOutcome {
  ok: boolean;
  summary: string;
  closed?: boolean;
  valid?: number;
  total?: number;
}

/** A card's close at a glance: what `showCloseStatus` draws (recon-store `closeStatus`). */
export interface CloseStatusView {
  card: {
    id: string;
    holder: string;
    last4: string;
    period: string;
    periodLabel: string;
  };
  closed: boolean;
  closedAt: string | null;
  total: number;
  totalAmount: number;
  autoMatched: { count: number; amount: number; notes: string[] };
  exceptions: {
    transactionId: string;
    descriptor: string;
    amount: number;
    kind: "split" | "reclass" | "personal" | "missing_receipt";
    status: "needs_you" | "cleared";
    resolution: ResolutionView | null;
  }[];
  ready: number;
}
