"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  CircleAlert,
  Loader2,
  MessageSquarePlus,
  ShieldAlert,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSkin } from "@/shell/skin-provider";
import { useSkinHref } from "@/shell/skin-path";
import {
  formatDate,
  formatMoney,
  useLedger,
  useLedgerActions,
} from "../data/client";
import type { CostCenter, ExpenseReport } from "../data/types";
import {
  Avatar,
  Badge,
  Card,
  PageHeader,
  StatusPill,
  primaryButton,
  secondaryButton,
} from "../components/ui";
import { useToast } from "../components/toast";
import { emitScreenContext } from "../learning/recorder";

/**
 * The policy engine's explanation of each hold code. It is rendered here, in
 * the report's Policy panel, and NOWHERE else: no API, tool result, policy
 * document or agent context carries it. That is the demo's root cause: the fix
 * is visible on screen and the agent never has it.
 */
const POLICY_PANEL_COPY: Record<string, { title: string; text: string }> = {
  "POL-114": {
    title: "Team event allocation",
    text: "Team events over $2,500 must be allocated to an events cost center before approval",
  },
};

function PolicyPanel({
  report,
  onAllocate,
}: {
  report: ExpenseReport;
  onAllocate: () => void;
}) {
  const open = report.holds.filter((h) => h.status === "open");
  const resolved = report.holds.filter((h) => h.status === "resolved");
  const emitted = useRef<string | null>(null);

  // What the user can read here is captured as screen.context, once per view.
  useEffect(() => {
    const hold = open[0];
    if (!hold) return;
    const key = `${report.id}:${hold.code}`;
    if (emitted.current === key) return;
    emitted.current = key;
    const copy = POLICY_PANEL_COPY[hold.code];
    emitScreenContext(`Policy panel: ${copy?.text ?? hold.code}`, {
      panel: "Policy",
      reportId: report.id,
      employee: report.employeeName,
      holdCode: hold.code,
      holdTitle: copy?.title,
      text: copy?.text,
      category: report.category,
      total: report.total,
      threshold: 2500,
      costCenter: report.costCenterId,
    });
  }, [open, report]);

  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-hairline px-4 py-2.5">
        {open.length ? (
          <ShieldAlert className="h-4 w-4 text-negative" />
        ) : (
          <ShieldCheck className="h-4 w-4 text-positive" />
        )}
        <h2 className="text-[0.86rem] font-semibold">Policy</h2>
        <span className="ml-auto text-[0.7rem] text-ink-muted">
          Policy engine
        </span>
      </div>
      <div className="space-y-2.5 px-4 py-3 text-[0.8rem]">
        {open.map((h) => (
          <div
            key={h.code}
            data-testid="policy-hold"
            className="rounded-lg border border-negative/25 bg-negative-soft px-3 py-2.5"
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-[0.72rem] font-semibold text-negative">
                {h.code}
              </span>
              <span className="font-semibold text-ink">
                {POLICY_PANEL_COPY[h.code]?.title ?? "Policy hold"}
              </span>
              <span className="ml-auto rounded-full bg-surface px-1.5 py-0.5 text-[0.64rem] font-semibold text-negative">
                On hold
              </span>
            </div>
            <p className="mt-1.5 text-ink">
              {POLICY_PANEL_COPY[h.code]?.text ??
                "This report needs attention before approval."}
              .
            </p>
            {report.status !== "reimbursed" ? (
              <button
                type="button"
                data-action="Allocate cost center"
                onClick={onAllocate}
                className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-negative/30 bg-surface px-2.5 py-1.5 text-[0.76rem] font-semibold text-ink hover:bg-surface-muted"
              >
                <Building2 className="h-3.5 w-3.5" /> Allocate cost center
              </button>
            ) : null}
          </div>
        ))}
        {resolved.map((h) => (
          <div
            key={h.code}
            className="flex items-center gap-2 rounded-lg border border-positive/25 bg-positive-soft px-3 py-2"
          >
            <CheckCircle2 className="h-4 w-4 text-positive" />
            <span className="font-mono text-[0.72rem] font-semibold">
              {h.code}
            </span>
            <span className="text-ink">
              {POLICY_PANEL_COPY[h.code]?.title ?? "Policy hold"}: resolved
            </span>
          </div>
        ))}
        <ul className="space-y-1 text-[0.76rem] text-ink-muted">
          <li className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-positive" /> Receipts
            attached for every line
          </li>
          <li className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-positive" /> Submitted
            within 30 days
          </li>
          <li className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-positive" /> No duplicate
            charges found
          </li>
        </ul>
      </div>
    </Card>
  );
}

