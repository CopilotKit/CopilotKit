/**
 * What each Ledgerline MCP tool does. SERVER-ONLY. The handlers read and write
 * the same in-memory ledger as `/api/ledgerline/v1/*`, so an approval made in
 * ChatGPT is an approval in the web app, and return the same JSON the in-app
 * tools return.
 */

import * as ledger from "../data/store";
import { LedgerError } from "../data/store";
import {
  agentPolicies,
  agentReport,
  agentReportRow,
  holdRefusal,
} from "../data/agent-view";
import type { ReportStatus } from "../data/types";
import * as learning from "../learning/store";
import { SKILL_NAME } from "../learning/types";
import { nextPaymentRun } from "../data/derive";
import { formatDate, formatMoney } from "../data/format";
import type {
  ApproveCardView,
  ApproveOutcome,
  ReportCardView,
} from "../genui/views";

export type ToolOutput = Record<string, unknown>;

function refusal(error: unknown, reportId?: string): ToolOutput {
  if (error instanceof LedgerError) {
    if (error.code === "POLICY_HOLD" && reportId) {
      const out: ToolOutput = holdRefusal(
        reportId.toUpperCase(),
        String(error.detail.code ?? ""),
      );
      const skill = learning
        .publishedSkills()
        .find((s) => s.name === SKILL_NAME);
      if (skill) {
        out.learnedSkill = {
          name: skill.name,
          description: skill.description,
          hint: `A published learned skill matches this hold. Call loadLearnedSkill with name "${skill.name}" and follow it.`,
        };
      }
      return out;
    }
    return { error: error.code, message: error.message };
  }
  throw error;
}

const up = (s: string) => s.trim().toUpperCase();

export const handlers = {
  listReports(args: {
    employee?: string;
    status?: ReportStatus | "all";
  }): ToolOutput {
    const rows = ledger
      .listReports({ employee: args.employee, status: args.status ?? "all" })
      .map(agentReportRow);
    return { count: rows.length, reports: rows.slice(0, 15) };
  },
  getReport({ reportId }: { reportId: string }): ToolOutput {
    try {
      const report = agentReport(ledger.getReport(up(reportId)));
      const view: ReportCardView = { kind: "report-card", report };
      return { ...report, ...view };
    } catch (e) {
      return refusal(e, reportId);
    }
  },
  approveReport({ reportId }: { reportId: string }): ToolOutput {
    try {
      const r = ledger.approveReport(up(reportId), "Maya Chen (via ChatGPT)");
      return {
        id: r.id,
        status: r.status,
        approvedAt: r.approvedAt,
        employee: r.employeeName,
        total: r.total,
      };
    } catch (e) {
      return refusal(e, reportId);
    }
  },
  allocateCostCenter({
    reportId,
    costCenterId,
  }: {
    reportId: string;
    costCenterId: string;
  }): ToolOutput {
    try {
      const r = agentReport(
        ledger.allocateCostCenter(up(reportId), up(costCenterId)),
      );
      return { id: r.id, costCenter: r.costCenter, holds: r.holds };
    } catch (e) {
      return refusal(e, reportId);
    }
  },
  searchPolicies({ query }: { query: string }): ToolOutput {
    return agentPolicies(ledger.searchPolicies(query));
  },
  addNote({ reportId, text }: { reportId: string; text: string }): ToolOutput {
    try {
      ledger.addNote(up(reportId), text, "Maya Chen (via ChatGPT)");
      return { id: up(reportId), noteAdded: true };
    } catch (e) {
      return refusal(e, reportId);
    }
  },
  reimburseReport({ reportId }: { reportId: string }): ToolOutput {
    try {
      const r = ledger.reimburseReport(up(reportId));
      return { id: r.id, status: r.status, reimbursement: r.reimbursement };
    } catch (e) {
      return refusal(e, reportId);
    }
  },
  /** Opens the approve-and-reimburse card; the write is confirmApproveAndReimburse. */
  approveAndReimburse({ reportId }: { reportId: string }): ToolOutput {
    try {
      const r = ledger.getReport(up(reportId));
      const view: ApproveCardView = {
        kind: "approve-card",
        report: agentReport(r),
        paymentRun: nextPaymentRun(ledger.snapshot().today),
      };
      return {
        ...view,
        note: "The approve-and-reimburse card is on screen. Nothing is approved or paid until the user confirms in the card; do not ask in chat.",
      };
    } catch (e) {
      return refusal(e, reportId);
    }
  },
  /** App-only: the card's Approve and reimburse button. */
  confirmApproveAndReimburse({ reportId }: { reportId: string }): ToolOutput {
    const rid = up(reportId);
    let outcome: ApproveOutcome;
    try {
      const approved = ledger.approveReport(rid, "Maya Chen (via ChatGPT)");
      const paid = ledger.reimburseReport(rid);
      const reimb = paid.reimbursement ?? null;
      outcome = {
        ok: true,
        summary: `Approved ${rid} and scheduled ${formatMoney(approved.total)} to ${approved.employeeName} by ACH${reimb ? ` for ${formatDate(reimb.scheduledFor)}, ${reimb.reference}` : ""}.`,
        reimbursement: reimb
          ? { scheduledFor: reimb.scheduledFor, reference: reimb.reference }
          : null,
      };
      return { ...outcome, id: rid, status: "reimbursed" };
    } catch (e) {
      if (!(e instanceof LedgerError)) throw e;
      outcome = {
        ok: false,
        error: e.code,
        code: typeof e.detail.code === "string" ? e.detail.code : undefined,
        summary:
          e.code === "POLICY_HOLD"
            ? `Not approved: policy hold ${String(e.detail.code)} is still open on ${rid}.`
            : `Not done: ${e.message}`,
      };
      return { ...outcome };
    }
  },
  loadLearnedSkill({ name }: { name?: string }): ToolOutput {
    const published = learning.publishedSkills();
    if (!name) {
      return published.length
        ? {
            skills: published.map((s) => ({
              name: s.name,
              description: s.description,
              revision: s.revision,
            })),
          }
        : {
            skills: [],
            message: "No learned skills are published for Ledgerline yet.",
          };
    }
    const skill = published.find((s) => s.name === name);
    if (!skill)
      return {
        error: "UNAVAILABLE",
        message: `No published learned skill named ${name}.`,
      };
    return {
      name: skill.name,
      revision: skill.revision,
      instructions: skill.skillMd,
    };
  },
};

export type HandlerName = keyof typeof handlers;

/**
 * Run one tool and record it in the ChatGPT Thread's agent trace. ChatGPT
 * sends no conversation id over MCP, so calls are grouped by caller (the
 * `openai/subject` request meta when present, else the user agent) within a
 * 15-minute window, and linked weakly to the trajectory open at the time.
 */
export function runTool(
  name: HandlerName,
  args: Record<string, unknown>,
  callerKey: string,
): ToolOutput {
  const started = Date.now();
  const threadId = learning.chatgptThreadId(callerKey, started);
  const toolCallId = learning.newId("tc");
  learning.recordToolCall(threadId, "chatgpt", {
    toolCallId,
    name,
    args,
    at: started,
  });
  const out = (handlers[name] as (a: Record<string, unknown>) => ToolOutput)(
    args,
  );
  learning.recordToolResult(toolCallId, JSON.stringify(out), Date.now());
  return out;
}
