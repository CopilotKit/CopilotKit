"use client";

import { z } from "zod";
import {
  useAgentContext,
  useFrontendTool,
  useHumanInTheLoop,
} from "@copilotkit/react-core/v2";
import { useRouter } from "next/navigation";
import { useSkin } from "@/shell/skin-provider";
import { useSkinHref } from "@/shell/skin-path";
import { Check, ChevronRight, Loader2, Wallet, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { API, formatDate, formatMoney, useLedger } from "./data/client";
import { nextPaymentRun } from "./data/derive";
import { primaryButton, secondaryButton } from "./components/ui";
import {
  agentPolicies,
  agentReport,
  agentReportRow,
  holdRefusal,
} from "./data/agent-view";
import type { ExpenseReport, PolicyDoc } from "./data/types";
import { LearnedSkillTools } from "./learned-skills";

/**
 * Ledgerline's frontend tools. Each handler calls the same REST API the pages
 * use (`/api/ledgerline/v1`) and returns JSON: `{ error, code, message }` on a
 * refusal, so the agent trace records the status the server gave.
 *
 * Every tool draws its own one-line activity row (`ToolLine`), so a run that
 * does not converge shows every attempt in the chat instead of the shell's
 * last-two-chips summary.
 */

async function call(
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; body: Record<string, unknown> }> {
  const res = await fetch(`${API}${path}`, { cache: "no-store", ...init });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, body };
}

const post = (path: string, body?: unknown) =>
  call(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

function refusal(body: Record<string, unknown>, reportId: string): string {
  if (body.error === "POLICY_HOLD")
    return JSON.stringify(holdRefusal(reportId, String(body.code ?? "")));
  return JSON.stringify({
    error: body.error ?? "REFUSED",
    message: body.message ?? "The request was refused.",
  });
}

const id = (v: unknown) =>
  typeof v === "string" ? v.trim().toUpperCase() : "";

/** One tool call as a single line: what it did, and how it came back. */
function ToolLine({
  label,
  detail,
  result,
}: {
  label: string;
  detail?: string;
  result: unknown;
}) {
  const [open, setOpen] = useState(false);
  const pending = typeof result !== "string";
  let parsed: Record<string, unknown> | null = null;
  if (typeof result === "string") {
    try {
      parsed = JSON.parse(result) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
  }
  const failed = !!parsed && typeof parsed === "object" && "error" in parsed;
  const errorLabel = failed
    ? [parsed!.error, parsed!.code].filter(Boolean).join(" ")
    : "";
  return (
    <div data-testid="ledgerline-tool-line" className="my-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-full items-center gap-1.5 text-left text-[0.8rem] text-ink-muted hover:text-ink"
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 flex-none animate-spin" />
        ) : failed ? (
          <X className="h-3.5 w-3.5 flex-none text-negative" />
        ) : (
          <Check className="h-3.5 w-3.5 flex-none text-positive" />
        )}
        <span className="font-medium text-ink">{label}</span>
        {detail ? (
          <span className="truncate font-mono text-[0.72rem]">{detail}</span>
        ) : null}
        {failed ? (
          <span className="rounded-full bg-negative-soft px-1.5 py-0.5 font-mono text-[0.66rem] font-semibold text-negative">
            {errorLabel}
          </span>
        ) : null}
        <ChevronRight
          className={cn(
            "h-3 w-3 flex-none transition-transform",
            open && "rotate-90",
          )}
        />
      </button>
      {open && typeof result === "string" ? (
        <pre className="ml-5 mt-1 max-h-48 overflow-auto whitespace-pre-wrap border-l border-hairline pl-3 text-[0.68rem] text-ink-muted">
          {result.length > 1500 ? `${result.slice(0, 1500)}...` : result}
        </pre>
      ) : null}
    </div>
  );
}

