"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Wallet } from "lucide-react";
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
  Badge,
  Card,
  CardHeader,
  PageHeader,
  Stat,
  primaryButton,
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
            title: `Reimbursement scheduled`,
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
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Reimbursements"
        subtitle={`Next ACH payment run: ${formatDate(run)}`}
      />
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat
          label="Ready to pay"
          value={formatMoney(ready.reduce((a, r) => a + r.total, 0))}
          tone="brand"
        />
        <Stat label="Reports ready" value={ready.length} />
        <Stat
          label="Paid this quarter"
          value={formatMoney(paid.reduce((a, r) => a + r.total, 0))}
        />
      </div>
      <div className="space-y-4">
        <Card>
          <CardHeader title={`Ready to reimburse (${ready.length})`} />
          <ul>
            {ready.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-3 border-b border-hairline px-4 py-2.5 last:border-0"
              >
                <Avatar name={r.employeeName} />
                <div className="min-w-0 flex-1">
                  <Link
                    href={skinHref(`reports/${r.id}`)}
                    data-action="Open report"
                    className="text-[0.84rem] font-medium hover:text-brand"
                  >
                    {r.title}
                  </Link>
                  <div className="text-[0.72rem] text-ink-muted">
                    {r.employeeName} · approved{" "}
                    {r.approvedAt ? formatDate(r.approvedAt) : ""} by{" "}
                    {r.approvedBy}
                  </div>
                </div>
                <span className="w-24 text-right text-[0.84rem] font-semibold tabular-nums">
                  {formatMoney(r.total)}
                </span>
                <button
                  type="button"
                  data-action="Reimburse from list"
                  className={primaryButton}
                  disabled={busy !== null}
                  onClick={() => void reimburse(r)}
                >
                  {busy === r.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Wallet className="h-4 w-4" />
                  )}
                  Reimburse
                </button>
              </li>
            ))}
            {ready.length === 0 ? (
              <li className="px-4 py-6 text-center text-[0.8rem] text-ink-muted">
                Nothing approved is waiting.
              </li>
            ) : null}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Payment history" />
          <table className="w-full text-[0.8rem]">
            <thead className="text-[0.68rem] uppercase tracking-[0.05em] text-ink-muted">
              <tr className="border-b border-hairline text-left">
                <th className="px-4 py-2 font-medium">Payee</th>
                <th className="px-4 py-2 font-medium">Report</th>
                <th className="px-4 py-2 font-medium">Paid</th>
                <th className="px-4 py-2 font-medium">Reference</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {paid.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-hairline last:border-0"
                >
                  <td className="px-4 py-2">{r.employeeName}</td>
                  <td className="px-4 py-2">
                    <Link
                      href={skinHref(`reports/${r.id}`)}
                      data-action="Open report"
                      className="hover:text-brand"
                    >
                      {r.title}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-ink-muted">
                    {r.reimbursement
                      ? formatDate(r.reimbursement.scheduledFor)
                      : ""}
                  </td>
                  <td className="px-4 py-2">
                    <Badge>{r.reimbursement?.reference}</Badge>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatMoney(r.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
