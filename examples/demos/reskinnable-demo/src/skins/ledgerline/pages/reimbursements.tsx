"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSkin } from "@/shell/skin-provider";
import { useSkinHref } from "@/shell/skin-path";
import {
  formatDate,
  formatMoney,
  useLedger,
  useLedgerActions,
} from "../data/client";
import { nextPaymentRun } from "../data/derive";
import type { ExpenseReport } from "../data/types";
import {
  Avatar,
  Id,
  Money,
  PageHeader,
  Stat,
  StatStrip,
  ghostButton,
  td,
  th,
} from "../components/ui";
import { useToast } from "../components/toast";

/** Approved reports waiting for the next ACH run, and the payment history. */
export function ReimbursementsPage() {
  const { data } = useLedger();
  const actions = useLedgerActions();
  const toast = useToast();
  const skin = useSkin();
  const skinHref = useSkinHref(skin.id);
  const [busy, setBusy] = useState<string | null>(null);
  const ready = data.reports.filter((r) => r.status === "approved");
  const paid = data.reports
    .filter((r) => r.status === "reimbursed")
    .sort((a, b) =>
      (b.reimbursement?.scheduledFor ?? "").localeCompare(
        a.reimbursement?.scheduledFor ?? "",
      ),
    );
  const run = nextPaymentRun(data.today);

  const reimburse = async (r: ExpenseReport) => {
    setBusy(r.id);
    const out = await actions.reimburse(r);
    setBusy(null);
    toast(
      out.ok
        ? {
            tone: "ok",
            title: "Reimbursement scheduled",
            body: `${formatMoney(r.total)} to ${r.employeeName} by ACH on ${formatDate(out.report?.reimbursement?.scheduledFor ?? run)}.`,
          }
        : {
            tone: "error",
            title: `${r.id} was not reimbursed`,
            body: out.message,
          },
    );
  };

  return (
    <div className="mx-auto max-w-[1280px]">
      <PageHeader
        title="Reimbursements"
        subtitle={`ACH runs every Friday. Next run ${formatDate(run)}.`}
      />
      <StatStrip>
        <Stat label="Next run" value={formatDate(run)} hint="ACH, Fridays" />
        <Stat
          label="Ready to pay"
          value={<Money value={ready.reduce((a, r) => a + r.total, 0)} />}
          tone="brand"
          hint={`${ready.length} approved reports`}
        />
        <Stat
          label="Paid this quarter"
          value={<Money value={paid.reduce((a, r) => a + r.total, 0)} />}
          hint={`${paid.length} payments`}
        />
        <Stat
          label="Average payout"
          value={
            <Money
              value={
                paid.length
                  ? paid.reduce((a, r) => a + r.total, 0) / paid.length
                  : 0
              }
            />
          }
          hint="per report"
        />
      </StatStrip>

      <h2 className="mb-2 text-[13px] font-semibold">Ready for the next run</h2>
      <div className="mb-8 overflow-hidden rounded-[10px] border border-hairline">
        <table className="w-full">
          <thead>
            <tr>
              <th className={th}>Payee</th>
              <th className={th}>Report</th>
              <th className={th}>Approved</th>
              <th className={cn(th, "text-right")}>Amount</th>
              <th className={cn(th, "w-28")}>
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {ready.map((r) => (
              <tr key={r.id} className="hover:bg-brand-soft/50">
                <td className={td}>
                  <span className="flex items-center gap-2 whitespace-nowrap">
                    <Avatar name={r.employeeName} size="sm" /> {r.employeeName}
                  </span>
                </td>
                <td className={td}>
                  <Link
                    href={skinHref(`reports/${r.id}`)}
                    data-action="Open report"
                    className="font-medium hover:text-brand"
                  >
                    {r.title}
                  </Link>{" "}
                  <Id className="text-[11.5px]">{r.id}</Id>
                </td>
                <td className={cn(td, "whitespace-nowrap text-ink-muted")}>
                  {r.approvedAt ? formatDate(r.approvedAt) : ""}, {r.approvedBy}
                </td>
                <td className={cn(td, "text-right font-medium")}>
                  <Money value={r.total} />
                </td>
                <td className={cn(td, "text-right")}>
                  <button
                    type="button"
                    data-action="Reimburse from list"
                    className={ghostButton}
                    disabled={busy !== null}
                    onClick={() => void reimburse(r)}
                  >
                    {busy === r.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Wallet className="h-3.5 w-3.5" />
                    )}
                    Reimburse
                  </button>
                </td>
              </tr>
            ))}
            {ready.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-[13px] text-ink-muted"
                >
                  Nothing approved is waiting for a run.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <h2 className="mb-2 text-[13px] font-semibold">Payment history</h2>
      <div className="overflow-hidden rounded-[10px] border border-hairline">
        <table className="w-full">
          <thead>
            <tr>
              <th className={th}>Paid</th>
              <th className={th}>Payee</th>
              <th className={th}>Report</th>
              <th className={th}>Reference</th>
              <th className={cn(th, "text-right")}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {paid.map((r) => (
              <tr key={r.id} className="hover:bg-surface-muted/60">
                <td className={cn(td, "whitespace-nowrap text-ink-muted")}>
                  {r.reimbursement
                    ? formatDate(r.reimbursement.scheduledFor)
                    : ""}
                </td>
                <td className={cn(td, "whitespace-nowrap")}>
                  {r.employeeName}
                </td>
                <td className={td}>
                  <Link
                    href={skinHref(`reports/${r.id}`)}
                    data-action="Open report"
                    className="hover:text-brand"
                  >
                    {r.title}
                  </Link>
                </td>
                <td className={td}>
                  <Id>{r.reimbursement?.reference}</Id>
                </td>
                <td className={cn(td, "text-right")}>
                  <Money value={r.total} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
