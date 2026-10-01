"use client";

/**
 * Ledgerline's generative-UI cards. ONE SOURCE for two hosts: the in-app chat
 * (tool renders in `tools.tsx`) and the MCP app ChatGPT renders
 * (`mcp-app/main.tsx`, bundled by `scripts/build-ledgerline-mcp-app.mjs`).
 * So nothing here may import Next, CopilotKit or the browser recorder: the
 * cards take data and callbacks, and the host wires them.
 *
 * The policy-hold card names the hold CODE and its status only. What clears it
 * is shown nowhere but the report page's Policy panel.
 */

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney } from "../data/format";
import type { ReportStatus } from "../data/types";
import {
  Avatar,
  Badge,
  StatusPill,
  primaryButton,
  secondaryButton,
} from "../components/ui";
import { fitColumns } from "./fit-columns";
import type { ApproveOutcome, ReportRowView, ReportView } from "./views";

const frame =
  "my-1.5 overflow-hidden rounded-2xl border border-hairline bg-surface text-[0.8rem] text-ink shadow-sm";

// ── Reports table ────────────────────────────────────────────────────────────

type ColKey =
  | "report"
  | "employee"
  | "total"
  | "status"
  | "submitted"
  | "category";
const COLUMNS: {
  key: ColKey;
  label: string;
  minWidth: number;
  priority: number;
}[] = [
  { key: "report", label: "Report", minWidth: 128, priority: 1 },
  { key: "employee", label: "Employee", minWidth: 100, priority: 2 },
  { key: "total", label: "Total", minWidth: 78, priority: 1 },
  { key: "status", label: "Status", minWidth: 120, priority: 3 },
  { key: "submitted", label: "Submitted", minWidth: 80, priority: 4 },
  { key: "category", label: "Category", minWidth: 110, priority: 5 },
];
const PAGE_SIZE = 6;

function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(420);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setWidth(e?.contentRect.width ?? 420),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function StatusCell({ r }: { r: ReportRowView }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      <StatusPill status={r.status as ReportStatus} />
      {r.openHolds.length ? (
        <Badge tone="negative">
          <ShieldAlert className="h-3 w-3" /> {r.openHolds.join(", ")}
        </Badge>
      ) : null}
    </span>
  );
}

function cell(key: ColKey, r: ReportRowView) {
  switch (key) {
    case "report":
      return (
        <div className="min-w-0">
          <div className="truncate font-medium">{r.title}</div>
          <div className="font-mono text-[0.68rem] text-ink-muted">{r.id}</div>
        </div>
      );
    case "employee":
      return (
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <Avatar name={r.employee} size="sm" /> {r.employee}
        </span>
      );
    case "total":
      return (
        <span className="font-semibold tabular-nums">
          {formatMoney(r.total)}
        </span>
      );
    case "status":
      return <StatusCell r={r} />;
    case "submitted":
      return (
        <span className="text-ink-muted">{formatDate(r.submittedAt)}</span>
      );
    case "category":
      return <span className="text-ink-muted">{r.category}</span>;
  }
}

/** A paged report list that fits the chat column: columns that do not fit fold into each row. */
export function ReportTable({
  title,
  rows,
  onOpen,
}: {
  title: string;
  rows: ReportRowView[];
  onOpen?: (id: string) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const fit = fitColumns(COLUMNS, width, 28);
  const visible = COLUMNS.filter((c) => fit.visible.includes(c.key));
  const hidden = COLUMNS.filter((c) => fit.hidden.includes(c.key));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const shown = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const total = rows.reduce((a, r) => a + r.total, 0);
  const held = rows.filter((r) => r.openHolds.length).length;

  return (
    <div ref={ref} data-testid="ledgerline-report-table" className={frame}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline px-3.5 py-2.5">
        <div className="font-semibold">{title}</div>
        <div className="text-[0.72rem] text-ink-muted">
          <span className="font-semibold text-ink">{rows.length}</span> reports
          · <span className="font-semibold text-ink">{formatMoney(total)}</span>
          {held ? (
            <>
              {" "}
              ·{" "}
              <span className="font-semibold text-negative">
                {held} on hold
              </span>
            </>
          ) : null}
        </div>
      </div>
      <table className="w-full table-fixed">
        <thead className="text-[0.64rem] uppercase tracking-[0.05em] text-ink-muted">
          <tr className="border-b border-hairline text-left">
            {visible.map((c) => (
              <th
                key={c.key}
                className={cn(
                  "px-3 py-1.5 font-medium",
                  c.key === "total" && "text-right",
                )}
              >
                {c.label}
              </th>
            ))}
            {hidden.length ? <th className="w-7" /> : null}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <FragmentRow
              key={r.id}
              r={r}
              visible={visible.map((c) => c.key)}
              hidden={hidden}
              expanded={open === r.id}
              onToggle={() => setOpen(open === r.id ? null : r.id)}
              onOpen={onOpen}
            />
          ))}
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={visible.length + 1}
                className="px-3 py-5 text-center text-ink-muted"
              >
                No reports match.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      {pages > 1 ? (
        <div className="flex items-center justify-between border-t border-hairline px-3 py-1.5 text-[0.72rem] text-ink-muted">
          <span>
            Page {page + 1} of {pages}
          </span>
          <span className="flex gap-1">
            <button
              type="button"
              aria-label="Previous page"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
              className="rounded p-1 hover:bg-surface-muted disabled:opacity-30"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="Next page"
              disabled={page >= pages - 1}
              onClick={() => setPage(page + 1)}
              className="rounded p-1 hover:bg-surface-muted disabled:opacity-30"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </span>
        </div>
      ) : null}
    </div>
  );
}

