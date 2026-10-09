"use client";

/**
 * Ledgerline's generative-UI cards, "crisp ledger". ONE SOURCE for two hosts:
 * the in-app chat (tool renders in `tools.tsx`) and the MCP app ChatGPT
 * renders (`mcp-app/main.tsx`, bundled by `scripts/build-ledgerline-mcp-app.mjs`).
 * So nothing here may import Next, CopilotKit or the browser recorder: the
 * cards take data and callbacks, and the host wires them.
 *
 * The policy-hold card names the hold CODE and that it is on hold. What clears
 * it is shown nowhere but the app's policy and cost-center pages.
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
  Chip,
  Id,
  Money,
  StatusPill,
  primaryButton,
  secondaryButton,
} from "../components/ui";
import { fitColumns } from "./fit-columns";
import type { ApproveOutcome, ReportRowView, ReportView } from "./views";

const frame =
  "my-2 overflow-hidden rounded-[10px] border border-hairline bg-surface text-[13px] text-ink";

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
  { key: "total", label: "Amount", minWidth: 78, priority: 1 },
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

function cell(key: ColKey, r: ReportRowView) {
  switch (key) {
    case "report":
      return (
        <div className="min-w-0">
          <div className="truncate font-medium">{r.title}</div>
          <Id className="text-[11px]">{r.id}</Id>
        </div>
      );
    case "employee":
      return (
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <Avatar name={r.employee} size="sm" /> {r.employee}
        </span>
      );
    case "total":
      return <Money value={r.total} className="font-medium" />;
    case "status":
      return (
        <span className="flex flex-wrap items-center gap-1">
          <StatusPill status={r.status as ReportStatus} />
          {r.openHolds.length ? (
            <Chip tone="red">
              <ShieldAlert className="h-3 w-3" /> {r.openHolds.join(", ")}
            </Chip>
          ) : null}
        </span>
      );
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
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-3.5 pb-2 pt-3">
        <div className="font-semibold">{title}</div>
        <div className="ll-num text-[12px] text-ink-muted">
          {rows.length} reports · <Money value={total} />
          {held ? (
            <span className="text-negative">, {held} on hold</span>
          ) : null}
        </div>
      </div>
      <table className="w-full table-fixed">
        <thead className="bg-surface-muted text-[11.5px] text-[hsl(var(--ll-faint))]">
          <tr className="border-y border-hairline text-left">
            {visible.map((c) => (
              <th
                key={c.key}
                className={cn(
                  "h-7 px-3 font-medium",
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
            <Row
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
        <div className="flex items-center justify-between border-t border-hairline px-3 py-1.5 text-[12px] text-ink-muted">
          <span className="ll-num">
            {page * PAGE_SIZE + 1} to{" "}
            {Math.min(rows.length, (page + 1) * PAGE_SIZE)} of {rows.length}
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

function Row({
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
      <tr
        className={cn(
          "border-b border-hairline align-middle last:border-0 hover:bg-brand-soft/50",
          r.openHolds.length && "bg-negative-soft/40",
        )}
      >
        {visible.map((k) => (
          <td
            key={k}
            className={cn("h-11 px-3", k === "total" && "text-right")}
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
            <dl className="grid grid-cols-[84px_1fr] gap-y-1 text-[12.5px]">
              {hidden.map((c) => (
                <div key={c.key} className="contents">
                  <dt className="text-[hsl(var(--ll-faint))]">{c.label}</dt>
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
      <Chip tone="red">
        <ShieldAlert className="h-3 w-3" /> {open.map((h) => h.code).join(", ")}{" "}
        · Allocation required
      </Chip>
    );
  }
  return (
    <Chip tone="green">
      <ShieldCheck className="h-3 w-3" />{" "}
      {resolved.length
        ? `${resolved.map((h) => h.code).join(", ")} resolved`
        : "Policy check passed"}
    </Chip>
  );
}

function codingSummary(report: ReportView) {
  const by = new Map<string, { name: string; amount: number }>();
  for (const l of report.lines) {
    const k = l.costCenter?.id ?? report.costCenter.id;
    const cur = by.get(k) ?? {
      name: l.costCenter?.name ?? report.costCenter.name,
      amount: 0,
    };
    cur.amount += l.amount;
    by.set(k, cur);
  }
  return [...by.entries()].map(([id, v]) => ({ id, ...v }));
}

/** One report: who, how much, what each line is charged to, and its policy status. */
export function ReportCard({
  report,
  onOpen,
}: {
  report: ReportView;
  onOpen?: (id: string) => void;
}) {
  return (
    <div data-testid="ledgerline-report-card" className={frame}>
      <div className="flex items-start gap-3 px-3.5 pb-3 pt-3">
        <Avatar name={report.employee} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold leading-tight">{report.title}</div>
          <div className="mt-0.5 text-[12px] text-ink-muted">
            {report.employee} · {report.category} · <Id>{report.id}</Id>
          </div>
        </div>
        <Money
          value={report.total}
          className="text-[18px] font-semibold tracking-[-0.02em]"
        />
      </div>
      <div className="flex flex-wrap gap-1.5 px-3.5 pb-2.5">
        <StatusPill status={report.status as ReportStatus} />
        <PolicyStatus report={report} />
      </div>
      <ul className="border-t border-hairline px-3.5 py-1.5">
        {report.lines.map((l, i) => (
          <li
            key={l.lineId ?? i}
            className="flex items-baseline gap-2 py-1 text-[12.5px]"
          >
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{l.description}</span>
              <Id className="ml-1.5 text-[11px]">
                {l.costCenter?.id ?? report.costCenter.id}
              </Id>
            </span>
            <Money value={l.amount} />
          </li>
        ))}
      </ul>
      {onOpen ? (
        <div className="flex justify-end border-t border-hairline px-3.5 py-2">
          <button
            type="button"
            className="text-[12.5px] font-medium text-brand hover:underline"
            onClick={() => onOpen(report.id)}
          >
            Open report
          </button>
        </div>
      ) : null}
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
      className="my-2 flex items-start gap-2.5 rounded-[10px] border border-negative/25 bg-negative-soft px-3.5 py-2.5 text-[13px]"
    >
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-negative" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">Approval blocked</span>
          <span className="ll-mono rounded bg-surface px-1.5 py-0.5 text-[11.5px] font-semibold text-negative">
            {code}
          </span>
          <span className="text-[12px] text-negative">Allocation required</span>
        </div>
        <div className="mt-0.5 text-[12px] text-ink-muted">
          <Id>{reportId}</Id>
          {employee ? ` · ${employee}` : ""}
          {typeof total === "number" ? (
            <>
              {" "}
              · <Money value={total} />
            </>
          ) : null}{" "}
          · the policy engine holds this report
        </div>
      </div>
    </div>
  );
}

