"use client";

/**
 * THE CLOSE AT A GLANCE: the card the agent draws when it starts a month-end
 * close (`showCloseStatus`). Receipts auto-matched in one row; each exception
 * with its workflow and whether it is still waiting for a person. In the app
 * it follows the close live; the trajectory view redraws it from the props
 * the tool call recorded.
 *
 * No Next, CopilotKit or recorder imports: data in.
 */

import {
  CheckCircle2,
  CircleDashed,
  FileSignature,
  Lock,
  Sparkles,
  Split,
  Tags,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Money } from "../components/ui";
import type { CloseStatusView } from "./views";

const KIND: Record<
  CloseStatusView["exceptions"][number]["kind"],
  { icon: typeof Split; label: string }
> = {
  split: { icon: Split, label: "Split across departments" },
  reclass: { icon: Tags, label: "Coded to the wrong account" },
  personal: { icon: UserRound, label: "Personal charge" },
  missing_receipt: { icon: FileSignature, label: "No receipt on file" },
};

export function CloseStatusCard({ view }: { view: CloseStatusView }) {
  const cleared = view.exceptions.filter((x) => x.status === "cleared").length;
  const pct = Math.round((view.ready / Math.max(1, view.total)) * 100);
  return (
    <div
      data-testid="ledgerline-close-status"
      className="my-2 overflow-hidden rounded-[10px] border border-hairline bg-surface text-[13px] text-ink"
    >
      <div className="flex items-start justify-between gap-2 px-3.5 pb-2 pt-3">
        <div>
          <div className="flex items-center gap-2 font-semibold">
            {view.closed ? (
              <Lock className="h-4 w-4 text-positive" />
            ) : (
              <CircleDashed className="h-4 w-4 text-brand" />
            )}
            {view.card.periodLabel} close
          </div>
          <div className="mt-0.5 text-[12px] text-ink-muted">
            {view.card.holder} · Visa •• {view.card.last4} · {view.total}{" "}
            charges
          </div>
        </div>
        <Money
          value={view.totalAmount}
          className="text-[16px] font-semibold tracking-[-0.02em]"
        />
      </div>
      <div className="px-3.5 pb-2.5">
        <div className="flex items-center justify-between text-[11.5px] text-ink-muted">
          <span>
            {view.closed
              ? "Closed"
              : `${view.ready} of ${view.total} ready to close`}
          </span>
          <span>
            {cleared} of {view.exceptions.length} exceptions cleared
          </span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[hsl(var(--ll-gray-soft))]">
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-500",
              view.closed || pct === 100 ? "bg-positive" : "bg-brand",
            )}
            style={{ width: `${view.closed ? 100 : pct}%` }}
          />
        </div>
      </div>
      <div className="flex items-center gap-2.5 border-t border-hairline px-3.5 py-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12px] font-medium">
              {view.autoMatched.count} receipts auto-matched
            </span>
            <Money
              value={view.autoMatched.amount}
              className="text-[12.5px] font-medium"
            />
          </div>
          {view.autoMatched.notes.length ? (
            <div className="mt-0.5 flex flex-wrap gap-1">
              {view.autoMatched.notes.map((n) => (
                <span
                  key={n}
                  className="inline-flex items-center rounded-[4px] bg-brand-soft px-1 py-px text-[10.5px] font-medium text-brand-indigo"
                >
                  {n}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <ul className="divide-y divide-hairline border-t border-hairline">
        {view.exceptions.map((x) => {
          const k = KIND[x.kind];
          const done = x.status === "cleared";
          return (
            <li
              key={x.transactionId}
              className="flex items-center gap-2.5 px-3.5 py-2"
            >
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                  done
                    ? "bg-positive-soft text-positive"
                    : "bg-[hsl(var(--ll-amber-soft))] text-[hsl(var(--ll-amber))]",
                )}
              >
                <k.icon className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="ll-mono truncate text-[11.5px] font-medium">
                    {x.descriptor}
                  </span>
                  <Money
                    value={x.amount}
                    className="text-[12.5px] font-medium"
                  />
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <span className="text-[12px] text-ink-muted">{k.label}</span>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-[4px] px-1.5 py-px text-[10.5px] font-semibold",
                      done
                        ? "bg-positive-soft text-positive"
                        : "bg-[hsl(var(--ll-amber-soft))] text-[hsl(var(--ll-amber))]",
                    )}
                  >
                    {done ? <CheckCircle2 className="h-2.5 w-2.5" /> : null}
                    {done ? "Cleared" : "Needs you"}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