function FragmentRow({
  r,
  visible,
  hidden,
  expanded,
  onToggle,
  onOpen,
}: {
  r: ReportRowView;
  visible: ColKey[];
  hidden: { key: ColKey; label: string }[];
  expanded: boolean;
  onToggle: () => void;
  onOpen?: (id: string) => void;
}) {
  return (
    <>
      <tr className="border-b border-hairline align-middle last:border-0">
        {visible.map((k) => (
          <td
            key={k}
            className={cn("px-3 py-2", k === "total" && "text-right")}
          >
            {k === "report" && onOpen ? (
              <button
                type="button"
                className="w-full text-left hover:text-brand"
                onClick={() => onOpen(r.id)}
              >
                {cell(k, r)}
              </button>
            ) : (
              cell(k, r)
            )}
          </td>
        ))}
        {hidden.length ? (
          <td className="px-1">
            <button
              type="button"
              aria-label="More"
              aria-expanded={expanded}
              onClick={onToggle}
              className="rounded p-1 text-ink-muted hover:bg-surface-muted"
            >
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 transition-transform",
                  expanded && "rotate-180",
                )}
              />
            </button>
          </td>
        ) : null}
      </tr>
      {expanded && hidden.length ? (
        <tr className="border-b border-hairline bg-surface-muted/60">
          <td colSpan={visible.length + 1} className="px-3 py-2">
            <dl className="grid grid-cols-[90px_1fr] gap-y-1 text-[0.74rem]">
              {hidden.map((c) => (
                <div key={c.key} className="contents">
                  <dt className="text-ink-muted">{c.label}</dt>
                  <dd>{cell(c.key, r)}</dd>
                </div>
              ))}
            </dl>
          </td>
        </tr>
      ) : null}
    </>
  );
}

// ── Report card ─────────────────────────────────────────────────────────────

function PolicyStatus({ report }: { report: ReportView }) {
  const open = report.holds.filter((h) => h.status === "open");
  const resolved = report.holds.filter((h) => h.status === "resolved");
  if (open.length) {
    return (
      <Badge tone="negative">
        <ShieldAlert className="h-3 w-3" /> Policy hold{" "}
        {open.map((h) => h.code).join(", ")}
      </Badge>
    );
  }
  return (
    <Badge tone="positive">
      <ShieldCheck className="h-3 w-3" />{" "}
      {resolved.length
        ? `${resolved.map((h) => h.code).join(", ")} resolved`
        : "Policy check passed"}
    </Badge>
  );
}

