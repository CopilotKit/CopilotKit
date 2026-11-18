"use client";

/**
 * REVIEW THE CLOSE: how the agent hands a month-end close to a person. One
 * source for the in-app chat (`tools.tsx`, the `reviewMatches` tool) and the
 * MCP app ChatGPT renders (`mcp-app/main.tsx`). The agent clears the
 * exceptions (receipts auto-matched); only the person's Confirm validates the
 * session and closes the month.
 *
 * No Next, CopilotKit or recorder imports: data and callbacks in.
 */

import { useState } from "react";
import {
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  FileSignature,
  Sparkles,
  Tags,
  UserRound,
  CircleAlert,
  Euro,
  ListChecks,
  Loader2,
  Lock,
  PenLine,
  Split,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney } from "../data/format";
import { deptName, glName } from "../data/recon-seed";
import { ReceiptThumb } from "../components/receipt";
import { Money, primaryButton, secondaryButton } from "../components/ui";
import type { ReviewOutcome, ReviewView } from "./views";

const eur = (n: number) =>
  `€${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function chipsFor(pair: ReviewView["pairs"][number]) {
  const out: { icon: typeof Split; text: string; brand?: boolean }[] = [];
  const a = pair.adjustment;
  if (pair.receipts.length > 1)
    out.push({
      icon: Split,
      text: `Split · ${pair.receipts.length} receipts`,
      brand: true,
    });
  if (a?.kind === "gratuity" && a.amount)
    out.push({
      icon: PenLine,
      text: `Tip ${formatMoney(a.amount)}`,
      brand: true,
    });
  if (a?.kind === "fx_conversion" && a.receiptAmount && a.rate)
    out.push({
      icon: Euro,
      text: `${eur(a.receiptAmount)} at ${a.rate.toFixed(4)}`,
      brand: true,
    });
  const gap = Math.max(
    0,
    ...pair.receipts.map((r) =>
      Math.round(
        (Date.parse(pair.transaction.postedAt) - Date.parse(r.date)) /
          86_400_000,
      ),
    ),
  );
  if (gap >= 1) out.push({ icon: CalendarClock, text: `Posted ${gap}d later` });
  return out;
}

type Row = ReviewView["pairs"][number];

/** One line per cleared exception: what was done, in the ledger's words. */
function resolutionLine(p: Row): {
  icon: typeof Split;
  title: string;
  chips: string[];
} {
  const r = p.resolution;
  if (r?.kind === "split")
    return {
      icon: Split,
      title: `Split ${r.lines.length} ways by attendees`,
      chips: r.lines.map(
        (l) => `${deptName(l.departmentId)} ${formatMoney(l.amount)}`,
      ),
    };
  if (r?.kind === "reclass")
    return {
      icon: Tags,
      title: "Reclass entry",
      chips: [`${r.fromAccount} to ${r.toAccount} ${glName(r.toAccount)}`],
    };
  if (r?.kind === "personal")
    return {
      icon: UserRound,
      title: "Personal, repaid",
      chips: [
        r.method === "payroll_deduction" ? "Payroll deduction" : "Card payment",
      ],
    };
  if (r?.kind === "missing_receipt")
    return {
      icon: FileSignature,
      title: "Missing-receipt affidavit",
      chips: [`Signed by ${r.attestedBy}`],
    };
  return { icon: CircleAlert, title: "Not cleared", chips: [] };
}

export function ReviewMatchesCard({
  view,
  outcome,
  confirm,
  onSettle,
  onEdit,
}: {
  view: ReviewView;
  /** A settled answer (after a reload, or from the host). */
  outcome: ReviewOutcome | "edit" | null;
  confirm: () => Promise<ReviewOutcome>;
  onSettle: (o: ReviewOutcome) => void | Promise<void>;
  onEdit: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<ReviewOutcome | null>(null);
  const settled = local ?? (outcome && outcome !== "edit" ? outcome : null);
  const exceptions = view.pairs.filter((p) => p.exception);
  const auto = view.pairs.filter((p) => !p.exception);
  const autoTotal = auto.reduce((n, p) => n + p.transaction.amount, 0);
  const total = view.pairs.reduce((n, p) => n + p.transaction.amount, 0);

  return (
    <div
      data-testid="ledgerline-review-card"
      className={cn(
        "my-2 overflow-hidden rounded-[10px] border bg-surface text-[13px] text-ink",
        settled?.ok
          ? "border-positive/35"
          : "border-brand/40 ring-4 ring-brand-soft",
      )}
    >
      <div className="flex items-start justify-between gap-2 px-3.5 pb-2 pt-3">
        <div>
          <div className="flex items-center gap-2 font-semibold">
            <ListChecks className="h-4 w-4 text-brand" /> Review the{" "}
            {view.card.periodLabel} close
          </div>
          <div className="mt-0.5 text-[12px] text-ink-muted">
            {view.card.holder} · Visa •• {view.card.last4} · {view.pairs.length}{" "}
            charges
          </div>
        </div>
        <Money
          value={total}
          className="text-[16px] font-semibold tracking-[-0.02em]"
        />
      </div>
      {exceptions.length ? (
        <>
          <div className="border-t border-hairline px-3.5 pb-1 pt-2 text-[11px] font-medium text-[hsl(var(--ll-faint))]">
            {exceptions.length} exceptions cleared
          </div>
          <ul className="divide-y divide-hairline">
            {exceptions.map((p) => {
              const line = resolutionLine(p);
              return (
                <li
                  key={p.transaction.id}
                  className="flex items-center gap-2.5 px-3.5 py-2"
                >
                  <span
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                      p.resolution
                        ? "bg-positive-soft text-positive"
                        : "bg-negative-soft text-negative",
                    )}
                  >
                    <line.icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="ll-mono truncate text-[11.5px] font-medium">
                        {p.transaction.descriptor}
                      </span>
                      <Money
                        value={p.transaction.amount}
                        className="text-[12.5px] font-medium"
                      />
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1">
                      <span className="text-[12px] text-ink-muted">
                        {line.title}
                      </span>
                      {line.chips.map((c) => (
                        <span
                          key={c}
                          className="inline-flex items-center rounded-[4px] bg-positive-soft px-1 py-px text-[10.5px] font-medium text-positive"
                        >
                          {c}
                        </span>
                      ))}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      {auto.length ? (
        <div className="flex items-center gap-2.5 border-t border-hairline px-3.5 py-2">
          <div className="flex shrink-0 -space-x-3">
            {auto
              .flatMap((p) => p.receipts)
              .slice(0, 4)
              .map((r) => (
                <span key={r.id} className="rounded-[4px] ring-2 ring-surface">
                  <ReceiptThumb receipt={r} width={24} height={30} />
                </span>
              ))}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="flex items-center gap-1 text-[12px] font-medium">
                <Sparkles className="h-3 w-3 text-brand" /> {auto.length}{" "}
                receipts auto-matched
              </span>
              <Money value={autoTotal} className="text-[12.5px] font-medium" />
            </div>
            <div className="mt-0.5 flex flex-wrap gap-1">
              {auto
                .flatMap((p) => chipsFor(p).filter((c) => c.brand))
                .slice(0, 3)
                .map((c) => (
                  <span
                    key={c.text}
                    className="inline-flex items-center gap-0.5 rounded-[4px] bg-brand-soft px-1 py-px text-[10.5px] font-medium text-brand-indigo"
                  >
                    <c.icon className="h-2.5 w-2.5" /> {c.text}
                  </span>
                ))}
            </div>
          </div>
        </div>
      ) : null}
      {settled ? (
        <div
          role="status"
          className={cn(
            "flex items-start gap-2 border-t px-3.5 py-2.5 text-[12.5px]",
            settled.ok
              ? "border-positive/20 bg-positive-soft text-positive"
              : "border-negative/20 bg-negative-soft text-negative",
          )}
        >
          {settled.ok ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span>{settled.summary}</span>
        </div>
      ) : outcome === "edit" ? (
        <div className="border-t border-hairline px-3.5 py-2.5 text-[12.5px] text-ink-muted">
          Sent to the Card close board to edit. Nothing was closed.
        </div>
      ) : (
        <div className="border-t border-hairline bg-surface-muted px-3.5 py-2.5">
          <p className="mb-2 text-[12px] text-ink-muted">
            <BadgeCheck className="mr-1 inline h-3.5 w-3.5 text-positive" />
            All {view.pairs.length} charges are valid. Nothing is closed until
            you confirm.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="ledgerline-review-confirm"
              className={primaryButton}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const o = await confirm();
                setBusy(false);
                setLocal(o);
                await onSettle(o);
              }}
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Lock className="h-3.5 w-3.5" />
              )}
              Confirm and close {view.card.periodLabel}
            </button>
            <button
              type="button"
              data-testid="ledgerline-review-edit"
              className={secondaryButton}
              disabled={busy}
              onClick={onEdit}
            >
              Edit
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