export function LedgerlineTools() {
  const { data, refresh } = useLedger();
  const router = useRouter();
  const skin = useSkin();
  const skinHref = useSkinHref(skin.id);
  const ledgerRef = useRef(data);
  useEffect(() => {
    ledgerRef.current = data;
  }, [data]);

  useAgentContext({
    description: "Who you are helping and today's date in Ledgerline.",
    value: JSON.stringify({
      company: data.company,
      user: data.currentUser,
      today: data.today,
    }),
  });

  useFrontendTool(
    {
      name: "listReports",
      description:
        "List expense reports, newest first. Filter by employee name (or part of it) and status ('submitted' = awaiting approval).",
      parameters: z.object({
        employee: z
          .string()
          .optional()
          .describe("Employee name or part of it."),
        status: z
          .enum([
            "all",
            "draft",
            "submitted",
            "approved",
            "reimbursed",
            "rejected",
          ])
          .optional(),
      }),
      handler: async ({ employee, status }) => {
        const q = new URLSearchParams();
        if (employee) q.set("employee", employee);
        q.set("status", status ?? "all");
        const { body } = await call(`/reports?${q}`);
        const rows = (body as unknown as ExpenseReport[]).map(agentReportRow);
        return JSON.stringify({
          count: rows.length,
          reports: rows.slice(0, 15),
        });
      },
      render: ({ args, result }) => (
        <ToolLine
          label="listReports"
          detail={[args?.employee, args?.status].filter(Boolean).join(", ")}
          result={result}
        />
      ),
    },
    [],
  );

  useFrontendTool(
    {
      name: "getReport",
      description:
        "Read one expense report: line items, totals, cost center, notes and any policy holds.",
      parameters: z.object({
        reportId: z.string().describe("Report id, e.g. EXP-2291."),
      }),
      handler: async ({ reportId }) => {
        const { ok, body } = await call(
          `/reports/${encodeURIComponent(id(reportId))}`,
        );
        return ok
          ? JSON.stringify(agentReport(body as unknown as ExpenseReport))
          : refusal(body, id(reportId));
      },
      render: ({ args, result }) => (
        <ToolLine label="getReport" detail={args?.reportId} result={result} />
      ),
    },
    [],
  );

  useFrontendTool(
    {
      name: "approveReport",
      description:
        "Approve a submitted expense report. Refused while a policy hold is open.",
      parameters: z.object({ reportId: z.string() }),
      handler: async ({ reportId }) => {
        const rid = id(reportId);
        const { ok, body } = await post(
          `/reports/${encodeURIComponent(rid)}/approve`,
        );
        await refresh();
        if (!ok) return refusal(body, rid);
        const r = body as unknown as ExpenseReport;
        return JSON.stringify({
          id: r.id,
          status: r.status,
          approvedAt: r.approvedAt,
          employee: r.employeeName,
          total: r.total,
        });
      },
      render: ({ args, result }) => (
        <ToolLine
          label="approveReport"
          detail={args?.reportId}
          result={result}
        />
      ),
    },
    [],
  );

  useFrontendTool(
    {
      name: "allocateCostCenter",
      description:
        "Move an expense report onto a different cost center (the budget it is charged to). This changes which team pays for the spend, so only do it when the user or a loaded learned skill names the cost center to use.",
      parameters: z.object({
        reportId: z.string(),
        costCenterId: z.string().describe("Cost center id, e.g. CC-200."),
      }),
      handler: async ({ reportId, costCenterId }) => {
        const rid = id(reportId);
        const { ok, body } = await post(
          `/reports/${encodeURIComponent(rid)}/allocate`,
          { costCenterId: id(costCenterId) },
        );
        await refresh();
        if (!ok) return refusal(body, rid);
        const r = agentReport(body as unknown as ExpenseReport);
        return JSON.stringify({
          id: r.id,
          costCenter: r.costCenter,
          holds: r.holds,
        });
      },
      render: ({ args, result }) => (
        <ToolLine
          label="allocateCostCenter"
          detail={[args?.reportId, args?.costCenterId]
            .filter(Boolean)
            .join(" to ")}
          result={result}
        />
      ),
    },
    [],
  );

  useFrontendTool(
    {
      name: "searchPolicies",
      description:
        "Search Ledgerline's policy library (travel and expense policy, approvals handbook, budget guide).",
      parameters: z.object({ query: z.string() }),
      handler: async ({ query }) => {
        const { body } = await call(`/policies?q=${encodeURIComponent(query)}`);
        return JSON.stringify(
          agentPolicies(
            body as unknown as {
              query: string;
              results: PolicyDoc[];
              note?: string;
            },
          ),
        );
      },
      render: ({ args, result }) => (
        <ToolLine
          label="searchPolicies"
          detail={args?.query ? `"${args.query}"` : undefined}
          result={result}
        />
      ),
    },
    [],
  );

  useFrontendTool(
    {
      name: "addNote",
      description:
        "Add a note to an expense report, visible to the submitter and approvers.",
      parameters: z.object({ reportId: z.string(), text: z.string() }),
      handler: async ({ reportId, text }) => {
        const rid = id(reportId);
        const { ok, body } = await post(
          `/reports/${encodeURIComponent(rid)}/notes`,
          { text },
        );
        await refresh();
        return ok
          ? JSON.stringify({ id: rid, noteAdded: true })
          : refusal(body, rid);
      },
      render: ({ args, result }) => (
        <ToolLine label="addNote" detail={args?.reportId} result={result} />
      ),
    },
    [],
  );

  useFrontendTool(
    {
      name: "openReport",
      description: "Take the user to one expense report's page in Ledgerline.",
      parameters: z.object({ reportId: z.string() }),
      handler: async ({ reportId }) => {
        const rid = id(reportId);
        if (!ledgerRef.current.reports.some((r) => r.id === rid)) {
          return JSON.stringify({
            error: "NOT_FOUND",
            message: `There is no expense report ${rid}.`,
          });
        }
        router.push(skinHref(`reports/${rid}`));
        return JSON.stringify({ opened: rid });
      },
      render: ({ args, result }) => (
        <ToolLine label="openReport" detail={args?.reportId} result={result} />
      ),
    },
    [],
  );

  // Paying someone is the one write a person confirms: the card is the confirmation.
  useHumanInTheLoop(
    {
      name: "reimburseReport",
      description:
        "Schedule ACH reimbursement for an approved expense report. Opens a confirmation card in the chat; the payment is scheduled only when the user confirms there. Do not ask in chat first.",
      parameters: z.object({ reportId: z.string() }),
      render: ({ args, respond, result }) => (
        <ReimburseCard
          reportId={id(args?.reportId)}
          ledger={ledgerRef.current}
          result={result}
          onConfirm={async () => {
            const rid = id(args?.reportId);
            const { ok, body } = await post(
              `/reports/${encodeURIComponent(rid)}/reimburse`,
            );
            await refresh();
            const out = ok
              ? JSON.stringify({
                  id: rid,
                  status: "reimbursed",
                  reimbursement: (body as unknown as ExpenseReport)
                    .reimbursement,
                })
              : refusal(body, rid);
            await respond?.(out);
          }}
          onCancel={() =>
            void respond?.(
              JSON.stringify({
                error: "CANCELLED",
                message: "The user cancelled. Nothing was paid.",
              }),
            )
          }
        />
      ),
    },
    [],
  );

  return <LearnedSkillTools />;
}

