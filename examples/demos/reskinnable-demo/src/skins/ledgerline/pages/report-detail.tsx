"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Check,
  CheckCircle2,
  CircleAlert,
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  PencilLine,
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
  Chip,
  Id,
  Money,
  StatusPill,
  ghostButton,
  primaryButton,
  secondaryButton,
  td,
  th,
} from "../components/ui";
import { useToast } from "../components/toast";
import { emitChoice, emitScreenContext } from "../learning/recorder";

/**
 * One report: lines in the main column, an inspector rail on the right.
 *
 * The detective path (beat 3). The rail's Policy section shows only "POL-114 ·
 * Allocation required" and a "View policy" link: no rule text, no fix button.
 * The rule is on the policy page, the budget types on the Cost centers page.
 * Approve stays disabled while the hold is open. "⋯ > Edit coding" recodes
 * individual lines; saving re-runs the policy check, visibly.
 */

type Phase = "idle" | "editing" | "checking";

export function ReportDetailPage({ reportId }: { reportId: string }) {
  const { data } = useLedger();
  const actions = useLedgerActions();
  const toast = useToast();
  const skin = useSkin();
  const skinHref = useSkinHref(skin.id);
  const report = data.reports.find((r) => r.id === reportId.toUpperCase());
  const [phase, setPhase] = useState<Phase>("idle");
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [checkResult, setCheckResult] = useState<{
    status: "open" | "resolved";
    reason?: string;
  } | null>(null);
  const [note, setNote] = useState("");
  const emitted = useRef<string | null>(null);

  const hold = report?.holds.find((h) => h.status === "open");

  // What the person can read in the rail is captured as screen.context, once per view.
  useEffect(() => {
    if (!report || !hold) return;
    const key = `${report.id}:${hold.code}`;
    if (emitted.current === key) return;
    emitted.current = key;
    emitScreenContext(`Policy: ${hold.code} · Allocation required`, {
      panel: "Policy",
      reportId: report.id,
      employee: report.employeeName,
      holdCode: hold.code,
      status: "Allocation required",
      // What the agent is also told in its POLICY_HOLD refusal, so this panel
      // is not counted as context the agent never had.
      text: `${hold.code} (allocation required)`,
      category: report.category,
      total: report.total,
    });
  }, [report, hold]);

  if (!report) {
    return (
      <div className="mx-auto max-w-3xl py-16 text-center text-[13px] text-ink-muted">
        There is no expense report {reportId}.
      </div>
    );
  }

  const run = async (
    what: string,
    fn: () => Promise<{ ok: boolean; message?: string }>,
    ok: string,
    body?: string,
  ) => {
    setBusy(what);
    const out = await fn();
    setBusy(null);
    toast(
      out.ok
        ? { tone: "ok", title: ok, body }
        : { tone: "error", title: "Not done", body: out.message },
    );
  };

  const activity = data.activity
    .filter((a) => a.reportId === report.id)
    .slice(0, 6);

  return (
    <div className="mx-auto max-w-[1280px]">
      {/* Title row */}
      <div className="mb-5 flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-[22px] font-semibold tracking-[-0.015em]">
              {report.title}
            </h1>
            <StatusPill status={report.status} />
            {hold ? (
              <Chip tone="red">
                <ShieldAlert className="h-3 w-3" /> On hold
              </Chip>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-muted">
            <Id>{report.id}</Id>
            <span className="flex items-center gap-1.5">
              <Avatar name={report.employeeName} size="sm" />{" "}
              {report.employeeName}
            </span>
            <span>{report.department}</span>
            <span>{report.category}</span>
            <span>Submitted {formatDate(report.submittedAt)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              type="button"
              aria-label="More actions"
              aria-expanded={menu}
              data-action="More actions"
              onClick={() => setMenu((v) => !v)}
              className={cn(secondaryButton, "w-8 px-0")}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {menu ? (
              <div
                role="menu"
                className="absolute right-0 top-9 z-40 w-48 overflow-hidden rounded-lg border border-hairline bg-surface py-1"
                style={{ boxShadow: "var(--ll-shadow)" }}
              >
                <button
                  type="button"
                  role="menuitem"
                  data-action="Edit coding"
                  disabled={report.status !== "submitted"}
                  onClick={() => {
                    setMenu(false);
                    setCheckResult(null);
                    setPhase("editing");
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-surface-muted disabled:opacity-40"
                >
                  <PencilLine className="h-3.5 w-3.5 text-ink-muted" /> Edit
                  coding
                </button>
                <a
                  href="#notes"
                  role="menuitem"
                  data-action="Add note"
                  onClick={() => setMenu(false)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-surface-muted"
                >
                  <MessageSquarePlus className="h-3.5 w-3.5 text-ink-muted" />{" "}
                  Add note
                </a>
              </div>
            ) : null}
          </div>
          {report.status === "submitted" ? (
            <span className="group relative">
              <button
                type="button"
                data-action="Approve"
                disabled={!!hold || busy !== null || phase === "checking"}
                aria-describedby={hold ? "approve-tip" : undefined}
                onClick={() =>
                  void run(
                    "approve",
                    () => actions.approve(report),
                    `Approved ${report.id}`,
                    "Ready to reimburse.",
                  )
                }
                className={primaryButton}
              >
                {busy === "approve" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                Approve
              </button>
              {hold ? (
                <span
                  id="approve-tip"
                  role="tooltip"
                  className="pointer-events-none absolute right-0 top-10 z-30 hidden whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[12px] text-white group-hover:block"
                >
                  Resolve the policy hold first
                </span>
              ) : null}
            </span>
          ) : null}
          {report.status === "approved" ? (
            <button
              type="button"
              data-action="Reimburse"
              disabled={busy !== null}
              onClick={() =>
                void run(
                  "reimburse",
                  () => actions.reimburse(report),
                  "Reimbursement scheduled",
                  `${formatMoney(report.total)} to ${report.employeeName} by ACH.`,
                )
              }
              className={primaryButton}
            >
              {busy === "reimburse" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Wallet className="h-3.5 w-3.5" />
              )}
              Reimburse
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 @[900px]:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-6">
          {/* The total and the path it travels */}
          <div className="flex flex-wrap items-end justify-between gap-6 border-b border-hairline pb-5">
            <div>
              <div className="text-[12px] text-ink-muted">Report total</div>
              <Money
                value={report.total}
                className="mt-1 block text-[40px] font-semibold leading-none tracking-[-0.03em]"
              />
            </div>
            <Steps report={report} checking={phase === "checking"} />
          </div>

          {phase === "editing" || phase === "checking" ? (
            <CodingEditor
              report={report}
              centers={data.costCenters}
              checking={phase === "checking"}
              result={checkResult}
              onCancel={() => {
                setPhase("idle");
                setCheckResult(null);
              }}
              onSave={async (changes) => {
                setPhase("checking");
                setCheckResult(null);
                const [out] = await Promise.all([
                  actions.recode(report, changes, data.costCenters),
                  new Promise((r) => setTimeout(r, 1100)),
                ]);
                if (!out.ok) {
                  setPhase("editing");
                  setCheckResult({ status: "open", reason: out.message });
                  return;
                }
                if (out.check?.status === "resolved") {
                  setPhase("idle");
                  setCheckResult(null);
                  toast({
                    tone: "ok",
                    title: `${out.check.code} resolved`,
                    body: "The coding passes the policy check. Approve is ready.",
                  });
                } else {
                  setPhase("editing");
                  setCheckResult({ status: "open", reason: out.check?.reason });
                }
              }}
            />
          ) : (
            <LinesTable report={report} centers={data.costCenters} />
          )}

          <section id="notes">
            <h2 className="mb-2 text-[13px] font-semibold">Notes</h2>
            <div className="space-y-2">
              {report.notes.length === 0 ? (
                <p className="text-[13px] text-[hsl(var(--ll-faint))]">
                  No notes yet.
                </p>
              ) : null}
              {report.notes.map((n) => (
                <div
                  key={n.id}
                  className="rounded-lg border border-hairline px-3 py-2 text-[13px]"
                >
                  <div className="text-[12px] font-medium text-ink-muted">
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
                  aria-label="Note"
                  className="h-8 min-w-0 flex-1 rounded-md border border-hairline px-2.5 text-[13px] outline-none placeholder:text-[hsl(var(--ll-faint))] focus:border-brand"
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
                  Add note
                </button>
              </div>
            </div>
          </section>
        </div>

        {/* Inspector rail */}
        <aside className="order-first grid gap-5 rounded-[10px] border border-hairline bg-surface-muted/50 p-4 @[560px]:grid-cols-2 @[900px]:order-none @[900px]:block @[900px]:space-y-5 @[900px]:rounded-none @[900px]:border-0 @[900px]:border-l @[900px]:bg-transparent @[900px]:p-0 @[900px]:pl-6">
          <PolicySection
            report={report}
            checking={phase === "checking"}
            policyHref={skinHref("policies/POL-114")}
          />
          <CodingSummary report={report} centers={data.costCenters} />
          <section>
            <h3 className="mb-2 text-[12px] font-medium text-ink-muted">
              Details
            </h3>
            <dl className="grid grid-cols-[96px_1fr] gap-y-1.5 text-[13px]">
              <dt className="text-[hsl(var(--ll-faint))]">Employee</dt>
              <dd>{report.employeeName}</dd>
              <dt className="text-[hsl(var(--ll-faint))]">Department</dt>
              <dd>{report.department}</dd>
              <dt className="text-[hsl(var(--ll-faint))]">Submitted</dt>
              <dd>{formatDate(report.submittedAt)}</dd>
              {report.approvedBy ? (
                <>
                  <dt className="text-[hsl(var(--ll-faint))]">Approved by</dt>
                  <dd>{report.approvedBy}</dd>
                </>
              ) : null}
              {report.reimbursement ? (
                <>
                  <dt className="text-[hsl(var(--ll-faint))]">Paid</dt>
                  <dd>
                    ACH {formatDate(report.reimbursement.scheduledFor)}{" "}
                    <Id>{report.reimbursement.reference}</Id>
                  </dd>
                </>
              ) : null}
            </dl>
          </section>
          {activity.length ? (
            <section>
              <h3 className="mb-2 text-[12px] font-medium text-ink-muted">
                Activity
              </h3>
              <ol className="space-y-2 border-l border-hairline pl-3">
                {activity.map((a) => (
                  <li key={a.id} className="text-[12.5px]">
                    <span className="font-medium">{a.actor}</span>{" "}
                    <span className="text-ink-muted">{a.text}</span>
                    <div className="text-[11px] text-[hsl(var(--ll-faint))]">
                      {formatDate(a.at.slice(0, 10))}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function ccName(centers: CostCenter[], id: string) {
  return centers.find((c) => c.id === id)?.name ?? id;
}

function LinesTable({
  report,
  centers,
}: {
  report: ExpenseReport;
  centers: CostCenter[];
}) {
  return (
    <section>
      <h2 className="mb-2 text-[13px] font-semibold">Lines</h2>
      <div className="overflow-hidden rounded-[10px] border border-hairline">
        <table className="w-full">
          <thead>
            <tr>
              <th className={th}>Date</th>
              <th className={th}>Merchant</th>
              <th className={th}>Description</th>
              <th className={th}>Cost center</th>
              <th className={cn(th, "text-right")}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {report.lines.map((l) => (
              <tr
                key={l.id}
                className="last:[&>td]:border-0 hover:bg-surface-muted/60"
              >
                <td className={cn(td, "whitespace-nowrap text-ink-muted")}>
                  {formatDate(l.date)}
                </td>
                <td className={cn(td, "font-medium")}>{l.merchant}</td>
                <td className={cn(td, "text-ink-muted")}>{l.description}</td>
                <td className={cn(td, "whitespace-nowrap")}>
                  <Id className="mr-1.5">{l.costCenterId}</Id>
                  {ccName(centers, l.costCenterId)}
                </td>
                <td className={cn(td, "text-right")}>
                  <Money value={l.amount} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CodingEditor({
  report,
  centers,
  checking,
  result,
  onCancel,
  onSave,
}: {
  report: ExpenseReport;
  centers: CostCenter[];
  checking: boolean;
  result: { status: "open" | "resolved"; reason?: string } | null;
  onCancel: () => void;
  onSave: (
    changes: { lineId: string; costCenterId: string }[],
  ) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(report.lines.map((l) => [l.id, l.costCenterId])),
  );
  const changes = useMemo(
    () =>
      report.lines
        .filter((l) => draft[l.id] !== l.costCenterId)
        .map((l) => ({ lineId: l.id, costCenterId: draft[l.id]! })),
    [draft, report.lines],
  );
  return (
    <section data-testid="coding-editor">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold">Edit coding</h2>
        <span className="text-[12px] text-[hsl(var(--ll-faint))]">
          Choose the cost center each line is charged to
        </span>
      </div>
      <div className="overflow-hidden rounded-[10px] border border-brand/40 ring-4 ring-brand-soft">
        <table className="w-full">
          <thead>
            <tr>
              <th className={th}>Line</th>
              <th className={th}>Cost center</th>
              <th className={cn(th, "text-right")}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {report.lines.map((l) => (
              <tr key={l.id}>
                <td className={td}>
                  <div className="font-medium">{l.description}</div>
                  <div className="text-[12px] text-[hsl(var(--ll-faint))]">
                    {l.merchant}
                  </div>
                </td>
                <td className={td}>
                  <select
                    aria-label={`Cost center for ${l.description}`}
                    value={draft[l.id]}
                    disabled={checking}
                    onChange={(e) => {
                      const id = e.target.value;
                      setDraft((d) => ({ ...d, [l.id]: id }));
                      emitChoice(
                        `Code ${l.description} to ${id} ${ccName(centers, id)}`,
                        { lineId: l.id, costCenter: id },
                      );
                    }}
                    className={cn(
                      "h-8 w-full max-w-[260px] rounded-md border bg-surface px-2 text-[13px] outline-none focus:border-brand",
                      draft[l.id] !== l.costCenterId
                        ? "border-brand text-ink"
                        : "border-hairline",
                    )}
                  >
                    {centers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.id} {c.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className={cn(td, "text-right")}>
                  <Money value={l.amount} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {result?.status === "open" ? (
          <div
            role="alert"
            data-testid="recode-reason"
            className="flex items-start gap-2 border-t border-negative/20 bg-negative-soft px-4 py-2.5 text-[13px] text-negative"
          >
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <span className="font-semibold">POL-114 still open.</span>{" "}
              {result.reason ?? "The coding does not satisfy the policy."}
            </span>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-2 border-t border-hairline bg-surface-muted px-4 py-2.5">
          <span className="text-[12px] text-ink-muted">
            {checking ? (
              <span className="flex items-center gap-1.5 text-brand-indigo">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Re-checking
                policy...
              </span>
            ) : changes.length ? (
              `${changes.length} line${changes.length === 1 ? "" : "s"} recoded`
            ) : (
              "No changes yet"
            )}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              data-action="Cancel coding"
              className={ghostButton}
              disabled={checking}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              data-action="Save coding"
              className={primaryButton}
              disabled={checking || changes.length === 0}
              onClick={() => void onSave(changes)}
            >
              Save coding
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function PolicySection({
  report,
  checking,
  policyHref,
}: {
  report: ExpenseReport;
  checking: boolean;
  policyHref: string;
}) {
  const open = report.holds.filter((h) => h.status === "open");
  const resolved = report.holds.filter((h) => h.status === "resolved");
  return (
    <section data-testid="policy-section">
      <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-ink-muted">
        {open.length ? (
          <ShieldAlert className="h-3.5 w-3.5 text-negative" />
        ) : (
          <ShieldCheck className="h-3.5 w-3.5 text-positive" />
        )}{" "}
        Policy
      </h3>
      <div className="space-y-2">
        {open.map((h) => (
          <div
            key={h.code}
            data-testid="policy-hold"
            className={cn(
              "rounded-lg border border-negative/25 px-3 py-2.5",
              checking ? "ll-recheck" : "bg-negative-soft",
            )}
          >
            <div className="flex items-center gap-2 text-[13px]">
              <span className="ll-mono font-semibold text-negative">
                {h.code}
              </span>
              <span className="text-ink">Allocation required</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[12px]">
              <span className="text-ink-muted">
                {checking
                  ? "Re-checking policy..."
                  : "Approval is held until this clears."}
              </span>
              <Link
                href={policyHref}
                data-action="View policy"
                className="font-medium text-brand hover:underline"
              >
                View policy
              </Link>
            </div>
          </div>
        ))}
        {resolved.map((h) => (
          <div
            key={h.code}
            data-testid="policy-resolved"
            className="flex items-center gap-2 rounded-lg border border-positive/25 bg-positive-soft px-3 py-2 text-[13px]"
          >
            <CheckCircle2 className="h-4 w-4 text-positive" />
            <span className="ll-mono font-semibold">{h.code}</span>
            <span>resolved</span>
          </div>
        ))}
        <ul className="space-y-1 pt-1 text-[12.5px] text-ink-muted">
          {[
            "Receipts attached for every line",
            "Submitted within 30 days",
            "No duplicate charges",
          ].map((t) => (
            <li key={t} className="flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-positive" /> {t}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function CodingSummary({
  report,
  centers,
}: {
  report: ExpenseReport;
  centers: CostCenter[];
}) {
  const by = new Map<string, number>();
  for (const l of report.lines)
    by.set(l.costCenterId, (by.get(l.costCenterId) ?? 0) + l.amount);
  return (
    <section>
      <h3 className="mb-2 text-[12px] font-medium text-ink-muted">Coding</h3>
      <ul className="space-y-1.5 text-[13px]">
        {[...by.entries()].map(([id, amt]) => (
          <li key={id} className="flex items-center justify-between gap-2">
            <span className="truncate">
              <Id className="mr-1.5">{id}</Id>
              {ccName(centers, id)}
            </span>
            <Money value={amt} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Submitted, policy check, approved, reimbursed: a compact stepper. */
function Steps({
  report,
  checking,
}: {
  report: ExpenseReport;
  checking: boolean;
}) {
  const held = report.holds.some((h) => h.status === "open");
  const steps = [
    { label: "Submitted", state: "done" as const },
    {
      label: checking ? "Re-checking" : held ? "Policy hold" : "Policy check",
      state: checking
        ? ("live" as const)
        : held
          ? ("blocked" as const)
          : ("done" as const),
    },
    {
      label: "Approved",
      state:
        report.status === "approved" || report.status === "reimbursed"
          ? ("done" as const)
          : ("todo" as const),
    },
    {
      label: "Reimbursed",
      state:
        report.status === "reimbursed" ? ("done" as const) : ("todo" as const),
    },
  ];
  return (
    <ol
      data-testid="report-timeline"
      className="flex items-center gap-1.5 text-[12px]"
    >
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-1.5">
          {i > 0 ? (
            <span
              aria-hidden
              className={cn(
                "h-px w-6",
                s.state === "done" ? "bg-ink" : "bg-hairline",
              )}
            />
          ) : null}
          <span
            className={cn(
              "flex h-5 items-center gap-1 rounded-[5px] px-1.5 font-medium",
              s.state === "done" && "bg-surface-muted text-ink",
              s.state === "blocked" && "bg-negative-soft text-negative",
              s.state === "live" && "bg-brand-soft text-brand-indigo",
              s.state === "todo" && "text-[hsl(var(--ll-faint))]",
            )}
          >
            {s.state === "done" ? (
              <Check className="h-3 w-3" />
            ) : s.state === "live" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : null}
            {s.label}
          </span>
        </li>
      ))}
    </ol>
  );
}
