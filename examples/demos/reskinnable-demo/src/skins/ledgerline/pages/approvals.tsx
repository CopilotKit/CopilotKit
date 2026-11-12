"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSkin } from "@/shell/skin-provider";
import { useSkinHref } from "@/shell/skin-path";
import {
  formatDate,
  formatMoney,
  useLedger,
  useLedgerActions,
} from "../data/client";
import type { ExpenseReport } from "../data/types";
import {
  Avatar,
  Chip,
  Id,
  Money,
  PageHeader,
  Stat,
  StatStrip,
  ghostButton,
  secondaryButton,
  td,
  th,
} from "../components/ui";
import { useToast } from "../components/toast";

/**
 * The approvals queue: one dense table, held reports first. A report with no
 * hold approves from its row; a held one opens its page.
 */
export function ApprovalsPage() {
  const { data } = useLedger();
  const actions = useLedgerActions();
  const toast = useToast();
  const router = useRouter();
  const skin = useSkin();
  const skinHref = useSkinHref(skin.id);
  const [busy, setBusy] = useState<string | null>(null);
  const queue = data.reports.filter((r) => r.status === "submitted");
  const held = queue.filter((r) => r.holds.some((h) => h.status === "open"));
  const rows = [
    ...held,
    ...queue.filter((r) => !held.includes(r)).sort((a, b) => b.total - a.total),
  ];

  const approve = async (r: ExpenseReport) => {
    setBusy(r.id);
    const out = await actions.approve(r);
    setBusy(null);
    toast(
      out.ok
        ? {
            tone: "ok",
            title: `Approved ${r.id}`,
            body: `${r.employeeName}, ${formatMoney(r.total)}. Ready to reimburse.`,
          }
        : {
            tone: "error",
            title: `${r.id} was not approved`,
            body: out.message,
          },
    );
  };

  return (
    <div className="mx-auto max-w-[1280px]">
      <PageHeader
        title="Approvals"
        subtitle="Reports waiting for Finance Operations, held reports first"
      />
      <StatStrip>
        <Stat label="Waiting" value={queue.length} hint="reports" />
        <Stat
          label="Waiting, total"
          value={<Money value={queue.reduce((a, r) => a + r.total, 0)} />}
        />
        <Stat
          label="On policy hold"
          value={held.length}
          tone={held.length ? "red" : undefined}
          hint={held.length ? "need a fix before approval" : "none"}
        />
        <Stat
          label="Oldest"
          value={
            queue.length
              ? `${Math.max(...queue.map((r) => Math.round((Date.parse(data.today) - Date.parse(r.submittedAt)) / 86_400_000)))}d`
              : "0d"
          }
          hint="since submission"
        />
      </StatStrip>
      <div className="overflow-hidden rounded-[10px] border border-hairline">
        <table className="w-full">
          <thead>
            <tr>
              <th className={th}>Report</th>
              <th className={th}>Employee</th>
              <th className={th}>Policy</th>
              <th className={cn(th, "text-right")}>Amount</th>
              <th className={cn(th, "w-24 text-right")}>
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const hold = r.holds.find((h) => h.status === "open");
              return (
                <tr
                  key={r.id}
                  data-action="Open report"
                  onClick={() => router.push(skinHref(`reports/${r.id}`))}
                  className={cn(
                    "cursor-pointer transition-colors hover:bg-surface-muted/70",
                    hold && "bg-negative-soft/40",
                  )}
                >
                  <td className={td}>
                    <div className="font-medium">{r.title}</div>
                    <div className="text-[11.5px] text-[hsl(var(--ll-faint))]">
                      <Id>{r.id}</Id> {r.category}, submitted{" "}
                      {formatDate(r.submittedAt)}
                    </div>
                  </td>
                  <td className={td}>
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      <Avatar name={r.employeeName} size="sm" />{" "}
                      {r.employeeName}
                    </span>
                  </td>
                  <td className={td}>
                    {hold ? (
                      <Chip tone="red">
                        <ShieldAlert className="h-3 w-3" /> {hold.code}
                      </Chip>
                    ) : (
                      <span className="text-[12.5px] text-[hsl(var(--ll-faint))]">
                        Passed
                      </span>
                    )}
                  </td>
                  <td className={cn(td, "text-right font-medium")}>
                    <Money value={r.total} />
                  </td>
                  <td
                    className={cn(td, "text-right")}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {hold ? (
                      <button
                        type="button"
                        data-action="Review held report"
                        className={secondaryButton}
                        onClick={() => router.push(skinHref(`reports/${r.id}`))}
                      >
                        Review
                      </button>
                    ) : (
                      <button
                        type="button"
                        data-action="Approve from queue"
                        className={ghostButton}
                        disabled={busy !== null}
                        onClick={() => void approve(r)}
                      >
                        {busy === r.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                        Approve
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-10 text-center text-[13px] text-ink-muted"
                >
                  Nothing is waiting. New reports land here when they are
                  submitted.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
