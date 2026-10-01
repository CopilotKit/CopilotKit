"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, ShieldAlert } from "lucide-react";
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
  Badge,
  Card,
  CardHeader,
  PageHeader,
  primaryButton,
  secondaryButton,
} from "../components/ui";
import { useToast } from "../components/toast";

/**
 * The approvals queue: everything submitted, held reports first. A report with
 * no hold can be approved from the row; a held one opens its page, where the
 * Policy panel explains the hold.
 */
export function ApprovalsPage() {
  const { data } = useLedger();
  const actions = useLedgerActions();
  const toast = useToast();
  const skin = useSkin();
  const skinHref = useSkinHref(skin.id);
  const [busy, setBusy] = useState<string | null>(null);
  const queue = data.reports.filter((r) => r.status === "submitted");
  const held = queue.filter((r) => r.holds.some((h) => h.status === "open"));
  const clear = queue.filter((r) => !held.includes(r));

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

  const row = (r: ExpenseReport) => {
    const hold = r.holds.find((h) => h.status === "open");
    return (
      <li
        key={r.id}
        className="flex items-center gap-3 border-b border-hairline px-4 py-2.5 last:border-0"
      >
        <Avatar name={r.employeeName} />
        <div className="min-w-0 flex-1">
          <Link
            href={skinHref(`reports/${r.id}`)}
            data-action="Open report"
            className="truncate text-[0.84rem] font-medium hover:text-brand"
          >
            {r.title}
          </Link>
          <div className="text-[0.72rem] text-ink-muted">
            {r.employeeName} · {r.department} · {r.category} · submitted{" "}
            {formatDate(r.submittedAt)}
          </div>
        </div>
        {hold ? (
          <Badge tone="negative">
            <ShieldAlert className="h-3 w-3" /> {hold.code}
          </Badge>
        ) : null}
        <span className="w-24 text-right text-[0.84rem] font-semibold tabular-nums">
          {formatMoney(r.total)}
        </span>
        {hold ? (
          <Link
            href={skinHref(`reports/${r.id}`)}
            data-action="Review held report"
            className={secondaryButton}
          >
            Review
          </Link>
        ) : (
          <button
            type="button"
            data-action="Approve from queue"
            className={primaryButton}
            disabled={busy !== null}
            onClick={() => void approve(r)}
          >
            {busy === r.id ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Approve
          </button>
        )}
      </li>
    );
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Approvals"
        subtitle={`${queue.length} reports, ${formatMoney(queue.reduce((a, r) => a + r.total, 0))} waiting for Finance Operations`}
      />
      <div className="space-y-4">
        {held.length ? (
          <Card>
            <CardHeader
              title={`On policy hold (${held.length})`}
              action={
                <span className="text-[0.7rem] text-ink-muted">
                  Open a report to see why
                </span>
              }
            />
            <ul>{held.map(row)}</ul>
          </Card>
        ) : null}
        <Card>
          <CardHeader title={`Ready for approval (${clear.length})`} />
          <ul>
            {clear.map(row)}
            {clear.length === 0 ? (
              <li className="px-4 py-6 text-center text-[0.8rem] text-ink-muted">
                Nothing waiting.
              </li>
            ) : null}
          </ul>
        </Card>
      </div>
    </div>
  );
}