/** One report: who, how much, where it is charged, its lines and its policy status. */
export function ReportCard({
  report,
  onOpen,
}: {
  report: ReportView;
  onOpen?: (id: string) => void;
}) {
  return (
    <div data-testid="ledgerline-report-card" className={frame}>
      <div className="flex items-start gap-3 border-b border-hairline px-3.5 py-3">
        <Avatar name={report.employee} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{report.title}</div>
          <div className="text-[0.72rem] text-ink-muted">
            {report.employee} · {report.department} · {report.category} ·{" "}
            <span className="font-mono">{report.id}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <StatusPill status={report.status as ReportStatus} />
            <PolicyStatus report={report} />
          </div>
        </div>
        <div className="text-right">
          <div className="text-[1.05rem] font-semibold tabular-nums">
            {formatMoney(report.total)}
          </div>
          <div className="text-[0.68rem] text-ink-muted">
            submitted {formatDate(report.submittedAt)}
          </div>
        </div>
      </div>
      <ul className="px-3.5 py-2">
        {report.lines.map((l, i) => (
          <li
            key={i}
            className="flex items-baseline gap-2 py-0.5 text-[0.76rem]"
          >
            <span className="w-12 shrink-0 text-ink-muted">
              {formatDate(l.date)}
            </span>
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{l.merchant}</span>{" "}
              <span className="text-ink-muted">{l.description}</span>
            </span>
            <span className="tabular-nums">{formatMoney(l.amount)}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between border-t border-hairline px-3.5 py-2 text-[0.74rem]">
        <span>
          <span className="text-ink-muted">Cost center </span>
          <span className="font-mono">{report.costCenter.id}</span>{" "}
          {report.costCenter.name}
        </span>
        {onOpen ? (
          <button
            type="button"
            className="font-semibold text-brand hover:underline"
            onClick={() => onOpen(report.id)}
          >
            Open report
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ── Policy hold ─────────────────────────────────────────────────────────────

/** An approval the policy engine refused: the code and that it is on hold. Never the fix. */
export function HoldCard({
  reportId,
  code,
  employee,
  total,
}: {
  reportId: string;
  code: string;
  employee?: string;
  total?: number;
}) {
  return (
    <div
      data-testid="ledgerline-hold-card"
      className="my-1.5 flex items-start gap-2.5 rounded-2xl border border-negative/30 bg-negative-soft px-3.5 py-2.5 text-[0.8rem]"
    >
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-negative" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">Approval blocked</span>
          <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-[0.7rem] font-semibold text-negative">
            {code}
          </span>
          <span className="rounded-full bg-surface px-1.5 py-0.5 text-[0.64rem] font-semibold text-negative">
            On hold
          </span>
        </div>
        <div className="mt-0.5 text-[0.74rem] text-ink-muted">
          <span className="font-mono">{reportId}</span>
          {employee ? ` · ${employee}` : ""}
          {typeof total === "number" ? ` · ${formatMoney(total)}` : ""} · the
          policy engine holds this report
        </div>
      </div>
    </div>
  );
}

// ── Approve and reimburse (HITL) ────────────────────────────────────────────

/** The one confirmation for the write: approve, then schedule the ACH payment. */
export function ApproveReimburseCard({
  report,
  paymentRun,
  outcome,
  submit,
  onSettle,
  onCancel,
}: {
  report: ReportView;
  paymentRun: string;
  outcome?: ApproveOutcome | "cancelled" | null;
  submit: () => Promise<ApproveOutcome>;
  onSettle: (o: ApproveOutcome) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [sending, setSending] = useState(false);
  const held = report.holds.some((h) => h.status === "open");
  if (outcome === "cancelled") {
    return (
      <div className={cn(frame, "px-3.5 py-2.5 text-ink-muted")}>
        Cancelled. Nothing was approved or paid.
      </div>
    );
  }
  if (outcome) {
    return (
      <div
        data-testid="ledgerline-approve-settled"
        className={cn(frame, "flex items-start gap-2 px-3.5 py-2.5")}
      >
        {outcome.ok ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-positive" />
        ) : (
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-negative" />
        )}
        <span>{outcome.summary}</span>
      </div>
    );
  }
  return (
    <div data-testid="ledgerline-approve-card" className={frame}>
      <div className="flex items-center gap-2 border-b border-hairline px-3.5 py-2.5 font-semibold">
        <Wallet className="h-4 w-4 text-brand" /> Approve and reimburse
      </div>
      <dl className="grid grid-cols-[100px_1fr] gap-y-1.5 px-3.5 py-2.5 text-[0.78rem]">
        <dt className="text-ink-muted">Report</dt>
        <dd>
          {report.title}{" "}
          <span className="font-mono text-[0.7rem] text-ink-muted">
            {report.id}
          </span>
        </dd>
        <dt className="text-ink-muted">Payee</dt>
        <dd className="flex items-center gap-1.5">
          <Avatar name={report.employee} size="sm" /> {report.employee}
        </dd>
        <dt className="text-ink-muted">Amount</dt>
        <dd className="font-semibold tabular-nums">
          {formatMoney(report.total)}
        </dd>
        <dt className="text-ink-muted">Charged to</dt>
        <dd>
          <span className="font-mono">{report.costCenter.id}</span>{" "}
          {report.costCenter.name}
        </dd>
        <dt className="text-ink-muted">Policy</dt>
        <dd>
          <PolicyStatus report={report} />
        </dd>
        <dt className="text-ink-muted">Payment</dt>
        <dd>ACH on the {formatDate(paymentRun)} run</dd>
      </dl>
      <div className="flex gap-2 border-t border-hairline px-3.5 py-2.5">
        <button
          type="button"
          data-testid="ledgerline-approve-confirm"
          className={primaryButton}
          disabled={sending}
          onClick={async () => {
            setSending(true);
            const o = await submit();
            setSending(false);
            await onSettle(o);
          }}
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          Approve and reimburse
        </button>
        <button
          type="button"
          className={secondaryButton}
          disabled={sending}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
      {held ? (
        <div className="px-3.5 pb-2.5 text-[0.72rem] text-negative">
          A policy hold is still open, so approval will be refused.
        </div>
      ) : null}
    </div>
  );
}