function AllocateDialog({
  report,
  costCenters,
  onClose,
}: {
  report: ExpenseReport;
  costCenters: CostCenter[];
  onClose: () => void;
}) {
  const actions = useLedgerActions();
  const toast = useToast();
  const [choice, setChoice] = useState(report.costCenterId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picked = costCenters.find((c) => c.id === choice);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[hsl(210_24%_10%/0.35)] p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="allocate-title"
        className="w-full max-w-md rounded-xl border border-hairline bg-surface shadow-xl"
      >
        <div className="border-b border-hairline px-5 py-3.5">
          <h2 id="allocate-title" className="text-[0.98rem] font-semibold">
            Allocate cost center
          </h2>
          <p className="text-[0.76rem] text-ink-muted">
            {report.id}, {report.title}, {formatMoney(report.total)}
          </p>
        </div>
        <div
          role="listbox"
          aria-label="Cost centers"
          className="max-h-80 space-y-1 overflow-y-auto px-3 py-3"
        >
          {costCenters.map((c) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={choice === c.id}
              data-action={`Cost center: ${c.id} ${c.name}`}
              onClick={() => setChoice(c.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-[0.8rem]",
                choice === c.id
                  ? "border-brand bg-brand-soft"
                  : "border-transparent hover:bg-surface-muted",
              )}
            >
              <span className="font-mono text-[0.72rem] font-semibold text-ink-muted">
                {c.id}
              </span>
              <span className="flex-1 font-medium">
                {c.name}{" "}
                {c.kind === "events" ? (
                  <Badge tone="brand">Events budget</Badge>
                ) : null}
              </span>
              <span className="text-[0.7rem] text-ink-muted">{c.owner}</span>
              {c.id === report.costCenterId ? (
                <span className="text-[0.66rem] text-ink-muted">current</span>
              ) : null}
            </button>
          ))}
        </div>
        {error ? (
          <p
            role="alert"
            className="mx-5 mb-2 flex items-start gap-1.5 text-[0.76rem] text-negative"
          >
            <CircleAlert className="mt-0.5 h-3.5 w-3.5" /> {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 border-t border-hairline px-5 py-3">
          <button
            type="button"
            className={secondaryButton}
            data-action="Cancel allocation"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className={primaryButton}
            data-action="Save allocation"
            disabled={saving || !picked || choice === report.costCenterId}
            onClick={async () => {
              if (!picked) return;
              setSaving(true);
              setError(null);
              const out = await actions.allocate(
                report,
                picked.id,
                picked.name,
              );
              setSaving(false);
              if (out.ok) {
                const resolved = (out.report?.holds ?? [])
                  .filter((h) => h.status === "resolved")
                  .map((h) => h.code);
                toast({
                  tone: "ok",
                  title: `Moved to ${picked.id} ${picked.name}`,
                  body: resolved.length
                    ? `Policy hold ${resolved.join(", ")} resolved. The report can be approved.`
                    : undefined,
                });
                onClose();
              } else setError(out.message ?? "The allocation was refused.");
            }}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save allocation
          </button>
        </div>
      </div>
    </div>
  );
}

export function ReportDetailPage({ reportId }: { reportId: string }) {
  const { data } = useLedger();
  const actions = useLedgerActions();
  const toast = useToast();
  const skin = useSkin();
  const skinHref = useSkinHref(skin.id);
  const report = data.reports.find((r) => r.id === reportId.toUpperCase());
  const [allocating, setAllocating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);
  const [note, setNote] = useState("");

  if (!report) {
    return (
      <div className="mx-auto max-w-3xl rounded-xl border border-hairline bg-surface p-8 text-center text-ink-muted">
        There is no expense report {reportId}.
      </div>
    );
  }
  const cc = data.costCenters.find((c) => c.id === report.costCenterId);
  const run = async (
    what: string,
    fn: () => Promise<{
      ok: boolean;
      message?: string;
      error?: string;
      code?: string;
    }>,
    ok: string,
  ) => {
    setBusy(what);
    setBanner(null);
    const out = await fn();
    setBusy(null);
    toast(
      out.ok
        ? { tone: "ok", title: ok }
        : {
            tone: "error",
            title: "Not done",
            body:
              out.error === "POLICY_HOLD"
                ? `Policy hold ${out.code} is open. See the Policy panel.`
                : out.message,
          },
    );
    setBanner(
      out.ok
        ? { tone: "ok", text: ok }
        : {
            tone: "error",
            text:
              out.error === "POLICY_HOLD"
                ? `Approval blocked: policy hold ${out.code} is open. See the Policy panel.`
                : (out.message ?? "Refused."),
          },
    );
  };

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        href={skinHref("reports")}
        data-action="Back to expense reports"
        className="mb-3 inline-flex items-center gap-1 text-[0.78rem] font-medium text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Expense reports
      </Link>
      <PageHeader
        title={report.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{report.id}</span>
            <span>{report.employeeName}</span>
            <span>{report.category}</span>
            <StatusPill status={report.status} />
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {report.status !== "reimbursed" ? (
              <button
                type="button"
                className={secondaryButton}
                data-action="Allocate cost center"
                onClick={() => setAllocating(true)}
              >
                <Building2 className="h-4 w-4" /> Allocate cost center
              </button>
            ) : null}
            {report.status === "submitted" ? (
              <button
                type="button"
                className={primaryButton}
                data-action="Approve"
                disabled={busy !== null}
                onClick={() =>
                  void run(
                    "approve",
                    () => actions.approve(report),
                    `Approved ${report.id}.`,
                  )
                }
              >
                {busy === "approve" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Approve
              </button>
            ) : null}
            {report.status === "approved" ? (
              <button
                type="button"
                className={primaryButton}
                data-action="Reimburse"
                disabled={busy !== null}
                onClick={() =>
                  void run(
                    "reimburse",
                    () => actions.reimburse(report),
                    `Reimbursement of ${formatMoney(report.total)} scheduled.`,
                  )
                }
              >
                {busy === "reimburse" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wallet className="h-4 w-4" />
                )}
                Reimburse
              </button>
            ) : null}
          </div>
        }
      />

      {banner ? (
        <div
          role={banner.tone === "error" ? "alert" : "status"}
          className={cn(
            "mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-[0.8rem]",
            banner.tone === "ok"
              ? "border-positive/30 bg-positive-soft"
              : "border-negative/30 bg-negative-soft text-negative",
          )}
        >
          {banner.tone === "ok" ? (
            <CheckCircle2 className="h-4 w-4 text-positive" />
          ) : (
            <CircleAlert className="h-4 w-4" />
          )}
          {banner.text}
        </div>
      ) : null}

      <Timeline report={report} />

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Card>
            <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
              <h2 className="text-[0.86rem] font-semibold">Line items</h2>
              <span className="text-[0.86rem] font-semibold tabular-nums">
                {formatMoney(report.total)}
              </span>
            </div>
            <table className="w-full text-[0.8rem]">
              <tbody>
                {report.lines.map((l) => (
                  <tr
                    key={l.id}
                    className="border-b border-hairline last:border-0"
                  >
                    <td className="whitespace-nowrap px-4 py-2 text-ink-muted">
                      {formatDate(l.date)}
                    </td>
                    <td className="px-4 py-2 font-medium">{l.merchant}</td>
                    <td className="px-4 py-2 text-ink-muted">
                      {l.description}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatMoney(l.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card>
            <div className="border-b border-hairline px-4 py-2.5">
              <h2 className="text-[0.86rem] font-semibold">Notes</h2>
            </div>
            <div className="space-y-2 px-4 py-3 text-[0.8rem]">
              {report.notes.length === 0 ? (
                <p className="text-ink-muted">No notes yet.</p>
              ) : null}
              {report.notes.map((n) => (
                <div
                  key={n.id}
                  className="rounded-lg bg-surface-muted px-3 py-2"
                >
                  <div className="text-[0.7rem] font-semibold text-ink-muted">
                    {n.author}
                  </div>
                  <div>{n.text}</div>
                </div>
              ))}
              <div className="flex gap-2 pt-1">
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Add a note for the submitter"
                  className="min-w-0 flex-1 rounded-lg border border-hairline px-2.5 py-1.5 text-[0.8rem] outline-none focus:border-brand"
                />
                <button
                  type="button"
                  className={secondaryButton}
                  data-action="Add note"
                  disabled={note.trim().length < 3}
                  onClick={async () => {
                    const out = await actions.addNote(report, note);
                    if (out.ok) setNote("");
                  }}
                >
                  <MessageSquarePlus className="h-4 w-4" /> Add note
                </button>
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <PolicyPanel report={report} onAllocate={() => setAllocating(true)} />
          <Card>
            <div className="border-b border-hairline px-4 py-2.5">
              <h2 className="text-[0.86rem] font-semibold">Details</h2>
            </div>
            <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 px-4 py-3 text-[0.8rem]">
              <dt className="text-ink-muted">Employee</dt>
              <dd className="flex items-center gap-1.5">
                <Avatar name={report.employeeName} size="sm" />{" "}
                {report.employeeName}
              </dd>
              <dt className="text-ink-muted">Department</dt>
              <dd>{report.department}</dd>
              <dt className="text-ink-muted">Submitted</dt>
              <dd>{formatDate(report.submittedAt)}</dd>
              <dt className="text-ink-muted">Cost center</dt>
              <dd data-testid="report-cost-center">
                <span className="font-mono text-[0.74rem]">
                  {report.costCenterId}
                </span>{" "}
                {cc?.name}
              </dd>
              {report.approvedBy ? (
                <>
                  <dt className="text-ink-muted">Approved by</dt>
                  <dd>{report.approvedBy}</dd>
                </>
              ) : null}
              {report.reimbursement ? (
                <>
                  <dt className="text-ink-muted">Reimbursement</dt>
                  <dd>
                    ACH, {formatDate(report.reimbursement.scheduledFor)},{" "}
                    {report.reimbursement.reference}
                  </dd>
                </>
              ) : null}
            </dl>
          </Card>
        </div>
      </div>

      {allocating ? (
        <AllocateDialog
          report={report}
          costCenters={data.costCenters}
          onClose={() => setAllocating(false)}
        />
      ) : null}
    </div>
  );
}

/** Where the report is: submitted, policy check, approved, reimbursed. */
function Timeline({ report }: { report: ExpenseReport }) {
  const held = report.holds.some((h) => h.status === "open");
  const steps = [
    { label: "Submitted", done: true, detail: formatDate(report.submittedAt) },
    {
      label: "Policy check",
      done: !held,
      blocked: held,
      detail: held
        ? "On hold"
        : report.holds.length
          ? "Hold resolved"
          : "Passed",
    },
    {
      label: "Approved",
      done: report.status === "approved" || report.status === "reimbursed",
      detail: report.approvedAt ? formatDate(report.approvedAt) : "",
    },
    {
      label: "Reimbursed",
      done: report.status === "reimbursed",
      detail: report.reimbursement
        ? `ACH ${formatDate(report.reimbursement.scheduledFor)}`
        : "",
    },
  ];
  return (
    <ol
      data-testid="report-timeline"
      className="mb-4 grid grid-cols-4 gap-2 rounded-xl border border-hairline bg-surface px-4 py-3"
    >
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-2">
          <span
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[0.68rem] font-bold",
              s.blocked
                ? "bg-negative-soft text-negative"
                : s.done
                  ? "bg-brand text-brand-foreground"
                  : "bg-surface-muted text-ink-muted",
            )}
          >
            {s.blocked ? "!" : s.done ? "✓" : i + 1}
          </span>
          <div className="min-w-0">
            <div
              className={cn(
                "text-[0.78rem] font-semibold",
                !s.done && !s.blocked && "text-ink-muted",
              )}
            >
              {s.label}
            </div>
            <div
              className={cn(
                "truncate text-[0.68rem]",
                s.blocked ? "text-negative" : "text-ink-muted",
              )}
            >
              {s.detail}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