// ── Approve and reimburse (HITL) ────────────────────────────────────────────

/** The one confirmation for the write: approve, then schedule the ACH payment. Shows the coding. */
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
        className={cn(
          frame,
          "flex items-start gap-2 px-3.5 py-2.5",
          outcome.ok && "border-positive/30 bg-positive-soft",
        )}
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
  const coding = codingSummary(report);
  return (
    <div
      data-testid="ledgerline-approve-card"
      className={cn(frame, "border-brand/40 ring-4 ring-brand-soft")}
    >
      <div className="flex items-center justify-between gap-2 px-3.5 pb-2 pt-3">
        <div className="flex items-center gap-2 font-semibold">
          <Wallet className="h-4 w-4 text-brand" /> Approve and reimburse
        </div>
        <Money
          value={report.total}
          className="text-[18px] font-semibold tracking-[-0.02em]"
        />
      </div>
      <dl className="grid grid-cols-[88px_1fr] gap-y-1.5 border-t border-hairline px-3.5 py-2.5 text-[12.5px]">
        <dt className="text-[hsl(var(--ll-faint))]">Report</dt>
        <dd className="truncate">
          {report.title} <Id className="text-[11px]">{report.id}</Id>
        </dd>
        <dt className="text-[hsl(var(--ll-faint))]">Payee</dt>
        <dd className="flex items-center gap-1.5">
          <Avatar name={report.employee} size="sm" /> {report.employee}
        </dd>
        <dt className="text-[hsl(var(--ll-faint))]">Coding</dt>
        <dd className="space-y-0.5">
          {coding.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2">
              <span className="truncate">
                <Id className="mr-1">{c.id}</Id>
                {c.name}
              </span>
              <Money value={c.amount} />
            </div>
          ))}
        </dd>
        <dt className="text-[hsl(var(--ll-faint))]">Policy</dt>
        <dd>
          <PolicyStatus report={report} />
        </dd>
        <dt className="text-[hsl(var(--ll-faint))]">Payment</dt>
        <dd>ACH on the {formatDate(paymentRun)} run</dd>
      </dl>
      <div className="flex gap-2 border-t border-hairline bg-surface-muted px-3.5 py-2.5">
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
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
          Approve and reimburse {formatMoney(report.total)}
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
        <div className="px-3.5 pb-2.5 text-[12px] text-negative">
          A policy hold is still open, so approval will be refused.
        </div>
      ) : null}
    </div>
  );
}