function ReimburseCard({
  reportId,
  ledger,
  result,
  onConfirm,
  onCancel,
}: {
  reportId: string;
  ledger: { reports: ExpenseReport[]; today: string };
  result: unknown;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const [sending, setSending] = useState(false);
  const r = ledger.reports.find((x) => x.id === reportId);
  if (typeof result === "string") {
    let parsed: {
      error?: string;
      reimbursement?: { scheduledFor?: string; reference?: string };
    } = {};
    try {
      parsed = JSON.parse(result) as typeof parsed;
    } catch {
      parsed = {};
    }
    return (
      <div className="my-1.5 flex items-center gap-2 rounded-xl border border-hairline bg-surface px-3 py-2 text-[0.78rem]">
        {parsed.error ? (
          <X className="h-4 w-4 text-negative" />
        ) : (
          <Check className="h-4 w-4 text-positive" />
        )}
        {parsed.error
          ? parsed.error === "CANCELLED"
            ? "Cancelled. Nothing was paid."
            : `Reimbursement of ${reportId} was refused.`
          : `Reimbursement of ${reportId} scheduled by ACH${parsed.reimbursement?.scheduledFor ? ` for ${formatDate(parsed.reimbursement.scheduledFor)}` : ""}${parsed.reimbursement?.reference ? `, ${parsed.reimbursement.reference}` : ""}.`}
      </div>
    );
  }
  if (!r) {
    return (
      <div className="my-1.5 rounded-xl border border-hairline bg-surface px-3 py-2 text-[0.78rem] text-ink-muted">
        Preparing the reimbursement...
      </div>
    );
  }
  return (
    <div
      data-testid="ledgerline-reimburse-card"
      className="my-1.5 rounded-2xl border border-hairline bg-surface px-4 py-3 text-[0.8rem] shadow-sm"
    >
      <div className="flex items-center gap-2 font-semibold">
        <Wallet className="h-4 w-4 text-brand" /> Reimburse {r.employeeName}
      </div>
      <dl className="mt-2 grid grid-cols-[92px_1fr] gap-y-1 text-[0.78rem]">
        <dt className="text-ink-muted">Report</dt>
        <dd>
          {r.title}{" "}
          <span className="font-mono text-[0.7rem] text-ink-muted">{r.id}</span>
        </dd>
        <dt className="text-ink-muted">Amount</dt>
        <dd className="font-semibold tabular-nums">{formatMoney(r.total)}</dd>
        <dt className="text-ink-muted">Method</dt>
        <dd>ACH, payment run {formatDate(nextPaymentRun(ledger.today))}</dd>
      </dl>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          data-testid="ledgerline-reimburse-confirm"
          disabled={sending}
          className={primaryButton}
          onClick={async () => {
            setSending(true);
            await onConfirm();
          }}
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Confirm reimbursement
        </button>
        <button
          type="button"
          disabled={sending}
          className={secondaryButton}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
