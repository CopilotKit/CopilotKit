"use client";

/**
 * REVIEW N MATCHES: how the agent hands a month-end close to a person. One
 * source for the in-app chat (`tools.tsx`, the `reviewMatches` tool) and the
 * MCP app ChatGPT renders (`mcp-app/main.tsx`). The agent prepares the pairs;
 * only the person's Confirm validates the session and closes the month.
 *
 * No Next, CopilotKit or recorder imports: data and callbacks in.
 */

import { useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Euro,
  ListChecks,
  Loader2,
  Lock,
  PenLine,
  Split,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney } from "../data/format";
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
  const paired = view.pairs.filter((p) => p.receipts.length > 0).length;
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
            <ListChecks className="h-4 w-4 text-brand" /> Review{" "}
            {view.pairs.length} matches
          </div>
          <div className="mt-0.5 text-[12px] text-ink-muted">
            {view.card.holder} · Visa •• {view.card.last4} ·{" "}
            {view.card.periodLabel}
          </div>
        </div>
        <Money
          value={total}
          className="text-[16px] font-semibold tracking-[-0.02em]"
        />
      </div>
      <ul className="divide-y divide-hairline border-t border-hairline">
        {view.pairs.map((p) => (
          <li
            key={p.transaction.id}
            className="flex items-center gap-2.5 px-3.5 py-2"
          >
            <div className="flex shrink-0 -space-x-3">
              {p.receipts.length ? (
                p.receipts.map((r) => (
                  <span
                    key={r.id}
                    className="rounded-[4px] ring-2 ring-surface"
                  >
                    <ReceiptThumb receipt={r} width={30} height={38} />
                  </span>
                ))
              ) : (
                <span className="flex h-[38px] w-[30px] items-center justify-center rounded-[4px] border border-dashed border-negative/40">
                  <CircleAlert className="h-3.5 w-3.5 text-negative" />
                </span>
              )}
            </div>
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
                <span className="truncate text-[12px] text-ink-muted">
                  {p.receipts.length
                    ? p.receipts
                        .map((r) => r.merchant)
                        .filter((m, i, a) => a.indexOf(m) === i)
                        .join(" + ")
                    : "No receipt"}
                  {p.receipts[0] ? ` · ${formatDate(p.receipts[0].date)}` : ""}
                </span>
                {chipsFor(p).map((c) => (
                  <span
                    key={c.text}
                    className={cn(
                      "inline-flex items-center gap-0.5 rounded-[4px] px-1 py-px text-[10.5px] font-medium",
                      c.brand
                        ? "bg-brand-soft text-brand-indigo"
                        : "bg-surface-muted text-ink-muted",
                    )}
                  >
                    <c.icon className="h-2.5 w-2.5" /> {c.text}
                  </span>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ul>
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
            {paired} of {view.pairs.length} charges matched and ready. Nothing
            is closed until you confirm.
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
